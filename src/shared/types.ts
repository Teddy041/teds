// Ana süreç (main) ile arayüz (renderer) arasında paylaşılan veri tipleri.
// Uygulamanın bütün durumu tek bir AppState nesnesinde tutulur ve diske JSON olarak yazılır.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Botun onay davranışı: "ask" = yazan/gönderen her işlem için sorar, "auto" = sadece silme ve ödeme için sorar. */
export type ApprovalMode = "ask" | "auto";

/** Botların kullanabileceği araç grupları. Her bot için ayrı ayrı açılıp kapatılabilir. */
export type ToolGroup = "records" | "memory" | "team" | "screen" | "web";

export const TOOL_GROUP_LABELS: Record<ToolGroup, { title: string; detail: string }> = {
  records: { title: "Kayıtlar", detail: "Kayıt tablolarını okur, ekler, günceller, siler" },
  memory: { title: "Hafıza", detail: "Önemli bilgileri hatırlar ve unutur" },
  team: { title: "Ekip", detail: "İşi ekipteki başka bir bota devreder" },
  screen: { title: "Ekran", detail: "Kendi tarayıcısında web sitelerini kullanır" },
  web: { title: "Web araması", detail: "İnternette arama yapar" },
};

export interface Bot {
  id: string;
  name: string;
  emoji: string;
  /** Kısa görev tanımı, örn. "Randevu sorumlusu". */
  role: string;
  /** Botun nasıl çalışacağına dair serbest metin talimatlar (sistem istemine girer). */
  instructions: string;
  /** Ekibi yöneten ana bot. Tam olarak bir tane olur. */
  lead: boolean;
  tools: ToolGroup[];
  approval: ApprovalMode;
  effort: Effort;
  /** Boşsa ayarlardaki varsayılan model kullanılır. */
  model?: string;
  /** Kenar çubuğunda botun durduğu klasör, örn. "Muhasebe". Boşsa klasörsüz. */
  folder?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "longtext";
  options?: string[];
}

/** Kullanıcının tanımladığı bir kayıt tablosu: Hastalar, Müşteriler, Faturalar, Stok... */
export interface Collection {
  id: string;
  name: string;
  /** Botlara bu tablonun ne işe yaradığını anlatır. */
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
  /** Hangi bot kaydetti; kullanıcı eklediyse "you". */
  by: string;
  at: number;
}

export type DisplayKind = "user" | "bot" | "tool" | "error" | "note";

/** Sohbet ekranında gösterilen mesaj. API geçmişinden ayrı tutulur. */
export interface DisplayMessage {
  id: string;
  kind: DisplayKind;
  text: string;
  at: number;
  /** Mesajı yazan bot (kind = "bot" veya "tool" ise). */
  botId?: string;
  /** Bu mesaja bağlı onay isteği. */
  approvalId?: string;
  /** Akış devam ediyor mu (yazılıyor). */
  streaming?: boolean;
}

export interface Chat {
  botId: string;
  display: DisplayMessage[];
  /** Claude API'ye gönderilen geçmiş (MessageParam[]); sadece sona eklenir, düzenlenmez. */
  history: unknown[];
  busy: boolean;
}

export type ApprovalState = "pending" | "approved" | "rejected";

export interface Approval {
  id: string;
  botId: string;
  /** İnsan için açıklama: "Ayşe Yılmaz'ı Hastalar tablosuna ekle". */
  title: string;
  detail: string;
  state: ApprovalState;
  /** Reddederken kullanıcının bota notu. */
  note?: string;
  taskId?: string;
  at: number;
}

export type TaskState = "running" | "paused" | "done" | "failed" | "stopped";

export interface TaskStep {
  at: number;
  text: string;
}

/** Botun kendi tarayıcısında yaptığı uzun bir iş (ekran görevi). */
export interface ScreenTask {
  id: string;
  botId: string;
  goal: string;
  state: TaskState;
  steps: TaskStep[];
  result?: string;
  startedAt: number;
  endedAt?: number;
  /** Kullanıcı kontrolü aldı: bot bekliyor. */
  userControl: boolean;
}

export interface Settings {
  /** Arayüz ve bot cevaplarının dili. */
  language: "tr" | "en";
  model: string;
  userName: string;
  userAbout: string;
  /** Çalışma alanının adı ve türü, örn. "Şifa Kliniği" / "Sağlık". */
  orgName: string;
  orgKind: string;
  hasApiKey: boolean;
  onboarded: boolean;
  /** Sahip PIN'inin özeti (scrypt). Arayüze gönderilmez. */
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

/** Bir alan şablonu: hazır bot ekibi ve kayıt tabloları. Dışa/içe aktarılabilir JSON. */
export interface Template {
  id: string;
  name: string;
  kind: string;
  description: string;
  bots: Omit<Bot, "id">[];
  collections: Omit<Collection, "id">[];
}

/** Arayüze gönderilen durum: API geçmişi (büyük) hariç. */
export type PublicState = Omit<AppState, "chats"> & {
  chats: Record<string, Omit<Chat, "history">>;
  /** Sahip modu: PIN var mı, şu an açık mı. PIN yoksa her zaman açıktır. */
  owner: { hasPin: boolean; unlocked: boolean };
};

export const MODELS: { id: string; label: string }[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (önerilen)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (daha hızlı, ucuz)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (en ucuz)" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1 (en güçlü, pahalı)" },
];
