import { useEffect, useRef, useState } from "react";
import type { Approval, Bot, DisplayMessage, PublicState } from "../../shared/types";
import { call, timeAgo } from "./api";
import { Markdown } from "./Markdown";
import { ScreenPanel } from "./ScreenPanel";
import { t } from "../../shared/i18n";

export function ApprovalCard({ a, compact }: { a: Approval; compact?: boolean }) {
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  return (
    <div className={`approval ${a.state}`}>
      <div className="approval-title">
        {a.state === "pending" ? `⏳ ${t("Onayın gerekiyor")}` : a.state === "approved" ? `✅ ${t("Onaylandı")}` : `⛔ ${t("Reddedildi")}`}
        {!compact && <span className="muted"> · {timeAgo(a.at)}</span>}
      </div>
      <div className="approval-what">{a.title}</div>
      {a.detail && <pre className="approval-detail">{a.detail}</pre>}
      {a.note && a.state !== "pending" && (
        <div className="muted">
          {t("Not:")} {a.note}
        </div>
      )}
      {a.state === "pending" && (
        <>
          {showNote && <input autoFocus placeholder={t("Bota notun (isteğe bağlı): neden yapmasın, ne yapsın?")} value={note} onChange={(e) => setNote(e.target.value)} />}
          <div className="row">
            <button className="primary" onClick={() => void call("answerApproval", a.id, true)}>
              {t("Yap")}
            </button>
            <button
              className="danger"
              onClick={() => {
                if (!showNote) setShowNote(true);
                else void call("answerApproval", a.id, false, note || undefined);
              }}
            >
              {showNote ? t("Reddet") : t("Yapma")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Message({ m, s, bot }: { m: DisplayMessage; s: PublicState; bot: Bot }) {
  if (m.approvalId) {
    const a = s.approvals.find((x) => x.id === m.approvalId);
    return a ? <ApprovalCard a={a} /> : null;
  }
  if (m.kind === "user") return <div className="msg user"><div className="bubble">{m.text}</div></div>;
  if (m.kind === "tool") return <div className="msg tool">{m.text}</div>;
  if (m.kind === "error") return <div className="msg error">⚠️ {m.text}</div>;
  if (m.kind === "note") return <div className="msg note">{m.text}</div>;
  return (
    <div className="msg bot">
      <span className="avatar">{bot.emoji}</span>
      <div className="bubble">
        <Markdown text={m.text} />
        {m.streaming && <span className="cursor">▍</span>}
      </div>
    </div>
  );
}

export function ChatView({ s, bot, onEdit, openScreen }: { s: PublicState; bot: Bot; onEdit?: () => void; openScreen?: boolean }) {
  const chat = s.chats[bot.id];
  const busy = !!chat?.busy;
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const msgs = chat?.display ?? [];
  const runningTask = s.tasks.find((t) => t.botId === bot.id && (t.state === "running" || t.state === "paused"));

  const [screenOpen, setScreenOpen] = useState(!!openScreen);
  // Bot bir ekran görevine başlayınca panel kendiliğinden açılır.
  useEffect(() => {
    if (runningTask) setScreenOpen(true);
  }, [runningTask?.id]);
  useEffect(() => {
    if (openScreen) setScreenOpen(true);
  }, [openScreen, bot.id]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, msgs[msgs.length - 1]?.text]);

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    void call("sendMessage", bot.id, t);
  };

  return (
    <div className="chat-layout">
    <div className="chat">
      <header className="chat-head">
        <span className="emoji big">{bot.emoji}</span>
        <div>
          <div className="title">{bot.name}</div>
          <div className="muted">
            {bot.role} · {bot.approval === "ask" ? t("Yazmadan önce sorar") : t("Sadece silme/ödeme için sorar")}
          </div>
        </div>
        <div className="spacer" />
        {bot.tools.includes("screen") && (
          <button className={`ghost ${screenOpen ? "on" : ""}`} onClick={() => setScreenOpen(!screenOpen)}>
            🖥️ {screenOpen ? t("Ekranı gizle") : t("Ekranı göster")}
          </button>
        )}
        {onEdit && (
          <button className="ghost" onClick={onEdit}>
            {t("Düzenle")}
          </button>
        )}
        <button
          className="ghost"
          onClick={() => {
            if (confirm(t("{name} ile sohbet geçmişi silinsin mi? (Kayıtlar ve hafıza kalır.)", { name: bot.name }))) void call("clearChat", bot.id);
          }}
        >
          {t("Temizle")}
        </button>
      </header>
      {runningTask && (
        <div className="task-banner">
          🖥️ {t("Ekran görevi:")} {runningTask.goal.slice(0, 120)}
          <span className="spacer" />
          {!screenOpen && (
            <button className="ghost small" onClick={() => setScreenOpen(true)}>
              {t("İzle")}
            </button>
          )}
          <button className="ghost small" onClick={() => void call("setUserControl", runningTask.id, !runningTask.userControl)}>
            {runningTask.userControl ? t("Kontrolü bota ver") : t("Kontrolü al")}
          </button>
        </div>
      )}
      <div className="messages">
        {!msgs.length && (
          <div className="empty">
            <div className="emoji huge">{bot.emoji}</div>
            <p>
              {t("Merhaba, ben")} <b>{bot.name}</b>. {bot.role}.
            </p>
            <p className="muted">{t('Bana bir iş ver. Örneğin: "Bugünkü kayıtları özetle" veya "Yeni bir tablo için hangi alanlar lazım?"')}</p>
          </div>
        )}
        {msgs.map((m) => (
          <Message key={m.id} m={m} s={s} bot={bot} />
        ))}
        {busy && !msgs.some((m) => m.streaming) && <div className="msg tool typing">{t("{name} düşünüyor…", { name: bot.name })}</div>}
        <div ref={end} />
      </div>
      <div className="composer">
        <textarea
          placeholder={t("{name} botuna yaz… (Enter gönderir, Shift+Enter yeni satır)", { name: bot.name })}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
        />
        {busy ? (
          <button className="danger" onClick={() => void call("stopChat", bot.id)}>
            {t("Durdur")}
          </button>
        ) : (
          <button className="primary" disabled={!text.trim()} onClick={send}>
            {t("Gönder")}
          </button>
        )}
      </div>
    </div>
    {screenOpen && bot.tools.includes("screen") && <ScreenPanel s={s} bot={bot} onClose={() => setScreenOpen(false)} />}
    </div>
  );
}
