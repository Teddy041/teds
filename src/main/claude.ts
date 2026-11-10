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

// Claude ile konuşan ortak ajan döngüsü. Sohbet botları da ekran görevleri de bunu kullanır:
// istek gönder → Claude araç isterse çalıştır → sonuçları geri gönder → Claude bitirene kadar tekrar et.
// Geçmiş (history) sadece sona eklenir; düşünme blokları dahil yanıt içeriği olduğu gibi geri gönderilir.

export type ToolOutput = string | Array<BetaTextBlockParam | BetaImageBlockParam>;

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** computer-use araç setinin üyeleri için "computer". */
  toolset?: string;
}

export interface LoopOptions {
  model: string;
  effort: Effort;
  system: string;
  history: BetaMessageParam[];
  tools: BetaToolUnion[];
  /** Bir aracı çalıştırır. Hata fırlatırsa sonuç is_error olarak döner. */
  runTool: (call: ToolCall) => Promise<ToolOutput>;
  /** Akış sırasında gelen metin parçaları. Her yeni yanıt turunda `turn` artar. */
  onText?: (delta: string, turn: number) => void;
  /** Her yanıt turu bittiğinde. */
  onTurnEnd?: (msg: BetaMessage, turn: number) => void;
  signal?: AbortSignal;
  maxTurns?: number;
  /** Uzun döngülerde eski araç sonuçlarını (ekran görüntüleri) sunucu tarafında temizle. */
  clearOldToolResults?: boolean;
}

export class StoppedError extends Error {
  constructor() {
    super("Durduruldu");
  }
}

let cached: { key: string; client: Anthropic } | null = null;

export function client(): Anthropic {
  const key = readApiKey();
  if (!key) throw new Error(t("Claude API anahtarı girilmemiş. Ayarlar sayfasından ekleyin."));
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return cached.client;
}

/** Ret durumunda sunucu tarafında yedek modele geçişi destekleyen modeller. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function webSearchTool(model: string): BetaToolUnion {
  const dynamic = /opus|sonnet|fable/.test(model);
  return (dynamic
    ? { type: "web_search_20260209", name: "web_search", max_uses: 5 }
    : { type: "web_search_20250305", name: "web_search", max_uses: 5 }) as BetaToolUnion;
}

/** Son asistan mesajında cevapsız araç çağrısı kaldıysa (durdurma/hata) geçmişi geçerli hale getirir. */
export function closeOpenToolCalls(history: BetaMessageParam[], note = "Durduruldu.") {
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
      closeOpenToolCalls(o.history, "Yanıt reddedildi.");
      return { text: lastText || t("Bu isteği yerine getiremiyorum."), refused: true };
    }
    if (msg.stop_reason === "pause_turn") continue; // sunucu aracı (web araması) sürüyor: aynı geçmişle devam et
    if (msg.stop_reason !== "tool_use") return { text: lastText, refused: false };

    // Araçları sırayla çalıştır; computer-use partisinde biri başarısız olursa kalanları çalıştırma.
    const uses = msg.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    const results: BetaToolResultBlockParam[] = [];
    let computerFailed = false;
    for (const u of uses) {
      const toolset = u.toolset_name ?? undefined;
      const base = { type: "tool_result" as const, tool_use_id: u.id, ...(toolset ? { toolset_name: toolset } : {}) };
      if (o.signal?.aborted) {
        results.push({ ...base, is_error: true, content: "Durduruldu." });
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
        const m = e instanceof StoppedError ? "Durduruldu." : `Hata: ${e instanceof Error ? e.message : String(e)}`;
        results.push({ ...base, is_error: true, content: m });
      }
    }
    o.history.push({ role: "user", content: results });
    if (o.signal?.aborted) throw new StoppedError();
  }
  return { text: lastText || t("İşlem çok uzun sürdü, durdum. Devam etmemi istersen söyle."), refused: false };
}

/** Kullanıcıya gösterilecek, anlaşılır hata metni. */
export function explainError(e: unknown): string {
  if (e instanceof StoppedError) return t("Durduruldu.");
  if (e instanceof Anthropic.AuthenticationError) return t("API anahtarı geçersiz. Ayarlar'dan kontrol edin.");
  if (e instanceof Anthropic.PermissionDeniedError) return t("Bu API anahtarının bu modele erişimi yok.");
  if (e instanceof Anthropic.RateLimitError) return t("Çok fazla istek gönderildi (hız sınırı). Biraz bekleyip tekrar deneyin.");
  if (e instanceof Anthropic.BadRequestError) return `${t("İstek reddedildi:")} ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return t("Claude'a bağlanılamadı. İnternet bağlantınızı kontrol edin.");
  if (e instanceof Anthropic.APIError) return `${t("Claude hatası")} (${e.status}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
