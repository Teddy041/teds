import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AppState, Bot, Chat, PublicState, Template } from "../shared/types";
import { setLang, t } from "../shared/i18n";

// Uygulamanın durumu: bellekte tek bir nesne, değiştikçe arka planda diske (JSON) yazılır.
// Konum: %APPDATA%\Teds\data.json. API anahtarı ayrı dosyada, Windows DPAPI ile şifreli (safeStorage).

const dataDir = () => app.getPath("userData");
const dataFile = () => path.join(dataDir(), "data.json");
const keyFile = () => path.join(dataDir(), "api-key.bin");

export const newId = () => crypto.randomUUID().slice(0, 12);

function fresh(): AppState {
  return {
    settings: {
      language: "tr",
      model: "claude-opus-5-5",
      userName: "",
      userAbout: "",
      orgName: "",
      orgKind: "",
      hasApiKey: false,
      onboarded: false,
    },
    bots: [],
    chats: {},
    collections: [],
    records: [],
    memory: [],
    approvals: [],
    tasks: [],
  };
}

export let state: AppState = fresh();

const backupDir = () => path.join(dataDir(), "backups");

function readJson(file: string): Partial<AppState> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AppState>;
  } catch {
    return null;
  }
}

function latestBackup(): string | null {
  try {
    const files = fs.readdirSync(backupDir()).filter((f) => f.endsWith(".json")).sort();
    return files.length ? path.join(backupDir(), files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

export function loadState() {
  let raw: Partial<AppState> | null = null;
  if (fs.existsSync(dataFile())) {
    raw = readJson(dataFile());
    if (!raw) {
      // Bozuk dosya: silme, kenara al ve son yedekten aç.
      try {
        fs.renameSync(dataFile(), path.join(dataDir(), `data.bozuk-${Date.now()}.json`));
      } catch {
        /* yoksay */
      }
      const b = latestBackup();
      raw = b ? readJson(b) : null;
    }
  }
  state = raw ? { ...fresh(), ...raw, settings: { ...fresh().settings, ...raw.settings } } : fresh();
  setLang(state.settings.language);
  // Eski sürümlerden kalan alanlar (Claude Code beyni kaldırıldı).
  const legacy = state.settings as unknown as Record<string, unknown>;
  delete legacy.brain;
  delete legacy.claudePath;
  for (const c of Object.values(state.chats)) delete (c as unknown as Record<string, unknown>).claudeSession;
  // Uygulama kapanırken yarım kalan işler: tekrar başlatılamaz, durumlarını düzelt.
  for (const c of Object.values(state.chats)) {
    c.busy = false;
    for (const m of c.display) m.streaming = false;
  }
  for (const task of state.tasks) {
    if (task.state === "running" || task.state === "paused") {
      task.state = "stopped";
      task.endedAt = Date.now();
      task.steps.push({ at: Date.now(), text: t("Uygulama kapandığı için durdu.") });
    }
    task.userControl = false;
  }
  for (const a of state.approvals) {
    if (a.state === "pending") {
      a.state = "rejected";
      a.note = t("Uygulama kapandığı için iptal edildi.");
    }
  }
  state.settings.hasApiKey = !!readApiKey();
}

let saveTimer: NodeJS.Timeout | null = null;
let broadcastTimer: NodeJS.Timeout | null = null;
const listeners = new Set<(s: PublicState) => void>();

export function onChange(fn: (s: PublicState) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- Sahip modu ---
// Ekip liderine ve yönetim işlemlerine sadece işletme sahibi ulaşır. Sahip PIN'i belirlenmişse bunlar
// PIN girilene kadar kilitlidir; 30 dakika işlem yapılmazsa yeniden kilitlenir. PIN yoksa kilit yoktur.

const AUTO_LOCK_MS = 30 * 60 * 1000;
let unlockedUntil = 0;

export function hasPin() {
  return !!state.settings.ownerPinHash;
}

export function ownerUnlocked() {
  return !hasPin() || Date.now() < unlockedUntil;
}

/** Sahip işlemi: kilitliyse hata verir, açıksa süreyi uzatır. */
export function requireOwner() {
  if (!ownerUnlocked()) throw new Error(t("Bu işlem için Sahip PIN'i gerekli."));
  if (hasPin()) unlockedUntil = Date.now() + AUTO_LOCK_MS;
}

function hashPin(pin: string, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString("hex")}`;
}

export function checkPin(pin: string): boolean {
  const h = state.settings.ownerPinHash;
  if (!h) return true;
  const [salt, want] = h.split(":");
  const got = crypto.scryptSync(pin, salt, 32);
  return crypto.timingSafeEqual(got, Buffer.from(want, "hex"));
}

export function unlockOwner(pin: string): boolean {
  if (!checkPin(pin)) return false;
  unlockedUntil = Date.now() + AUTO_LOCK_MS;
  changed();
  return true;
}

export function lockOwner() {
  unlockedUntil = 0;
  changed();
}

export function setPin(pin: string | null) {
  state.settings.ownerPinHash = pin ? hashPin(pin) : undefined;
  if (pin) unlockedUntil = Date.now() + AUTO_LOCK_MS;
  changed();
}

setInterval(() => {
  if (hasPin() && unlockedUntil && Date.now() >= unlockedUntil) {
    unlockedUntil = 0;
    changed();
  }
}, 30_000).unref();

export function publicState(): PublicState {
  const unlocked = ownerUnlocked();
  const lead = state.bots.find((b) => b.lead);
  const chats: PublicState["chats"] = {};
  for (const [id, c] of Object.entries(state.chats)) {
    const { history: _h, ...rest } = c;
    // Kilitliyken liderin sohbeti gösterilmez.
    chats[id] = !unlocked && id === lead?.id ? { ...rest, display: [] } : rest;
  }
  const { ownerPinHash, ...settings } = state.settings;
  return {
    ...state,
    settings,
    chats,
    // Kilitliyken liderin onay istekleri de gizlenir.
    approvals: unlocked ? state.approvals : state.approvals.filter((a) => a.botId !== lead?.id),
    owner: { hasPin: !!ownerPinHash, unlocked },
  };
}

/** Durum değişti: arayüze kısa gecikmeyle gönder, diske biraz sonra yaz. */
export function changed() {
  if (!broadcastTimer) {
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      const s = publicState();
      for (const fn of listeners) fn(s);
    }, 40);
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

export function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    backup();
    const tmp = dataFile() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    try {
      fs.renameSync(tmp, dataFile());
    } catch {
      // Windows'ta dosya anlık kilitliyse (antivirüs, yedekleme) doğrudan yaz.
      fs.writeFileSync(dataFile(), JSON.stringify(state));
      fs.rmSync(tmp, { force: true });
    }
  } catch (e) {
    console.error("Kaydedilemedi:", e);
    saveTimer = setTimeout(saveNow, 2000); // tekrar dene
  }
}

let lastBackup = 0;

/** En fazla 10 dakikada bir, son 30 kopyayı tutan otomatik yedek (%APPDATA%\Teds\backups). */
function backup() {
  if (Date.now() - lastBackup < 10 * 60 * 1000 || !fs.existsSync(dataFile())) return;
  lastBackup = Date.now();
  fs.mkdirSync(backupDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  fs.copyFileSync(dataFile(), path.join(backupDir(), `data-${stamp}.json`));
  const files = fs.readdirSync(backupDir()).filter((f) => f.endsWith(".json")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.rmSync(path.join(backupDir(), f), { force: true });
}

export function chatFor(botId: string): Chat {
  let c = state.chats[botId];
  if (!c) {
    c = { botId, display: [], history: [], busy: false };
    state.chats[botId] = c;
  }
  return c;
}

export function botById(id: string): Bot | undefined {
  return state.bots.find((b) => b.id === id);
}

export function leadBot(): Bot | undefined {
  return state.bots.find((b) => b.lead) ?? state.bots[0];
}

/** Şablonu uygular. replace=true ise mevcut botlar ve tablolar silinir. */
export function applyTemplate(t: Template, replace: boolean) {
  if (replace) {
    state.bots = [];
    state.chats = {};
    state.collections = [];
    state.records = [];
  }
  const hasLead = state.bots.some((b) => b.lead);
  for (const b of t.bots) {
    state.bots.push({ ...b, id: newId(), lead: b.lead && !hasLead, tools: [...b.tools] });
  }
  for (const c of t.collections) {
    if (state.collections.some((x) => x.name === c.name)) continue;
    state.collections.push({ ...c, id: newId(), fields: c.fields.map((f) => ({ ...f })) });
  }
  if (!state.settings.orgKind) state.settings.orgKind = t.kind;
  changed();
}

/** Mevcut ekibi ve tablo yapısını şablon olarak dışa aktarır (kayıtlar ve sohbetler hariç). */
export function exportTemplate(): Template {
  return {
    id: "custom",
    name: state.settings.orgName || "Benim ekibim",
    kind: state.settings.orgKind || "Genel",
    description: "Dışa aktarılan ekip ve tablolar",
    bots: state.bots.map(({ id: _id, ...b }) => b),
    collections: state.collections.map(({ id: _id, ...c }) => c),
  };
}

// --- API anahtarı (şifreli) ---

export function readApiKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const buf = fs.readFileSync(keyFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
  } catch {
    return null;
  }
}

export function writeApiKey(key: string | null) {
  if (!key) {
    try {
      fs.unlinkSync(keyFile());
    } catch {
      /* zaten yok */
    }
  } else {
    fs.mkdirSync(dataDir(), { recursive: true });
    const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, "utf8");
    fs.writeFileSync(keyFile(), buf);
  }
  state.settings.hasApiKey = !!readApiKey();
  changed();
}
