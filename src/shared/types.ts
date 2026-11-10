// Data types shared by the main process and the interface (renderer).
// The whole app state lives in a single AppState object and is written to disk as JSON.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** A bot's approval behaviour: "ask" = asks before anything that writes or sends, "auto" = asks only for deletes and payments. */
export type ApprovalMode = "ask" | "auto";

/** Tool groups bots can use. Each can be switched on or off per bot. */
export type ToolGroup = "records" | "memory" | "team" | "screen" | "web";

export const TOOL_GROUP_LABELS: Record<ToolGroup, { title: string; detail: string }> = {
  records: { title: "Records", detail: "Reads, adds, updates and deletes records" },
  memory: { title: "Memory", detail: "Remembers and forgets important facts" },
  team: { title: "Team", detail: "Hands work to another bot on the team" },
  screen: { title: "Screen", detail: "Uses websites in its own browser" },
  web: { title: "Web search", detail: "Searches the internet" },
};

export interface Bot {
  id: string;
  name: string;
  emoji: string;
  /** Short role description, e.g. "Appointment manager". */
  role: string;
  /** Free-text instructions for how the bot works (they go into the system prompt). */
  instructions: string;
  /** The main bot that leads the team. There is exactly one. */
  lead: boolean;
  tools: ToolGroup[];
  approval: ApprovalMode;
  effort: Effort;
  /** If empty, the default model from Settings is used. */
  model?: string;
  /** The sidebar folder the bot sits in, e.g. "Accounting". Empty means no folder. */
  folder?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "longtext";
  options?: string[];
}

/** A record table defined by the user: Patients, Customers, Invoices, Stock... */
export interface Collection {
  id: string;
  name: string;
  /** Tells the bots what this table is for. */
  description: string;
  fields: FieldDef[];
}

export interface RecordRow {
  id: string;
  collectionId: string;
  data: Record<string, string | number | null>;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryFact {
  id: string;
  text: string;
  /** Which bot saved it; "you" if the user added it. */
  by: string;
  at: number;
}

export type DisplayKind = "user" | "bot" | "tool" | "error" | "note";

/** A message shown in the chat. Kept separately from the API history. */
export interface DisplayMessage {
  id: string;
  kind: DisplayKind;
  text: string;
  at: number;
  /** The bot that wrote the message (when kind is "bot" or "tool"). */
  botId?: string;
  /** The approval request attached to this message. */
  approvalId?: string;
  /** Whether the reply is still streaming. */
  streaming?: boolean;
}

export interface Chat {
  botId: string;
  display: DisplayMessage[];
  /** History sent to the Claude API (MessageParam[]); append-only, never edited. */
  history: unknown[];
  busy: boolean;
}

export type ApprovalState = "pending" | "approved" | "rejected";

export interface Approval {
  id: string;
  botId: string;
  /** Human-readable description: "Add Sarah Mitchell to the Patients table". */
  title: string;
  detail: string;
  state: ApprovalState;
  /** The user's note to the bot when rejecting. */
  note?: string;
  taskId?: string;
  at: number;
}

export type TaskState = "running" | "paused" | "done" | "failed" | "stopped";

export interface TaskStep {
  at: number;
  text: string;
}

/** A longer job a bot does in its own browser (a screen task). */
export interface ScreenTask {
  id: string;
  botId: string;
  goal: string;
  state: TaskState;
  steps: TaskStep[];
  result?: string;
  startedAt: number;
  endedAt?: number;
  /** The user took control: the bot is waiting. */
  userControl: boolean;
}

export interface Settings {
  /** Language of the interface and of the bots' replies. */
  language: "en" | "tr";
  model: string;
  userName: string;
  userAbout: string;
  /** Name and kind of the business, e.g. "Riverside Clinic" / "Healthcare". */
  orgName: string;
  orgKind: string;
  hasApiKey: boolean;
  onboarded: boolean;
  /** Hash of the owner PIN (scrypt). Never sent to the interface. */
  ownerPinHash?: string;
}

export interface AppState {
  settings: Settings;
  bots: Bot[];
  chats: Record<string, Chat>;
  collections: Collection[];
  records: RecordRow[];
  memory: MemoryFact[];
  approvals: Approval[];
  tasks: ScreenTask[];
}

/** An industry template: a ready-made bot team and record tables. Exportable/importable JSON. */
export interface Template {
  id: string;
  name: string;
  kind: string;
  description: string;
  bots: Omit<Bot, "id">[];
  collections: Omit<Collection, "id">[];
}

/** The state sent to the interface: without the (large) API history. */
export type PublicState = Omit<AppState, "chats"> & {
  chats: Record<string, Omit<Chat, "history">>;
  /** Owner mode: is there a PIN, and is it unlocked now. Without a PIN it is always unlocked. */
  owner: { hasPin: boolean; unlocked: boolean };
};

export const MODELS: { id: string; label: string }[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (recommended)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, cheaper)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (cheapest)" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1 (most capable, expensive)" },
];
