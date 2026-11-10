import { useEffect, useRef, useState } from "react";
import type { PublicState } from "../../shared/types";
import { call } from "./api";
import { locale, t } from "../../shared/i18n";

// Sol alttaki profil kutusu: kim olduğu (sahip / çalışan modu), çıkış ve giriş.
// "Çıkış yap" sahip oturumunu kapatır: ekip lideri, Ayarlar ve yönetim PIN girilene kadar kilitlenir.

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "👤";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toLocaleUpperCase(locale());
}

function PinForLogout({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const save = async () => {
    if (pin !== again) return setErr(t("PIN'ler aynı değil."));
    const r = await call<{ ok: boolean; error?: string }>("setOwnerPin", pin, "");
    if (!r.ok) return setErr(r.error ?? t("Hata"));
    await call("lockOwner");
    onDone();
  };
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <h2>{t("Çıkış için PIN belirle")}</h2>
        <p className="muted">{t("Çıkış yapınca ekip lideri, Ayarlar ve yönetim kilitlenir. Tekrar giriş yapabilmen için bir Sahip PIN'i gerekiyor (4-8 hane).")}</p>
        <label>
          PIN
          <input autoFocus type="password" inputMode="numeric" value={pin} onChange={(e) => (setPin(e.target.value.replace(/\D/g, "")), setErr(""))} />
        </label>
        <label>
          {t("PIN (tekrar)")}
          <input
            type="password"
            inputMode="numeric"
            value={again}
            onChange={(e) => (setAgain(e.target.value.replace(/\D/g, "")), setErr(""))}
            onKeyDown={(e) => e.key === "Enter" && pin.length >= 4 && void save()}
          />
        </label>
        {err && <div className="error-text">{err}</div>}
        <div className="row end">
          <button className="ghost" onClick={onCancel}>
            {t("Vazgeç")}
          </button>
          <button className="primary" disabled={pin.length < 4 || !again} onClick={() => void save()}>
            {t("PIN'i kaydet ve çıkış yap")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProfileBox({ s, onLogin, onLoggedOut, onSettings }: { s: PublicState; onLogin: () => void; onLoggedOut: () => void; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const [askPin, setAskPin] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const owner = s.owner.unlocked;
  const name = s.settings.userName || t("İşletme sahibi");

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const logout = async () => {
    setOpen(false);
    if (!s.owner.hasPin) {
      setAskPin(true);
      return;
    }
    await call("lockOwner");
    onLoggedOut();
  };

  return (
    <div className="profile" ref={ref}>
      {open && (
        <div className="profile-menu">
          {owner ? (
            <>
              <button onClick={() => (setOpen(false), onSettings())}>⚙️ {t("Profil ve ayarlar")}</button>
              <button className="danger-text" onClick={() => void logout()}>
                ⎋ {t("Çıkış yap")}
              </button>
            </>
          ) : (
            <button onClick={() => (setOpen(false), onLogin())}>🔑 {t("Sahip girişi")}</button>
          )}
        </div>
      )}
      <button className={`profile-btn ${open ? "active" : ""}`} onClick={() => setOpen(!open)}>
        <span className={`avatar-circle ${owner ? "" : "guest"}`}>{owner ? initials(name) : "👥"}</span>
        <span className="bot-text">
          <span className="bot-name">{owner ? name : t("Çalışan modu")}</span>
          <span className="bot-role">{owner ? (s.owner.hasPin ? t("Sahip · oturum açık") : t("Sahip · PIN yok")) : t("Sahip çıkış yaptı")}</span>
        </span>
        <span className="muted">⋯</span>
      </button>
      {askPin && (
        <PinForLogout
          onCancel={() => setAskPin(false)}
          onDone={() => {
            setAskPin(false);
            onLoggedOut();
          }}
        />
      )}
    </div>
  );
}
