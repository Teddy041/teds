import { Notification } from "electron";
import { botById, changed, chatFor, newId, state } from "./store";
import { t } from "../shared/i18n";

// Onay akışı: bot yazan/gönderen bir işlem yapmadan önce kullanıcıya sorar ve cevap gelene kadar bekler.
// İstek, botun sohbetinde "Yap / Yapma" kartı olarak görünür; ayrıca Onaylar sayfasında listelenir.

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
    new Notification({ title: t("{name} onay bekliyor", { name: bot?.name ?? "Bot" }), body: o.title }).show();
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

/** Bir görev durdurulunca bekleyen onaylarını reddet. */
export function rejectForTask(taskId: string) {
  for (const a of state.approvals) {
    if (a.taskId === taskId && a.state === "pending") answerApproval(a.id, false, t("Görev durduruldu."));
  }
}

export function rejectForBot(botId: string) {
  for (const a of state.approvals) {
    if (a.botId === botId && a.state === "pending" && !a.taskId) answerApproval(a.id, false, "Durduruldu.");
  }
}
