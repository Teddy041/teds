import { Notification } from "electron";
import path from "node:path";
import { botById, changed, chatFor, newId, state } from "./store";
import { t } from "../shared/i18n";

// Approval flow: before anything that writes or sends, the bot asks the user and waits for the answer.
// The request shows up as a "Do it / Don't" card in the bot's chat and on the Approvals page.

export interface ApprovalAnswer {
  ok: boolean;
  note?: string;
}

const waiting = new Map<string, (a: ApprovalAnswer) => void>();

export function requestApproval(o: { botId: string; title: string; detail: string; taskId?: string }): Promise<ApprovalAnswer> {
  const id = newId();
  state.approvals.unshift({ id, botId: o.botId, title: o.title, detail: o.detail, state: "pending", taskId: o.taskId, at: Date.now() });
  if (state.approvals.length > 300) state.approvals.length = 300;
  chatFor(o.botId).display.push({ id: newId(), kind: "note", text: o.title, at: Date.now(), botId: o.botId, approvalId: id });
  changed();
  const bot = botById(o.botId);
  if (Notification.isSupported()) {
    new Notification({ title: t("{name} is waiting for approval", { name: bot?.name ?? "Bot" }), body: o.title, icon: path.join(__dirname, "../../resources/icon.png") }).show();
  }
  return new Promise((resolve) => waiting.set(id, resolve));
}

export function answerApproval(id: string, ok: boolean, note?: string) {
  const a = state.approvals.find((x) => x.id === id);
  if (!a || a.state !== "pending") return;
  a.state = ok ? "approved" : "rejected";
  if (note) a.note = note;
  changed();
  waiting.get(id)?.({ ok, note });
  waiting.delete(id);
}

/** When a task is stopped, reject its pending approvals. */
export function rejectForTask(taskId: string) {
  for (const a of state.approvals) {
    if (a.taskId === taskId && a.state === "pending") answerApproval(a.id, false, t("Task stopped."));
  }
}

export function rejectForBot(botId: string) {
  for (const a of state.approvals) {
    if (a.botId === botId && a.state === "pending" && !a.taskId) answerApproval(a.id, false, t("Stopped."));
  }
}
