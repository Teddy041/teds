import { useState } from "react";
import { MODELS, TOOL_GROUP_LABELS, type Bot, type Effort, type PublicState, type ToolGroup } from "../../shared/types";
import { templates } from "../../shared/templates";
import { LANGS, locale, t, type Lang } from "../../shared/i18n";
import { call, timeAgo, uid } from "./api";
import { ApprovalCard } from "./Chat";

// ---------- Dil düğmesi ----------

/** TR / EN geçişi. Sahip kilidi açık olmasa da çalışır. */
export function LangSwitch({ lang }: { lang?: Lang }) {
  const cur = lang === "en" ? "en" : "tr";
  return (
    <div className="lang-switch" role="group" aria-label="Language / Dil">
      {LANGS.map((l) => (
        <button key={l.id} className={cur === l.id ? "active" : ""} title={l.label} onClick={() => cur !== l.id && void call("setLanguage", l.id)}>
          {l.id.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ---------- Sahip kilidi ----------

export function OwnerGate({ why }: { why: string }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const submit = async () => {
    const ok = await call<boolean>("unlockOwner", pin);
    if (!ok) {
      setErr(t("PIN yanlış."));
      setPin("");
    }
  };
  return (
    <div className="onboarding">
      <div className="card gate">
        <div className="emoji huge">🔒</div>
        <h2>{t("Sahip girişi")}</h2>
        <p className="muted">{why}</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          placeholder={t("Sahip PIN'i")}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setErr("");
          }}
          onKeyDown={(e) => e.key === "Enter" && pin && void submit()}
        />
        {err && <div className="error-text">{err}</div>}
        <div className="row end">
          <button className="primary" disabled={!pin} onClick={() => void submit()}>
            {t("Kilidi aç")}
          </button>
        </div>
        <p className="tiny muted">{t("30 dakika işlem yapılmazsa yeniden kilitlenir.")}</p>
      </div>
    </div>
  );
}

function PinCard({ s }: { s: PublicState }) {
  const [cur, setCur] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const save = async (next: string) => {
    const r = await call<{ ok: boolean; error?: string }>("setOwnerPin", next, cur);
    setMsg(r.ok ? (next ? t("PIN kaydedildi.") : t("PIN kaldırıldı; kilit kapalı.")) : (r.error ?? t("Hata")));
    if (r.ok) {
      setCur("");
      setPin("");
    }
  };
  return (
    <div className="card">
      <h3>{t("Sahip PIN'i")}</h3>
      <p className="muted">
        {t(
          "Ekip lideri ({name}) yönetici yetkilerine sahiptir: bot ekler, siler, yetki verir, tablo oluşturur. PIN belirlersen lidere, Ayarlar'a ve bot/tablo düzenlemeye sadece PIN'i bilen işletme sahibi ulaşır. Çalışanlar diğer botlarla konuşabilir ve kayıtları kullanabilir.",
          { name: s.bots.find((b) => b.lead)?.name ?? "" },
        )}
      </p>
      {s.owner.hasPin && (
        <label>
          {t("Mevcut PIN")}
          <input type="password" inputMode="numeric" value={cur} onChange={(e) => setCur(e.target.value)} />
        </label>
      )}
      <label>
        {s.owner.hasPin ? t("Yeni PIN (4-8 hane)") : t("PIN (4-8 hane)")}
        <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
      </label>
      <div className="row">
        <button className="primary" disabled={pin.length < 4} onClick={() => void save(pin)}>
          {s.owner.hasPin ? t("PIN'i değiştir") : t("PIN belirle")}
        </button>
        {s.owner.hasPin && (
          <button className="ghost danger-text" onClick={() => void save("")}>
            {t("PIN'i kaldır")}
          </button>
        )}
        {msg && <span className="muted">{msg}</span>}
      </div>
    </div>
  );
}

// ---------- İlk kurulum ----------

export function Onboarding({ s }: { s: PublicState }) {
  const ready = s.settings.hasApiKey;
  const [step, setStep] = useState(ready ? (s.bots.length ? 2 : 1) : 0);
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);
  const [tpl, setTpl] = useState("health");
  const [org, setOrg] = useState(s.settings.orgName);
  const [name, setName] = useState(s.settings.userName);
  const [about, setAbout] = useState(s.settings.userAbout);

  return (
    <div className="onboarding">
      <div className="card wide">
        <div className="row">
          <div className="brand big">
            <span className="logo">◆</span> Teds
          </div>
          <span className="spacer" />
          <LangSwitch lang={s.settings.language} />
        </div>
        <p className="muted">{t("Her yönetim alanı için düzenlenebilir yapay zekâ bot ekibi.")}</p>

        {step === 0 && (
          <>
            <h2>{t("1. Claude API anahtarı")}</h2>
            <p className="muted">
              {t("Botlar Claude ile çalışır. Anahtarını şuradan alabilirsin:")}{" "}
              <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
                platform.claude.com
              </a>
              . {t("Anahtar bu bilgisayarda Windows şifrelemesiyle saklanır.")}
            </p>
            <input type="password" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} />
            {err && <div className="error-text">{err}</div>}
            <div className="row end">
              <button
                className="primary"
                disabled={!key.trim() || checking}
                onClick={async () => {
                  setChecking(true);
                  setErr("");
                  const r = await call<{ ok: boolean; error?: string }>("setApiKey", key);
                  setChecking(false);
                  if (r.ok) setStep(s.bots.length ? 2 : 1);
                  else setErr(r.error ?? t("Anahtar doğrulanamadı"));
                }}
              >
                {checking ? t("Kontrol ediliyor…") : t("Devam")}
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>{t("2. Alanını seç")}</h2>
            <p className="muted">{t("Hazır bir ekip ve tablolarla başla. Sonra her şeyi değiştirebilirsin.")}</p>
            <div className="templates">
              {templates().map((x) => (
                <button key={x.id} className={`template ${tpl === x.id ? "active" : ""}`} onClick={() => setTpl(x.id)}>
                  <div className="title">{x.name}</div>
                  <div className="muted">{x.description}</div>
                  <div className="tiny">{x.bots.map((b) => `${b.emoji} ${b.name}`).join(" · ")}</div>
                </button>
              ))}
            </div>
            <div className="row end">
              <button className="ghost" onClick={() => void call("importTemplate", true).then((ok) => ok && setStep(2))}>
                {t("Dosyadan içe aktar…")}
              </button>
              <button
                className="primary"
                onClick={async () => {
                  // Mevcut kayıtlar varsa asla sessizce silme.
                  const hasData = s.records.length > 0 || s.bots.length > 0;
                  if (hasData && !confirm(t("Mevcut botlar, tablolar ve kayıtlar var. Silinip bu şablonla yeniden başlansın mı? (Hayır dersen mevcut ekibin korunur.)"))) {
                    setStep(2);
                    return;
                  }
                  await call("applyTemplate", tpl, true);
                  setStep(2);
                }}
              >
                {t("Devam")}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>{t("3. Seni tanıyalım")}</h2>
            <label>
              {t("İşletmenin / kurumun adı")}
              <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder={t("örn. Şifa Polikliniği")} />
            </label>
            <label>
              {t("Adın")}
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {t("Kendinden ve işinden bir iki cümle (botların hepsi okur)")}
              <textarea rows={3} value={about} onChange={(e) => setAbout(e.target.value)} placeholder={t("örn. Kliniğin müdürüyüm, 3 hekim ve 2 sekreter çalışıyor. Hafta içi 09-18 açığız.")} />
            </label>
            <div className="row end">
              <button className="ghost" onClick={() => setStep(1)}>
                {t("Geri")}
              </button>
              <button className="primary" onClick={() => void call("updateSettings", { orgName: org, userName: name, userAbout: about, onboarded: true })}>
                {t("Başla")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Bot düzenleyici ----------

const EFFORTS: { id: Effort; label: string }[] = [
  { id: "low", label: "Düşük: hızlı ve ucuz" },
  { id: "medium", label: "Orta (önerilen)" },
  { id: "high", label: "Yüksek: daha dikkatli" },
  { id: "xhigh", label: "Çok yüksek" },
  { id: "max", label: "En yüksek: yavaş, pahalı" },
];
const EMOJIS = ["🤖", "🧭", "📅", "🧾", "💰", "📦", "🛒", "🏠", "🤝", "🍽️", "🥕", "🔎", "📋", "💼", "📞", "✉️", "📊", "🩺", "⚖️", "🚚", "🎓"];

export function BotEditor({ s, bot, onClose }: { s: PublicState; bot: Bot | null; onClose: () => void }) {
  const [d, setD] = useState<Bot>(
    bot ? structuredClone(bot) : { id: uid(), name: "", emoji: "🤖", role: "", instructions: "", lead: false, tools: ["records", "memory"], approval: "ask", effort: "medium" },
  );
  const emojis = EMOJIS.includes(d.emoji) ? EMOJIS : [d.emoji, ...EMOJIS];
  const toggle = (g: ToolGroup) => setD({ ...d, tools: d.tools.includes(g) ? d.tools.filter((x) => x !== g) : [...d.tools, g] });
  const save = () => {
    if (!d.name.trim()) return alert(t("Bot adı gerekli."));
    if (s.bots.some((b) => b.id !== d.id && b.name.toLocaleLowerCase(locale()) === d.name.trim().toLocaleLowerCase(locale()))) return alert(t("Bu adda bir bot zaten var."));
    void call("saveBot", { ...d, name: d.name.trim(), role: d.role.trim() || t("Ekip üyesi"), folder: (d.folder ?? "").replace(/\s+/g, " ").trim().slice(0, 40) });
    onClose();
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{bot ? t("{name} botunu düzenle", { name: bot.name }) : t("Yeni bot")}</h2>
        <div className="row">
          <label className="grow">
            {t("Ad")}
            <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={t("örn. Randevu")} />
          </label>
          <label>
            {t("Simge")}
            <select value={d.emoji} onChange={(e) => setD({ ...d, emoji: e.target.value })}>
              {emojis.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t("Görevi")}
          <input value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })} placeholder={t("örn. Randevu sorumlusu")} />
        </label>
        <label>
          {t("Klasör (isteğe bağlı)")}
          <input list="bot-folders" value={d.folder ?? ""} onChange={(e) => setD({ ...d, folder: e.target.value })} placeholder={t("örn. Muhasebe — boş bırakırsan klasörsüz kalır")} />
          <datalist id="bot-folders">
            {[...new Set(s.bots.map((b) => b.folder).filter((f): f is string => !!f))]
              .sort((a, b) => a.localeCompare(b, locale()))
              .map((f) => (
                <option key={f} value={f} />
              ))}
          </datalist>
        </label>
        <label>
          {t("Talimatlar: nasıl çalışsın, nelere dikkat etsin")}
          <textarea rows={5} value={d.instructions} onChange={(e) => setD({ ...d, instructions: e.target.value })} />
        </label>
        <div className="section-title">{t("Araçlar")}</div>
        <div className="checks">
          {(Object.keys(TOOL_GROUP_LABELS) as ToolGroup[]).map((g) => (
            <label key={g} className="check">
              <input type="checkbox" checked={d.tools.includes(g)} onChange={() => toggle(g)} />
              <span>
                <b>{t(TOOL_GROUP_LABELS[g].title)}</b> <span className="muted">{t(TOOL_GROUP_LABELS[g].detail)}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="row">
          <label className="grow">
            {t("Onay")}
            <select value={d.approval} onChange={(e) => setD({ ...d, approval: e.target.value as Bot["approval"] })}>
              <option value="ask">{t("Yazan/gönderen her işlemden önce sor")}</option>
              <option value="auto">{t("Sormadan yap (silme ve ödeme yine sorulur)")}</option>
            </select>
          </label>
          <label className="grow">
            {t("Düşünme düzeyi")}
            <select value={d.effort} onChange={(e) => setD({ ...d, effort: e.target.value as Effort })}>
              {EFFORTS.map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Model
          <select value={d.model ?? ""} onChange={(e) => setD({ ...d, model: e.target.value || undefined })}>
            <option value="">
              {t("Varsayılan")} ({t(MODELS.find((m) => m.id === s.settings.model)?.label ?? s.settings.model)})
            </option>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={d.lead} onChange={(e) => setD({ ...d, lead: e.target.checked })} />
          <span>{t("Ekip lideri (ana bot)")}</span>
        </label>
        <div className="row end">
          {bot && s.bots.length > 1 && (
            <button
              className="ghost danger-text"
              onClick={() => {
                if (confirm(t("{name} botu ve sohbet geçmişi silinsin mi?", { name: bot.name }))) {
                  void call("deleteBot", bot.id);
                  onClose();
                }
              }}
            >
              {t("Botu sil")}
            </button>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button className="primary" onClick={save}>
            {t("Kaydet")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Hafıza ----------

export function MemoryView({ s }: { s: PublicState }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const who = (id: string) => (id === "you" ? t("Sen") : (s.bots.find((b) => b.id === id)?.name ?? "Bot"));
  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("Hafıza")}</h1>
        <span className="muted">{t("Ekibin ortak hafızası. Bütün botlar bunları bilir. Sen de ekleyip düzeltebilirsin.")}</span>
      </header>
      <div className="row">
        <input
          className="grow"
          placeholder={t("örn. Cumartesi günleri 10-14 arası açığız.")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              void call("addMemory", text);
              setText("");
            }
          }}
        />
        <button
          className="primary"
          disabled={!text.trim()}
          onClick={() => {
            void call("addMemory", text);
            setText("");
          }}
        >
          {t("Ekle")}
        </button>
      </div>
      <div className="list">
        {s.memory.map((m) => (
          <div key={m.id} className="list-item">
            {editing === m.id ? (
              <>
                <input className="grow" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                <button
                  className="primary small"
                  onClick={() => {
                    void call("updateMemory", m.id, draft);
                    setEditing(null);
                  }}
                >
                  {t("Kaydet")}
                </button>
              </>
            ) : (
              <>
                <div className="grow">
                  {m.text}
                  <div className="tiny muted">
                    {who(m.by)} · {timeAgo(m.at)}
                  </div>
                </div>
                <button
                  className="ghost small"
                  onClick={() => {
                    setEditing(m.id);
                    setDraft(m.text);
                  }}
                >
                  {t("Düzenle")}
                </button>
                <button className="ghost small" onClick={() => void call("deleteMemory", m.id)}>
                  {t("Sil")}
                </button>
              </>
            )}
          </div>
        ))}
        {!s.memory.length && <div className="muted center">{t("Hafıza boş.")}</div>}
      </div>
    </div>
  );
}

// ---------- Ekran görevleri ----------

const TASK_STATE: Record<string, string> = { running: "Çalışıyor", paused: "Onay bekliyor", done: "Bitti", failed: "Hata", stopped: "Durduruldu" };

export function TasksView({ s, onWatch }: { s: PublicState; onWatch: (botId: string) => void }) {
  const [open, setOpen] = useState<string | null>(s.tasks[0]?.id ?? null);
  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("Ekran görevleri")}</h1>
        <span className="muted">{t("Botların kendi tarayıcılarında yaptığı işler. İzleyebilir, kontrolü alabilir veya durdurabilirsin.")}</span>
        <span className="spacer" />
        <button className="ghost" onClick={() => void call("clearFinishedTasks")}>
          {t("Bitenleri temizle")}
        </button>
      </header>
      <div className="list">
        {s.tasks.map((task) => {
          const bot = s.bots.find((b) => b.id === task.botId);
          const live = task.state === "running" || task.state === "paused";
          return (
            <div key={task.id} className={`task ${task.state}`}>
              <div className="row" onClick={() => setOpen(open === task.id ? null : task.id)}>
                <span>{bot?.emoji}</span>
                <div className="grow">
                  <b>{task.goal.slice(0, 140)}</b>
                  <div className="tiny muted">
                    {bot?.name} · {timeAgo(task.startedAt)} · {t("{n} adım", { n: task.steps.length })}
                  </div>
                </div>
                <span className={`pill ${task.state}`}>{task.userControl ? t("Kontrol sende") : t(TASK_STATE[task.state])}</span>
                {bot && (
                  <button
                    className="ghost small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onWatch(bot.id);
                    }}
                  >
                    {t("İzle")}
                  </button>
                )}
                {live && (
                  <>
                    <button
                      className="ghost small"
                      onClick={(e) => {
                        e.stopPropagation();
                        void call("setUserControl", task.id, !task.userControl);
                      }}
                    >
                      {task.userControl ? t("Kontrolü ver") : t("Kontrolü al")}
                    </button>
                    <button
                      className="danger small"
                      onClick={(e) => {
                        e.stopPropagation();
                        void call("stopTask", task.id);
                      }}
                    >
                      {t("Durdur")}
                    </button>
                  </>
                )}
              </div>
              {open === task.id && (
                <div className="steps">
                  {task.steps.map((st, i) => (
                    <div key={i} className="step">
                      <span className="tiny muted">{new Date(st.at).toLocaleTimeString(locale())}</span> {st.text}
                    </div>
                  ))}
                  {task.result && (
                    <div className="result">
                      {t("Sonuç:")} {task.result}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!s.tasks.length && (
          <div className="muted center">
            {t('Henüz ekran görevi yok. "Ekran" aracı açık bir bottan bir web sitesinde iş yapmasını iste, örn. "Şu sitedeki fiyat listesini tabloya aktar".')}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Onaylar ----------

export function ApprovalsView({ s }: { s: PublicState }) {
  const pending = s.approvals.filter((a) => a.state === "pending");
  const done = s.approvals.filter((a) => a.state !== "pending").slice(0, 50);
  const bot = (id: string) => s.bots.find((b) => b.id === id);
  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("Onaylar")}</h1>
        <span className="muted">{t("Botlar yazan, gönderen veya silen işlemlerden önce burada senden onay ister.")}</span>
      </header>
      {pending.map((a) => (
        <div key={a.id}>
          <div className="tiny muted">
            {bot(a.botId)?.emoji} {bot(a.botId)?.name}
          </div>
          <ApprovalCard a={a} />
        </div>
      ))}
      {!pending.length && <div className="muted center">{t("Bekleyen onay yok.")}</div>}
      {!!done.length && <div className="section-title">{t("Geçmiş")}</div>}
      {done.map((a) => (
        <div key={a.id}>
          <div className="tiny muted">
            {bot(a.botId)?.emoji} {bot(a.botId)?.name}
          </div>
          <ApprovalCard a={a} />
        </div>
      ))}
    </div>
  );
}

// ---------- Ayarlar ----------

export function SettingsView({ s }: { s: PublicState }) {
  const st = s.settings;
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [tpl, setTpl] = useState(templates()[0].id);
  const upd = (p: Partial<typeof st>) => void call("updateSettings", p);
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>{t("Ayarlar")}</h1>
      </header>

      <div className="card">
        <h3>{t("Dil")}</h3>
        <div className="row">
          <LangSwitch lang={st.language} />
          <span className="muted">{t("Arayüzün ve botların cevaplarının dili.")}</span>
        </div>
      </div>

      <PinCard s={s} />

      <div className="card">
        <h3>{t("Sen ve işletmen")}</h3>
        <label>
          {t("İşletme / kurum adı")}
          <input defaultValue={st.orgName} onBlur={(e) => upd({ orgName: e.target.value })} />
        </label>
        <label>
          {t("Alan (sektör)")}
          <input defaultValue={st.orgKind} onBlur={(e) => upd({ orgKind: e.target.value })} placeholder={t("örn. Sağlık, Lojistik, Eğitim…")} />
        </label>
        <label>
          {t("Adın")}
          <input defaultValue={st.userName} onBlur={(e) => upd({ userName: e.target.value })} />
        </label>
        <label>
          {t("Hakkında (botların hepsi okur)")}
          <textarea rows={3} defaultValue={st.userAbout} onBlur={(e) => upd({ userAbout: e.target.value })} />
        </label>
      </div>

      <div className="card">
        <h3>Claude</h3>
        <label>
          {t("Varsayılan model")}
          <select value={st.model} onChange={(e) => upd({ model: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("API anahtarı")} {st.hasApiKey ? t("(kayıtlı ✓)") : t("(yok)")}
          <div className="row">
            <input className="grow" type="password" placeholder={t("Yeni anahtar: sk-ant-...")} value={key} onChange={(e) => setKey(e.target.value)} />
            <button
              className="primary"
              disabled={!key.trim()}
              onClick={async () => {
                const r = await call<{ ok: boolean; error?: string }>("setApiKey", key);
                setMsg(r.ok ? t("Anahtar kaydedildi.") : (r.error ?? t("Hata")));
                if (r.ok) setKey("");
              }}
            >
              {t("Kaydet")}
            </button>
          </div>
        </label>
        {msg && <div className="muted">{msg}</div>}
      </div>

      <div className="card">
        <h3>{t("Şablonlar")}</h3>
        <p className="muted">{t("Ekibini ve tablo yapını dosyaya aktarıp başka bir işletmede kullanabilirsin. Kayıtlar ve sohbetler dosyaya girmez.")}</p>
        <div className="row">
          <button className="ghost" onClick={() => void call("exportTemplate")}>
            {t("Ekibi dışa aktar…")}
          </button>
          <button className="ghost" onClick={() => void call("importTemplate", false)}>
            {t("Şablon ekle (içe aktar)…")}
          </button>
        </div>
        <div className="row">
          <select className="grow" value={tpl} onChange={(e) => setTpl(e.target.value)}>
            {templates().map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={() => void call("applyTemplate", tpl, false)}>
            {t("Botlarını ve tablolarını ekle")}
          </button>
          <button
            className="ghost danger-text"
            onClick={() => {
              if (confirm(t("Mevcut botlar, sohbetler, tablolar ve tüm kayıtlar silinip bu şablonla yeniden başlanacak. Emin misin?"))) void call("applyTemplate", tpl, true);
            }}
          >
            {t("Sıfırla ve uygula")}
          </button>
        </div>
      </div>
    </div>
  );
}
