import { useEffect, useRef, useState } from "react";
import type { Bot, PublicState } from "../../shared/types";
import { call, type Frame } from "./api";
import { t } from "../../shared/i18n";

// Live view of a bot's screen, next to the chat. You watch while the bot works; after "Take control"
// you can click and type inside the panel. When the bot isn't working, you are already in control.

export function ScreenPanel({ s, bot, onClose }: { s: PublicState; bot: Bot; onClose: () => void }) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [addr, setAddr] = useState("");
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState("");
  const img = useRef<HTMLImageElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const task = s.tasks.find((t) => t.botId === bot.id && (t.state === "running" || t.state === "paused"));
  const botDriving = !!task && !task.userControl;

  useEffect(() => {
    setFrame(null);
    const off = window.teds.onFrame((f) => {
      if (f.botId === bot.id) setFrame(f);
    });
    void call("watchScreen", bot.id, true);
    return () => {
      off();
      void call("watchScreen", bot.id, false);
    };
  }, [bot.id]);

  useEffect(() => {
    if (!editing) setAddr(frame?.url ?? "");
  }, [frame?.url, editing]);

  const send = (ev: unknown) =>
    call("screenInput", bot.id, ev).catch((e: unknown) => setErr(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")));

  const toDip = (e: { clientX: number; clientY: number }) => {
    const r = img.current!.getBoundingClientRect();
    const fw = frame?.dipW ?? 1280;
    const fh = frame?.dipH ?? 800;
    return { x: ((e.clientX - r.left) / r.width) * fw, y: ((e.clientY - r.top) / r.height) * fh };
  };

  const go = () => {
    const u = addr.trim();
    if (!u) return;
    setEditing(false);
    setErr("");
    void send({ type: "navigate", url: u });
  };

  return (
    <div className="screen-panel">
      <div className="screen-bar">
        <button className="ghost small" title={t("Back")} disabled={botDriving} onClick={() => void send({ type: "back" })}>
          ←
        </button>
        <button className="ghost small" title={t("Reload")} disabled={botDriving} onClick={() => void send({ type: "reload" })}>
          ⟳
        </button>
        <input
          className="grow"
          value={addr}
          placeholder={t("Type an address and press Enter (e.g. google.com)")}
          disabled={botDriving}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        <button className="ghost small" title={t("Close panel")} onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="screen-status">
        {task ? (
          task.userControl ? (
            <>
              <span className="pill paused">{t("You're in control · bot is waiting")}</span>
              <button className="primary small" onClick={() => void call("setUserControl", task.id, false)}>
                {t("Give control back")}
              </button>
            </>
          ) : (
            <>
              <span className="pill running">{task.state === "paused" ? t("Bot is waiting for approval") : t("{name} is using the screen", { name: bot.name })}</span>
              <button className="ghost small" onClick={() => void call("setUserControl", task.id, true)}>
                {t("Take control")}
              </button>
              <button className="danger small" onClick={() => void call("stopTask", task.id)}>
                {t("Stop")}
              </button>
            </>
          )
        ) : (
          <span className="muted tiny">{t("The bot isn't using the screen; you can click and type (e.g. to log in to a site).")}</span>
        )}
        {frame?.loading && <span className="muted tiny">{t("Loading…")}</span>}
      </div>
      {err && (
        <div className="error-text tiny" onClick={() => setErr("")}>
          {err}
        </div>
      )}
      <div
        ref={box}
        className={`screen-view ${botDriving ? "locked" : "interactive"}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (botDriving) return;
          if (e.key.length > 1 && !["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Insert"].includes(e.key)) return;
          e.preventDefault();
          void send({ type: "key", key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
        }}
        onPaste={(e) => {
          if (botDriving) return;
          const text = e.clipboardData.getData("text");
          if (text) void send({ type: "text", text });
        }}
      >
        {frame ? (
          <img
            ref={img}
            src={frame.data}
            alt={t("{name}'s screen", { name: bot.name })}
            draggable={false}
            onMouseDown={(e) => {
              box.current?.focus();
              if (botDriving) return;
              e.preventDefault();
              const p = toDip(e);
              const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
              void send({ type: "click", ...p, button, count: Math.min(3, Math.max(1, e.detail)) });
            }}
            onContextMenu={(e) => e.preventDefault()}
            onWheel={(e) => {
              if (botDriving) return;
              void send({ type: "wheel", ...toDip(e), dx: e.deltaX, dy: e.deltaY });
            }}
          />
        ) : (
          <div className="screen-empty muted">{t("Preparing screen…")}</div>
        )}
        {botDriving && <div className="screen-lock-hint">{t("Bot is working · press “Take control” to click")}</div>}
      </div>
    </div>
  );
}
