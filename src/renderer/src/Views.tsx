import { useState } from "react";
import { MODELS, TOOL_GROUP_LABELS, type Bot, type Effort, type PublicState, type ToolGroup } from "../../shared/types";
import { templates } from "../../shared/templates";
import { LANGS, locale, t, type Lang } from "../../shared/i18n";
import { call, timeAgo, uid } from "./api";
import { ApprovalCard } from "./Chat";
import logo from "./assets/logo.png";

// ---------- Language switch ----------

/** EN / TR switch. Works even while the owner lock is closed. */
export function LangSwitch({ lang }: { lang?: Lang }) {
  const cur = lang === "tr" ? "tr" : "en";
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
      setErr(t("Wrong PIN."));
      setPin("");
    }
  };
  return (
    <div className="onboarding">
      <div className="card gate">
        <div className="emoji huge">🔒</div>
        <h2>{t("Owner login")}</h2>
        <p className="muted">{why}</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          placeholder={t("Owner PIN")}
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
            {t("Unlock")}
          </button>
        </div>
        <p className="tiny muted">{t("Locks again after 30 minutes of inactivity.")}</p>
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
    setMsg(r.ok ? (next ? t("PIN saved.") : t("PIN removed; lock is off.")) : (r.error ?? t("Error")));
    if (r.ok) {
      setCur("");
      setPin("");
    }
  };
  return (
    <div className="card">
      <h3>{t("Owner PIN")}</h3>
      <p className="muted">
        {t(
          "The team lead ({name}) has admin rights: it adds and deletes bots, grants permissions and creates tables. If you set a PIN, only the business owner who knows it can reach the lead, Settings and bot/table editing. Staff can still talk to the other bots and use the records.",
          { name: s.bots.find((b) => b.lead)?.name ?? "" },
        )}
      </p>
      {s.owner.hasPin && (
        <label>
          {t("Current PIN")}
          <input type="password" inputMode="numeric" value={cur} onChange={(e) => setCur(e.target.value)} />
        </label>
      )}
      <label>
        {s.owner.hasPin ? t("New PIN (4-8 digits)") : t("PIN (4-8 digits)")}
        <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
      </label>
      <div className="row">
        <button className="primary" disabled={pin.length < 4} onClick={() => void save(pin)}>
          {s.owner.hasPin ? t("Change PIN") : t("Set PIN")}
        </button>
        {s.owner.hasPin && (
          <button className="ghost danger-text" onClick={() => void save("")}>
            {t("Remove PIN")}
          </button>
        )}
        {msg && <span className="muted">{msg}</span>}
      </div>
    </div>
  );
}

// ---------- First run ----------

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
            <img className="logo-img" src={logo} alt="" /> Teds
          </div>
          <span className="spacer" />
          <LangSwitch lang={s.settings.language} />
        </div>
        <p className="muted">{t("An editable AI bot team for any kind of management work.")}</p>

        {step === 0 && (
          <>
            <h2>{t("1. Claude API key")}</h2>
            <p className="muted">
              {t("The bots run on Claude. You can get your key at")}{" "}
              <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
                platform.claude.com
              </a>
              . {t("The key is stored on this computer with Windows encryption.")}
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
                  else setErr(r.error ?? t("Could not verify the key"));
                }}
              >
                {checking ? t("Checking…") : t("Continue")}
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>{t("2. Pick your field")}</h2>
            <p className="muted">{t("Start with a ready-made team and tables. You can change everything later.")}</p>
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
                {t("Import from file…")}
              </button>
              <button
                className="primary"
                onClick={async () => {
                  // Never silently delete existing data.
                  const hasData = s.records.length > 0 || s.bots.length > 0;
                  if (hasData && !confirm(t("You already have bots, tables and records. Delete them and start over with this template? (Choose Cancel to keep your current team.)"))) {
                    setStep(2);
                    return;
                  }
                  await call("applyTemplate", tpl, true);
                  setStep(2);
                }}
              >
                {t("Continue")}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>{t("3. About you")}</h2>
            <label>
              {t("Name of your business / organization")}
              <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder={t("e.g. Riverside Clinic")} />
            </label>
            <label>
              {t("Your name")}
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {t("A sentence or two about you and your work (every bot reads this)")}
              <textarea rows={3} value={about} onChange={(e) => setAbout(e.target.value)} placeholder={t("e.g. I run the clinic; we have 3 doctors and 2 receptionists. Open weekdays 9 to 6.")} />
            </label>
            <div className="row end">
              <button className="ghost" onClick={() => setStep(1)}>
                {t("Back")}
              </button>
              <button className="primary" onClick={() => void call("updateSettings", { orgName: org, userName: name, userAbout: about, onboarded: true })}>
                {t("Start")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Bot editor ----------

const EFFORTS: { id: Effort; label: string }[] = [
  { id: "low", label: "Low: fast and cheap" },
  { id: "medium", label: "Medium (recommended)" },
  { id: "high", label: "High: more careful" },
  { id: "xhigh", label: "Very high" },
  { id: "max", label: "Max: slow, expensive" },
];
const EMOJIS = ["🤖", "🧭", "📅", "🧾", "💰", "📦", "🛒", "🏠", "🤝", "🍽️", "🥕", "🔎", "📋", "💼", "📞", "✉️", "📊", "🩺", "⚖️", "🚚", "🎓"];

export function BotEditor({ s, bot, onClose }: { s: PublicState; bot: Bot | null; onClose: () => void }) {
  const [d, setD] = useState<Bot>(
    bot ? structuredClone(bot) : { id: uid(), name: "", emoji: "🤖", role: "", instructions: "", lead: false, tools: ["records", "memory"], approval: "ask", effort: "medium" },
  );
  const emojis = EMOJIS.includes(d.emoji) ? EMOJIS : [d.emoji, ...EMOJIS];
  const toggle = (g: ToolGroup) => setD({ ...d, tools: d.tools.includes(g) ? d.tools.filter((x) => x !== g) : [...d.tools, g] });
  const save = () => {
    if (!d.name.trim()) return alert(t("Bot name is required."));
    if (s.bots.some((b) => b.id !== d.id && b.name.toLocaleLowerCase(locale()) === d.name.trim().toLocaleLowerCase(locale()))) return alert(t("A bot with this name already exists."));
    void call("saveBot", { ...d, name: d.name.trim(), role: d.role.trim() || t("Team member"), folder: (d.folder ?? "").replace(/\s+/g, " ").trim().slice(0, 40) });
    onClose();
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{bot ? t("Edit {name}", { name: bot.name }) : t("New bot")}</h2>
        <div className="row">
          <label className="grow">
            {t("Name")}
            <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={t("e.g. Appointments")} />
          </label>
          <label>
            {t("Icon")}
            <select value={d.emoji} onChange={(e) => setD({ ...d, emoji: e.target.value })}>
              {emojis.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t("Role")}
          <input value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })} placeholder={t("e.g. Appointment manager")} />
        </label>
        <label>
          {t("Folder (optional)")}
          <input list="bot-folders" value={d.folder ?? ""} onChange={(e) => setD({ ...d, folder: e.target.value })} placeholder={t("e.g. Accounting — leave empty for no folder")} />
          <datalist id="bot-folders">
            {[...new Set(s.bots.map((b) => b.folder).filter((f): f is string => !!f))]
              .sort((a, b) => a.localeCompare(b, locale()))
              .map((f) => (
                <option key={f} value={f} />
              ))}
          </datalist>
        </label>
        <label>
          {t("Instructions: how it should work, what to watch out for")}
          <textarea rows={5} value={d.instructions} onChange={(e) => setD({ ...d, instructions: e.target.value })} />
        </label>
        <div className="section-title">{t("Tools")}</div>
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
            {t("Approval")}
            <select value={d.approval} onChange={(e) => setD({ ...d, approval: e.target.value as Bot["approval"] })}>
              <option value="ask">{t("Ask before anything that writes or sends")}</option>
              <option value="auto">{t("Act without asking (deletes and payments still ask)")}</option>
            </select>
          </label>
          <label className="grow">
            {t("Thinking level")}
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
              {t("Default")} ({t(MODELS.find((m) => m.id === s.settings.model)?.label ?? s.settings.model)})
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
          <span>{t("Team lead (main bot)")}</span>
        </label>
        <div className="row end">
          {bot && s.bots.length > 1 && (
            <button
              className="ghost danger-text"
              onClick={() => {
                if (confirm(t("Delete {name} and its chat history?", { name: bot.name }))) {
                  void call("deleteBot", bot.id);
                  onClose();
                }
              }}
            >
              {t("Delete bot")}
            </button>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="primary" onClick={save}>
            {t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Memory ----------

export function MemoryView({ s }: { s: PublicState }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const who = (id: string) => (id === "you" ? t("You") : (s.bots.find((b) => b.id === id)?.name ?? "Bot"));
  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("Memory")}</h1>
        <span className="muted">{t("The team's shared memory. Every bot knows these. You can add and edit them too.")}</span>
      </header>
      <div className="row">
        <input
          className="grow"
          placeholder={t("e.g. We're open 10 to 2 on Saturdays.")}
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
          {t("Add")}
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
                  {t("Save")}
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
                  {t("Edit")}
                </button>
                <button className="ghost small" onClick={() => void call("deleteMemory", m.id)}>
                  {t("Delete")}
                </button>
              </>
            )}
          </div>
        ))}
        {!s.memory.length && <div className="muted center">{t("Memory is empty.")}</div>}
      </div>
    </div>
  );
}

// ---------- Screen tasks ----------

const TASK_STATE: Record<string, string> = { running: "Running", paused: "Waiting for approval", done: "Done", failed: "Error", stopped: "Stopped" };

export function TasksView({ s, onWatch }: { s: PublicState; onWatch: (botId: string) => void }) {
  const [open, setOpen] = useState<string | null>(s.tasks[0]?.id ?? null);
  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("Screen tasks")}</h1>
        <span className="muted">{t("Work the bots do in their own browsers. You can watch, take control or stop them.")}</span>
        <span className="spacer" />
        <button className="ghost" onClick={() => void call("clearFinishedTasks")}>
          {t("Clear finished")}
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
                    {bot?.name} · {timeAgo(task.startedAt)} · {t("{n} steps", { n: task.steps.length })}
                  </div>
                </div>
                <span className={`pill ${task.state}`}>{task.userControl ? t("You're in control") : t(TASK_STATE[task.state])}</span>
                {bot && (
                  <button
                    className="ghost small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onWatch(bot.id);
                    }}
                  >
                    {t("Watch")}
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
                      {task.userControl ? t("Hand back control") : t("Take control")}
                    </button>
                    <button
                      className="danger small"
                      onClick={(e) => {
                        e.stopPropagation();
                        void call("stopTask", task.id);
                      }}
                    >
                      {t("Stop")}
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
                      {t("Result:")} {task.result}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!s.tasks.length && (
          <div className="muted center">
            {t("No screen tasks yet. Ask a bot with the \"Screen\" tool to do something on a website, e.g. \"Copy the price list from this site into a table\".")}
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
        <h1>{t("Approvals")}</h1>
        <span className="muted">{t("Bots ask for your approval here before anything that writes, sends or deletes.")}</span>
      </header>
      {pending.map((a) => (
        <div key={a.id}>
          <div className="tiny muted">
            {bot(a.botId)?.emoji} {bot(a.botId)?.name}
          </div>
          <ApprovalCard a={a} />
        </div>
      ))}
      {!pending.length && <div className="muted center">{t("No pending approvals.")}</div>}
      {!!done.length && <div className="section-title">{t("History")}</div>}
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
        <h1>{t("Settings")}</h1>
      </header>

      <div className="card">
        <h3>{t("Language")}</h3>
        <div className="row">
          <LangSwitch lang={st.language} />
          <span className="muted">{t("Language of the interface and of the bots' replies.")}</span>
        </div>
      </div>

      <PinCard s={s} />

      <div className="card">
        <h3>{t("You and your business")}</h3>
        <label>
          {t("Business / organization name")}
          <input defaultValue={st.orgName} onBlur={(e) => upd({ orgName: e.target.value })} />
        </label>
        <label>
          {t("Field (industry)")}
          <input defaultValue={st.orgKind} onBlur={(e) => upd({ orgKind: e.target.value })} placeholder={t("e.g. Healthcare, Logistics, Education…")} />
        </label>
        <label>
          {t("Your name")}
          <input defaultValue={st.userName} onBlur={(e) => upd({ userName: e.target.value })} />
        </label>
        <label>
          {t("About (every bot reads this)")}
          <textarea rows={3} defaultValue={st.userAbout} onBlur={(e) => upd({ userAbout: e.target.value })} />
        </label>
      </div>

      <div className="card">
        <h3>Claude</h3>
        <label>
          {t("Default model")}
          <select value={st.model} onChange={(e) => upd({ model: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("API key")} {st.hasApiKey ? t("(saved ✓)") : t("(none)")}
          <div className="row">
            <input className="grow" type="password" placeholder={t("New key: sk-ant-...")} value={key} onChange={(e) => setKey(e.target.value)} />
            <button
              className="primary"
              disabled={!key.trim()}
              onClick={async () => {
                const r = await call<{ ok: boolean; error?: string }>("setApiKey", key);
                setMsg(r.ok ? t("Key saved.") : (r.error ?? t("Error")));
                if (r.ok) setKey("");
              }}
            >
              {t("Save")}
            </button>
          </div>
        </label>
        {msg && <div className="muted">{msg}</div>}
      </div>

      <div className="card">
        <h3>{t("Templates")}</h3>
        <p className="muted">{t("Export your team and table structure to a file and reuse it at another business. Records and chats are not included.")}</p>
        <div className="row">
          <button className="ghost" onClick={() => void call("exportTemplate")}>
            {t("Export team…")}
          </button>
          <button className="ghost" onClick={() => void call("importTemplate", false)}>
            {t("Add template (import)…")}
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
            {t("Add its bots and tables")}
          </button>
          <button
            className="ghost danger-text"
            onClick={() => {
              if (confirm(t("All current bots, chats, tables and records will be deleted and replaced with this template. Are you sure?"))) void call("applyTemplate", tpl, true);
            }}
          >
            {t("Reset and apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
