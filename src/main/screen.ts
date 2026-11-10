import { BrowserWindow, type NativeImage } from "electron";
import { t } from "../shared/i18n";

// A bot's screen: a separate browser per bot, rendered offscreen (with its own cookie/session partition).
// Because the window is never shown, minimizing, covering or hiding things can't break the picture.
// Claude's computer-use toolset runs here: screenshots are captured, and clicks and keys are sent as
// synthetic input events. The user watches the screen live in a panel inside the app and can click and
// type there too after "Take control".

const WIDTH = 1280;
const HEIGHT = 800;
/** The longest side of a screenshot is at most this; coordinates are scaled to match. */
const MAX_LONG_EDGE = 1366;

const BLANK = (name: string) =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><title>${t("{name}'s screen", { name })}</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#f3f5fb;font:16px Segoe UI,sans-serif;color:#5b6275"><div style="text-align:center"><div style="font-size:56px">🖥️</div><h2 style="color:#1d2333;margin:8px 0">${t("{name}'s screen", { name })}</h2><p>${t("When the bot opens a website, it shows up here live.")}<br>${t("You can also open a site from the address bar above.")}</p></div>`);

interface Screen {
  win: BrowserWindow;
  /** Ratio of screenshot pixels to window DIPs. */
  scale: number;
  cursor: { x: number; y: number };
  /** The last painted frame (for live watching). */
  frame: NativeImage | null;
  lastSent: number;
  pending: NodeJS.Timeout | null;
}

const screens = new Map<string, Screen>();

// --- Live watching ---

export interface Frame {
  botId: string;
  data: string;
  url: string;
  title: string;
  width: number;
  height: number;
  /** The space of click coordinates (window size in DIPs). */
  dipW: number;
  dipH: number;
  loading: boolean;
}

let sink: ((f: Frame) => void) | null = null;
const watching = new Set<string>();

export function setFrameSink(fn: (f: Frame) => void) {
  sink = fn;
}

function shownUrl(u: string) {
  return u.startsWith("data:") || u === "about:blank" ? "" : u;
}

function sendFrame(botId: string, s: Screen) {
  s.pending = null;
  if (!sink || !watching.has(botId) || !s.frame || s.win.isDestroyed()) return;
  s.lastSent = Date.now();
  const { width, height } = s.frame.getSize();
  if (!width) return;
  const wc = s.win.webContents;
  const [dipW, dipH] = s.win.getContentSize();
  sink({ botId, dipW, dipH, data: "data:image/jpeg;base64," + s.frame.toJPEG(70).toString("base64"), url: shownUrl(wc.getURL()), title: wc.getTitle(), width, height, loading: wc.isLoading() });
}

function queueFrame(botId: string, s: Screen) {
  if (!watching.has(botId) || s.pending) return;
  const wait = Math.max(0, 200 - (Date.now() - s.lastSent));
  s.pending = setTimeout(() => sendFrame(botId, s), wait);
}

/** The interface started/stopped watching a bot's screen. */
export function watchScreen(botId: string, title: string, on: boolean) {
  if (!on) {
    watching.delete(botId);
    return;
  }
  watching.add(botId);
  const s = screenFor(botId, title);
  if (s.frame) sendFrame(botId, s);
  else s.win.webContents.invalidate();
}

export function screenFor(botId: string, title: string): Screen {
  const existing = screens.get(botId);
  if (existing && !existing.win.isDestroyed()) return existing;

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    show: false,
    title: t("{name}'s screen", { name: title }),
    backgroundColor: "#ffffff",
    webPreferences: {
      offscreen: true,
      partition: `persist:bot-${botId}`,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const s: Screen = { win, scale: 1, cursor: { x: Math.round(WIDTH / 2), y: Math.round(HEIGHT / 2) }, frame: null, lastSent: 0, pending: null };
  win.webContents.setFrameRate(15);
  win.webContents.on("paint", (_e, _dirty, image) => {
    s.frame = image;
    queueFrame(botId, s);
  });
  win.webContents.on("did-navigate", () => queueFrame(botId, s));
  win.webContents.on("did-stop-loading", () => queueFrame(botId, s));
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Open new tabs/windows in the same screen: the bot only sees one screen.
    if (/^https?:/i.test(url)) void win.loadURL(url);
    return { action: "deny" };
  });
  void win.loadURL(BLANK(title));
  screens.set(botId, s);
  win.on("closed", () => {
    if (screens.get(botId) === s) screens.delete(botId);
  });
  return s;
}

export function hasScreen(botId: string) {
  const s = screens.get(botId);
  return !!s && !s.win.isDestroyed();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function settle(s: Screen, ms = 350) {
  await sleep(ms);
  const wc = s.win.webContents;
  if (!wc.isLoading()) return;
  await Promise.race([new Promise<void>((r) => wc.once("did-stop-loading", () => r())), sleep(8000)]);
  await sleep(250);
}

function fitImage(img: NativeImage, maxLong: number): NativeImage {
  const { width, height } = img.getSize();
  const k = Math.min(1, maxLong / Math.max(width, height));
  return k < 1 ? img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: "good" }) : img;
}

export interface Shot {
  base64: string;
  mediaType: "image/jpeg";
  url: string;
}

/** A full picture of the page (WIDTH x HEIGHT DIPs). If capturePage hangs, the last painted frame is used. */
async function capture(s: Screen): Promise<NativeImage> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000));
  const img = await Promise.race([s.win.webContents.capturePage(), timeout]);
  if (img && !img.isEmpty()) return img;
  if (s.frame && !s.frame.isEmpty()) return s.frame;
  throw new Error(t("Couldn't capture the screen; try again in a few seconds."));
}

export async function screenshot(s: Screen): Promise<Shot> {
  const [w, h] = s.win.getContentSize();
  s.scale = Math.min(1, MAX_LONG_EDGE / Math.max(w, h));
  const raw = await capture(s);
  const img = raw.resize({ width: Math.round(w * s.scale), height: Math.round(h * s.scale), quality: "good" });
  return { base64: img.toJPEG(80).toString("base64"), mediaType: "image/jpeg", url: shownUrl(s.win.webContents.getURL()) };
}

async function zoom(s: Screen, region: number[]): Promise<Shot> {
  const [x0, y0, x1, y1] = region.map((v) => Math.round(v / s.scale));
  const rect = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.max(1, Math.abs(x1 - x0)), height: Math.max(1, Math.abs(y1 - y0)) };
  const full = await capture(s);
  const k = full.getSize().width / s.win.getContentSize()[0];
  const raw = full.crop({ x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) });
  return { base64: fitImage(raw, 1568).toJPEG(85).toString("base64"), mediaType: "image/jpeg", url: shownUrl(s.win.webContents.getURL()) };
}

// --- Klavye ---

type Mod = "shift" | "control" | "alt" | "meta";
const MOD_NAMES: Record<string, Mod> = {
  shift: "shift",
  ctrl: "control",
  control: "control",
  alt: "alt",
  option: "alt",
  super: "meta",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  win: "meta",
  windows: "meta",
};

const KEY_NAMES: Record<string, string> = {
  return: "Enter",
  enter: "Enter",
  kp_enter: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  page_up: "PageUp",
  pageup: "PageUp",
  prior: "PageUp",
  page_down: "PageDown",
  pagedown: "PageDown",
  next: "PageDown",
  space: "Space",
  insert: "Insert",
};

function parseMods(text: unknown): Mod[] {
  if (typeof text !== "string" || !text.trim()) return [];
  return text
    .split("+")
    .map((p) => MOD_NAMES[p.trim().toLowerCase()])
    .filter((m): m is Mod => !!m);
}

function keyCodeOf(name: string): string {
  const n = name.trim();
  const mapped = KEY_NAMES[n.toLowerCase()];
  if (mapped) return mapped;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(n)) return n.toUpperCase();
  if (n.length === 1) return n.toUpperCase();
  return n;
}

function pressCombo(s: Screen, combo: string) {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  const mods: Mod[] = [];
  let key = "";
  for (const p of parts) {
    const m = MOD_NAMES[p.toLowerCase()];
    if (m && parts.length > 1) mods.push(m);
    else key = p;
  }
  if (!key) throw new Error(`Unknown key: ${combo}`);
  const wc = s.win.webContents;
  const keyCode = keyCodeOf(key);
  wc.sendInputEvent({ type: "keyDown", keyCode, modifiers: mods });
  // Printable keys and Enter also need a "char" event (otherwise forms don't submit and letters aren't typed).
  if (keyCode === "Enter") wc.sendInputEvent({ type: "char", keyCode: "\r", modifiers: mods });
  else if (key.length === 1 && !mods.some((m) => m === "control" || m === "meta" || m === "alt")) {
    wc.sendInputEvent({ type: "char", keyCode: key, modifiers: mods });
  }
  wc.sendInputEvent({ type: "keyUp", keyCode, modifiers: mods });
}

// --- Fare ---

function toWin(s: Screen, coord: unknown): { x: number; y: number } {
  if (!Array.isArray(coord) || coord.length !== 2 || !coord.every((v) => typeof v === "number")) {
    throw new Error("coordinate must be [x, y]");
  }
  return { x: Math.round(coord[0] / s.scale), y: Math.round(coord[1] / s.scale) };
}

function click(s: Screen, button: "left" | "right" | "middle", count: number, mods: Mod[]) {
  const wc = s.win.webContents;
  const { x, y } = s.cursor;
  wc.sendInputEvent({ type: "mouseMove", x, y, modifiers: mods });
  for (let i = 1; i <= count; i++) {
    wc.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: i, modifiers: mods });
    wc.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: i, modifiers: mods });
  }
}

/** Runs a computer-use member tool. Returns a text result or an image. */
export async function runAction(s: Screen, name: string, input: Record<string, unknown>): Promise<string | Shot> {
  const wc = s.win.webContents;
  const mods = parseMods(input.text);
  switch (name) {
    case "screenshot":
      return screenshot(s);
    case "zoom": {
      const region = input.region;
      if (!Array.isArray(region) || region.length !== 4) throw new Error("region must be [x0, y0, x1, y1]");
      return zoom(s, region as number[]);
    }
    case "left_click":
    case "right_click":
    case "middle_click":
    case "double_click":
    case "triple_click": {
      if (input.coordinate !== undefined) s.cursor = toWin(s, input.coordinate);
      const button = name === "right_click" ? "right" : name === "middle_click" ? "middle" : "left";
      const count = name === "double_click" ? 2 : name === "triple_click" ? 3 : 1;
      click(s, button, count, mods);
      await settle(s);
      return "OK";
    }
    case "mouse_move":
      s.cursor = toWin(s, input.coordinate);
      wc.sendInputEvent({ type: "mouseMove", ...s.cursor });
      await sleep(150);
      return "OK";
    case "left_mouse_down":
      wc.sendInputEvent({ type: "mouseDown", ...s.cursor, button: "left", clickCount: 1 });
      return "OK";
    case "left_mouse_up":
      wc.sendInputEvent({ type: "mouseUp", ...s.cursor, button: "left", clickCount: 1 });
      await settle(s);
      return "OK";
    case "left_click_drag": {
      const from = toWin(s, input.start_coordinate);
      const to = toWin(s, input.coordinate);
      wc.sendInputEvent({ type: "mouseMove", ...from, modifiers: mods });
      wc.sendInputEvent({ type: "mouseDown", ...from, button: "left", clickCount: 1, modifiers: mods });
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
        const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
        wc.sendInputEvent({ type: "mouseMove", x, y, button: "left", modifiers: mods });
        await sleep(15);
      }
      wc.sendInputEvent({ type: "mouseUp", ...to, button: "left", clickCount: 1, modifiers: mods });
      s.cursor = to;
      await settle(s);
      return "OK";
    }
    case "cursor_position":
      return `X=${Math.round(s.cursor.x * s.scale)}, Y=${Math.round(s.cursor.y * s.scale)}`;
    case "scroll": {
      if (input.coordinate !== undefined) s.cursor = toWin(s, input.coordinate);
      const amount = typeof input.scroll_amount === "number" ? input.scroll_amount : 3;
      const dir = String(input.scroll_direction ?? "down");
      const step = 100 * amount;
      const deltaX = dir === "left" ? step : dir === "right" ? -step : 0;
      const deltaY = dir === "up" ? step : dir === "down" ? -step : 0;
      wc.sendInputEvent({ type: "mouseMove", ...s.cursor });
      wc.sendInputEvent({ type: "mouseWheel", ...s.cursor, deltaX, deltaY, canScroll: true, modifiers: mods });
      await sleep(300);
      return "OK";
    }
    case "type": {
      const text = String(input.text ?? "");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) await wc.insertText(lines[i]);
        if (i < lines.length - 1) pressCombo(s, "Return");
      }
      await settle(s, 200);
      return "OK";
    }
    case "key": {
      const combo = String(input.text ?? "");
      const repeat = Math.min(100, Math.max(1, typeof input.repeat === "number" ? input.repeat : 1));
      for (let i = 0; i < repeat; i++) pressCombo(s, combo);
      await settle(s);
      return "OK";
    }
    case "hold_key": {
      const combo = String(input.text ?? "");
      const secs = Math.min(300, Math.max(0, Number(input.duration ?? 1)));
      const keyCode = keyCodeOf(combo.split("+").pop() ?? combo);
      wc.sendInputEvent({ type: "keyDown", keyCode });
      await sleep(secs * 1000);
      wc.sendInputEvent({ type: "keyUp", keyCode });
      return "OK";
    }
    case "wait": {
      const secs = Math.min(300, Math.max(0, Number(input.duration ?? 1)));
      await sleep(secs * 1000);
      return "OK";
    }
    default:
      throw new Error(`This action isn't supported: ${name}`);
  }
}

export async function openUrl(s: Screen, url: string): Promise<string> {
  let u = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    // Local addresses (localhost, 127.0.0.1, 192.168.x.x…) usually aren't https.
    const local = /^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(u);
    u = (local ? "http://" : "https://") + u;
  }
  if (!/^https?:/i.test(u)) throw new Error(t("Only http and https addresses can be opened."));
  try {
    await s.win.webContents.loadURL(u);
  } catch (e) {
    // Redirects can make loadURL fail even though the page opened.
    if (!s.win.webContents.getURL()) throw e;
  }
  await settle(s, 300);
  return `Opened: ${s.win.webContents.getURL()}`;
}

export function goBack(s: Screen): string {
  const nav = s.win.webContents.navigationHistory;
  if (!nav.canGoBack()) return "There is no page to go back to.";
  nav.goBack();
  return "Geri gidildi.";
}

export async function pageText(s: Screen): Promise<string> {
  const text = (await s.win.webContents.executeJavaScript("document.body ? document.body.innerText : ''", true)) as string;
  return text.length > 20000 ? text.slice(0, 20000) + "\n…(truncated)" : text;
}

// --- The user's input from the panel ("Take control") ---

export type UserInput =
  | { type: "click"; x: number; y: number; button: "left" | "right" | "middle"; count: number }
  | { type: "move"; x: number; y: number }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number }
  | { type: "key"; key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }
  | { type: "text"; text: string }
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "reload" };

/** Browser (DOM) key names → Electron key codes. */
const DOM_KEYS: Record<string, string> = {
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Escape: "Escape",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  " ": "Space",
  Insert: "Insert",
};

export async function userInput(botId: string, title: string, ev: UserInput): Promise<void> {
  const s = screenFor(botId, title);
  const wc = s.win.webContents;
  switch (ev.type) {
    case "click": {
      const x = Math.round(ev.x);
      const y = Math.round(ev.y);
      // The browser detects double clicks from the click count (1, 2, 3).
      wc.sendInputEvent({ type: "mouseMove", x, y });
      wc.sendInputEvent({ type: "mouseDown", x, y, button: ev.button, clickCount: ev.count });
      wc.sendInputEvent({ type: "mouseUp", x, y, button: ev.button, clickCount: ev.count });
      s.cursor = { x, y };
      return;
    }
    case "move":
      wc.sendInputEvent({ type: "mouseMove", x: Math.round(ev.x), y: Math.round(ev.y) });
      return;
    case "wheel":
      wc.sendInputEvent({ type: "mouseWheel", x: Math.round(ev.x), y: Math.round(ev.y), deltaX: -ev.dx, deltaY: -ev.dy, canScroll: true });
      return;
    case "key": {
      const mods = [ev.ctrl && "control", ev.shift && "shift", ev.alt && "alt", ev.meta && "meta"].filter(Boolean) as Mod[];
      const named = DOM_KEYS[ev.key];
      if (named) {
        wc.sendInputEvent({ type: "keyDown", keyCode: named, modifiers: mods });
        if (named === "Enter") wc.sendInputEvent({ type: "char", keyCode: "\r", modifiers: mods });
        if (named === "Space" && !ev.ctrl && !ev.alt && !ev.meta) wc.sendInputEvent({ type: "char", keyCode: " ", modifiers: mods });
        wc.sendInputEvent({ type: "keyUp", keyCode: named, modifiers: mods });
      } else if (ev.key.length === 1) {
        if (ev.ctrl || ev.alt || ev.meta) {
          // Shortcuts (Ctrl+A, Ctrl+C, Ctrl+V…)
          wc.sendInputEvent({ type: "keyDown", keyCode: ev.key.toUpperCase(), modifiers: mods });
          wc.sendInputEvent({ type: "keyUp", keyCode: ev.key.toUpperCase(), modifiers: mods });
        } else {
          // Letters, including non-ASCII ones, are inserted directly.
          await wc.insertText(ev.key);
        }
      }
      return;
    }
    case "text":
      await wc.insertText(ev.text);
      return;
    case "navigate":
      await openUrl(s, ev.url);
      return;
    case "back":
      goBack(s);
      return;
    case "reload":
      wc.reload();
      return;
  }
}
