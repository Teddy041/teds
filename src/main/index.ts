import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Bot, Collection, RecordRow, Settings, Template } from "../shared/types";
import { templates } from "../shared/templates";
import { setLang, t as tr } from "../shared/i18n";
import { answerApproval, requestApproval } from "./approvals";
import { clearChat, handleMessage, stopChat } from "./agent";
import { explainError } from "./claude";
import { setFrameSink, userInput, watchScreen, type UserInput } from "./screen";
import { setUserControl, stopTask } from "./screenTask";
import { applyTemplate, botById, changed, checkPin, exportTemplate, hasPin, leadBot, loadState, lockOwner, newId, onChange, publicState, requireOwner, saveNow, setPin, state, unlockOwner, writeApiKey } from "./store";

// Uygulamanın giriş noktası: ana pencereyi açar ve arayüzden gelen istekleri (IPC) karşılar.

let main: BrowserWindow | null = null;

function createWindow() {
  main = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Teds",
    autoHideMenuBar: true,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) void main.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void main.loadFile(path.join(__dirname, "../renderer/index.html"));
  main.on("closed", () => {
    main = null;
    // Ana pencere kapanınca botların ekranları da kapanır ve uygulama biter.
    app.quit();
  });
}

function validTemplate(t: unknown): t is Template {
  const x = t as Template;
  return !!x && Array.isArray(x.bots) && Array.isArray(x.collections) && x.bots.every((b) => typeof b.name === "string");
}

// Arayüzün çağırabileceği işlemler. Her biri ipcMain.handle ile "api:<ad>" kanalına bağlanır.
const api = {
  getState: () => publicState(),

  updateSettings: (p: Partial<Settings>) => {
    const { hasApiKey: _k, ownerPinHash: _h, ...rest } = p;
    Object.assign(state.settings, rest);
    setLang(state.settings.language);
    changed();
  },
  /** Dil seçimi: sahip kilidi kapalıyken de çalışanlar değiştirebilir. */
  setLanguage: (lang: string) => {
    state.settings.language = lang === "en" ? "en" : "tr";
    setLang(state.settings.language);
    changed();
  },
  setApiKey: async (key: string) => {
    const k = key.trim();
    if (!k) {
      writeApiKey(null);
      return { ok: true };
    }
    try {
      await new Anthropic({ apiKey: k }).models.retrieve(state.settings.model);
    } catch (e) {
      return { ok: false, error: explainError(e) };
    }
    writeApiKey(k);
    return { ok: true };
  },

  applyTemplate: (id: string, replace: boolean) => {
    const tpl = templates().find((x) => x.id === id);
    if (!tpl) throw new Error(tr("Şablon yok"));
    applyTemplate(tpl, replace);
  },
  exportTemplate: async () => {
    const r = await dialog.showSaveDialog(main!, { title: tr("Ekibi dışa aktar"), defaultPath: "teds-template.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(exportTemplate(), null, 2), "utf8");
    return true;
  },
  importTemplate: async (replace: boolean) => {
    const r = await dialog.showOpenDialog(main!, { title: tr("Şablon içe aktar"), filters: [{ name: "JSON", extensions: ["json"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return false;
    const t = JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"));
    if (!validTemplate(t)) throw new Error(tr("Bu dosya geçerli bir Teds şablonu değil."));
    applyTemplate(t, replace);
    return true;
  },

  saveBot: (b: Bot) => {
    const existing = botById(b.id);
    if (existing) Object.assign(existing, b);
    else state.bots.push({ ...b, id: b.id || newId() });
    if (b.lead) for (const x of state.bots) x.lead = x.id === b.id;
    if (!state.bots.some((x) => x.lead) && state.bots[0]) state.bots[0].lead = true;
    changed();
  },
  deleteBot: (id: string) => {
    stopChat(id);
    state.bots = state.bots.filter((b) => b.id !== id);
    delete state.chats[id];
    if (!state.bots.some((x) => x.lead) && state.bots[0]) state.bots[0].lead = true;
    changed();
  },

  sendMessage: async (botId: string, text: string) => {
    if (botId === leadBot()?.id) requireOwner();
    try {
      await handleMessage(botId, text);
    } catch {
      /* hata zaten sohbete yazıldı */
    }
  },
  stopChat: (botId: string) => {
    if (botId === leadBot()?.id) requireOwner();
    stopChat(botId);
  },
  clearChat: (botId: string) => {
    if (botId === leadBot()?.id) requireOwner();
    clearChat(botId);
  },

  answerApproval: (id: string, ok: boolean, note?: string) => {
    // Liderin (yönetici işlemlerinin) onaylarını sadece sahip verebilir.
    if (state.approvals.find((a) => a.id === id)?.botId === leadBot()?.id) requireOwner();
    answerApproval(id, ok, note);
  },

  unlockOwner: (pin: string) => unlockOwner(pin),
  lockOwner: () => lockOwner(),
  /** PIN belirler veya değiştirir. PIN varsa mevcut PIN de doğru olmalı. Boş PIN kilidi kaldırır. */
  setOwnerPin: (pin: string, current: string) => {
    if (hasPin() && !checkPin(current)) return { ok: false, error: tr("Mevcut PIN yanlış.") };
    const p = pin.trim();
    if (p && !/^[0-9]{4,8}$/.test(p)) return { ok: false, error: tr("PIN 4-8 haneli bir sayı olmalı.") };
    setPin(p || null);
    return { ok: true };
  },

  saveCollection: (c: Collection) => {
    const existing = state.collections.find((x) => x.id === c.id);
    if (existing) Object.assign(existing, c);
    else state.collections.push({ ...c, id: c.id || newId() });
    changed();
  },
  deleteCollection: (id: string) => {
    state.collections = state.collections.filter((c) => c.id !== id);
    state.records = state.records.filter((r) => r.collectionId !== id);
    changed();
  },
  saveRecord: (r: Pick<RecordRow, "collectionId" | "data"> & { id?: string }) => {
    const existing = r.id ? state.records.find((x) => x.id === r.id) : undefined;
    if (existing) {
      existing.data = r.data;
      existing.updatedAt = Date.now();
    } else state.records.push({ id: newId(), collectionId: r.collectionId, data: r.data, createdAt: Date.now(), updatedAt: Date.now() });
    changed();
  },
  deleteRecord: (id: string) => {
    state.records = state.records.filter((r) => r.id !== id);
    changed();
  },

  addMemory: (text: string) => {
    if (text.trim()) state.memory.unshift({ id: newId(), text: text.trim(), by: "you", at: Date.now() });
    changed();
  },
  updateMemory: (id: string, text: string) => {
    const m = state.memory.find((x) => x.id === id);
    if (m) m.text = text;
    changed();
  },
  deleteMemory: (id: string) => {
    state.memory = state.memory.filter((m) => m.id !== id);
    changed();
  },

  stopTask: (id: string) => stopTask(id),
  setUserControl: (id: string, on: boolean) => setUserControl(id, on),
  /** Botun ekranını canlı izlemeyi aç/kapat. Liderin ekranı sadece sahibe açıktır. */
  watchScreen: (botId: string, on: boolean) => {
    const b = botById(botId);
    if (!b) return;
    if (on && b.lead) requireOwner();
    watchScreen(b.id, b.name, on);
  },
  /** Kullanıcının panelden tıklaması/yazması. Bot çalışıyorsa önce kontrolü alması gerekir. */
  screenInput: async (botId: string, ev: UserInput) => {
    const b = botById(botId);
    if (!b) return;
    if (b.lead) requireOwner();
    const t = state.tasks.find((x) => x.botId === botId && (x.state === "running" || x.state === "paused"));
    if (t && !t.userControl && ev.type !== "navigate") throw new Error(tr("Bot çalışırken önce Kontrolü al."));
    await userInput(b.id, b.name, ev);
  },
  clearFinishedTasks: () => {
    state.tasks = state.tasks.filter((t) => t.state === "running" || t.state === "paused");
    changed();
  },
};

// Geliştirme testi: TEDS_DEBUG=1 iken ekran işlemlerini doğrudan çalıştırmaya izin ver.
if (process.env.TEDS_DEBUG === "1") {
  Object.assign(api, {
    debugScreen: async (botId: string, name: string, input: Record<string, unknown>) => {
      const { screenFor, runAction, openUrl } = await import("./screen");
      const b = botById(botId);
      const s = screenFor(botId, b?.name ?? "Test");
      if (name === "open_url") return openUrl(s, String(input.url));
      const out = await runAction(s, name, input);
      return typeof out === "string" ? out : { url: out.url, bytes: out.base64.length };
    },
    debugWin: async (botId: string, op: "minimize" | "hide" | "show" | "behind") => {
      const { screenFor, screenshot } = await import("./screen");
      const s = screenFor(botId, "Test");
      if (op === "minimize") s.win.minimize();
      if (op === "hide") s.win.hide();
      if (op === "show") s.win.show();
      if (op === "behind") main?.focus();
      await new Promise((r) => setTimeout(r, 800));
      const shot = await screenshot(s);
      const crypto = await import("node:crypto");
      return { bytes: shot.base64.length, hash: crypto.createHash("md5").update(shot.base64).digest("hex").slice(0, 8) };
    },
    /** Bekleyen bir onay kartı oluşturur (ekran görüntüsü ve arayüz testi için). */
    debugApproval: (botId: string, title: string, detail: string) => {
      void requestApproval({ botId, title, detail });
    },
    debugEval: async (botId: string, js: string) => {
      const { screenFor } = await import("./screen");
      return screenFor(botId, "Test").win.webContents.executeJavaScript(js);
    },
  });
}

export type Api = typeof api;

app.setAppUserModelId("com.teds.app");

// Testler için ayrı veri klasörü (gerçek verilere dokunmamak için).
if (process.env.TEDS_DATA_DIR) app.setPath("userData", process.env.TEDS_DATA_DIR);

// Aynı anda tek Teds: iki pencere aynı veri dosyasına yazıp birbirinin kayıtlarını silmesin.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!main) return;
    if (main.isMinimized()) main.restore();
    main.focus();
  });
}

app.whenReady().then(() => {
  loadState();
  setLang(state.settings.language);
  // Sahip işlemleri: Sahip PIN'i belirlenmişse kilit açıkken çalışır.
  const OWNER_ONLY = new Set(["updateSettings", "setApiKey", "applyTemplate", "exportTemplate", "importTemplate", "saveBot", "deleteBot", "saveCollection", "deleteCollection"]);
  for (const [name, fn] of Object.entries(api)) {
    ipcMain.handle(`api:${name}`, (_e, ...args: unknown[]) => {
      if (OWNER_ONLY.has(name)) requireOwner();
      return (fn as (...a: unknown[]) => unknown)(...args);
    });
  }
  onChange((s) => main?.webContents.send("state", s));
  setFrameSink((f) => main?.webContents.send("screen-frame", f));
  createWindow();
});

app.on("before-quit", () => saveNow());
app.on("window-all-closed", () => app.quit());
