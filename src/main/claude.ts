import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaImageBlockParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Effort } from "../shared/types";
import { readApiKey } from "./store";
import { t } from "../shared/i18n";

// The shared agent loop that talks to Claude. Both chat bots and screen tasks use it:
// send a request → run the tools Claude asks for → send the results back → repeat until Claude is done.
// The history is append-only; the reply content, thinking blocks included, is sent back exactly as received.

export type ToolOutput = string | Array<BetaTextBlockParam | BetaImageBlockParam>;

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** "computer" for members of the computer-use toolset. */
  toolset?: string;
}

export interface LoopOptions {
  model: string;
  effort: Effort;
  system: string;
  history: BetaMessageParam[];
  tools: BetaToolUnion[];
  /** Runs a tool. If it throws, the result is sent back with is_error. */
  runTool: (call: ToolCall) => Promise<ToolOutput>;
  /** Text chunks while streaming. `turn` increases with each new reply turn. */
  onText?: (delta: string, turn: number) => void;
  /** Called when each reply turn ends. */
  onTurnEnd?: (msg: BetaMessage, turn: number) => void;
  signal?: AbortSignal;
  maxTurns?: number;
  /** In long loops, clear old tool results (screenshots) on the server side. */
  clearOldToolResults?: boolean;
}

export class StoppedError extends Error {
  constructor() {
    super("Stopped");
  }
}

let cached: { key: string; client: Anthropic } | null = null;

export function client(): Anthropic {
  const key = readApiKey();
  if (!key) throw new Error(t("No Claude API key yet. Add one in Settings."));
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return cached.client;
}

/** Models that support switching to a fallback model on the server side after a refusal. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function webSearchTool(model: string): BetaToolUnion {
  const dynamic = /opus|sonnet|fable/.test(model);
  return (dynamic
    ? { type: "web_search_20260209", name: "web_search", max_uses: 5 }
    : { type: "web_search_20250305", name: "web_search", max_uses: 5 }) as BetaToolUnion;
}

/** If the last assistant message left tool calls unanswered (stop/error), makes the history valid again. */
export function closeOpenToolCalls(history: BetaMessageParam[], note = "Stopped.") {
  const last = history[history.length - 1];
  if (!last || last.role !== "assistant" || !Array.isArray(last.content)) return;
  const uses = (last.content as BetaContentBlock[]).filter((b): b is BetaToolUseBlock => b.type === "tool_use");
  if (!uses.length) return;
  history.push({
    role: "user",
    content: uses.map(
      (u): BetaToolResultBlockParam => ({
        type: "tool_result",
        tool_use_id: u.id,
        is_error: true,
        content: note,
        ...(u.toolset_name ? { toolset_name: u.toolset_name } : {}),
      }),
    ),
  });
}

const HALT = "Not executed: an earlier computer action in this turn failed.";

export async function runLoop(o: LoopOptions): Promise<{ text: string; refused: boolean }> {
  const c = client();
  const maxTurns = o.maxTurns ?? 25;
  let lastText = "";
  for (let turn = 0; turn < maxTurns; turn++) {
    if (o.signal?.aborted) throw new StoppedError();
    const betas = ["context-management-2025-06-27"];
    const params: Record<string, unknown> = {
      model: o.model,
      max_tokens: 64000,
      system: o.system,
      messages: o.history,
      tools: o.tools,
      cache_control: { type: "ephemeral" },
      output_config: { effort: o.effort },
      context_management: {
        edits: o.clearOldToolResults
          ? [{ type: "clear_tool_uses_20250919", trigger: { type: "input_tokens", value: 60000 }, keep: { type: "tool_uses", value: 4 } }]
          : [{ type: "clear_tool_uses_20250919" }],
      },
    };
    if (FALLBACK_MODELS.has(o.model)) {
      betas.push("server-side-fallback-2026-07-01");
      params.fallbacks = "default";
    }
    params.betas = betas;

    const stream = c.beta.messages.stream(params as never, { signal: o.signal });
    stream.on("text", (delta) => o.onText?.(delta, turn));
    let msg: BetaMessage;
    try {
      msg = await stream.finalMessage();
    } catch (e) {
      if (o.signal?.aborted) throw new StoppedError();
      throw e;
    }
    o.history.push({ role: "assistant", content: msg.content } as BetaMessageParam);
    o.onTurnEnd?.(msg, turn);

    const text = msg.content
      .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text.trim()) lastText = text;

    if (msg.stop_reason === "refusal") {
      closeOpenToolCalls(o.history, "Reply refused.");
      return { text: lastText || t("I can't help with this request."), refused: true };
    }
    if (msg.stop_reason === "pause_turn") continue; // a server tool (web search) is still running: continue with the same history
    if (msg.stop_reason !== "tool_use") return { text: lastText, refused: false };

    // Run the tools in order; if one in a computer-use batch fails, don't run the rest.
    const uses = msg.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    const results: BetaToolResultBlockParam[] = [];
    let computerFailed = false;
    for (const u of uses) {
      const toolset = u.toolset_name ?? undefined;
      const base = { type: "tool_result" as const, tool_use_id: u.id, ...(toolset ? { toolset_name: toolset } : {}) };
      if (o.signal?.aborted) {
        results.push({ ...base, is_error: true, content: "Stopped." });
        continue;
      }
      if (toolset === "computer" && computerFailed) {
        results.push({ ...base, is_error: true, content: HALT });
        continue;
      }
      try {
        const input = (u.input && typeof u.input === "object" ? u.input : {}) as Record<string, unknown>;
        const out = await o.runTool({ id: u.id, name: u.name, input, toolset });
        results.push({ ...base, content: out });
      } catch (e) {
        if (toolset === "computer") computerFailed = true;
        const m = e instanceof StoppedError ? "Stopped." : `Error: ${e instanceof Error ? e.message : String(e)}`;
        results.push({ ...base, is_error: true, content: m });
      }
    }
    o.history.push({ role: "user", content: results });
    if (o.signal?.aborted) throw new StoppedError();
  }
  return { text: lastText || t("This took too long, so I stopped. Tell me if you want me to continue."), refused: false };
}

/** A readable error message to show the user. */
export function explainError(e: unknown): string {
  if (e instanceof StoppedError) return t("Stopped.");
  if (e instanceof Anthropic.AuthenticationError) return t("The API key is invalid. Check it in Settings.");
  if (e instanceof Anthropic.PermissionDeniedError) return t("This API key has no access to this model.");
  if (e instanceof Anthropic.RateLimitError) return t("Too many requests (rate limit). Wait a moment and try again.");
  if (e instanceof Anthropic.BadRequestError) return `${t("Request rejected:")} ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return t("Couldn't reach Claude. Check your internet connection.");
  if (e instanceof Anthropic.APIError) return `${t("Claude error")} (${e.status}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
