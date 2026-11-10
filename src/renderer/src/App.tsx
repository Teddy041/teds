import { useEffect, useState } from "react";
import { useAppState } from "./api";
import { ChatView } from "./Chat";
import { RecordsView } from "./Records";
import { ApprovalsView, BotEditor, LangSwitch, MemoryView, Onboarding, OwnerGate, SettingsView, TasksView } from "./Views";
import { ProfileBox } from "./Profile";
import { BotFolders } from "./BotFolders";
import { setLang, t } from "../../shared/i18n";
import type { Bot } from "../../shared/types";

type Page = "chat" | "records" | "memory" | "tasks" | "approvals" | "settings" | "login";

export function App() {
  const s = useAppState();
  const [page, setPage] = useState<Page>("chat");
  const [botId, setBotId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Bot | "new" | null>(null);
  const [watchBot, setWatchBot] = useState<string | null>(null);

  // The language is set before every render, so all components use the same language.
  setLang(s?.settings.language);
  useEffect(() => {
    document.documentElement.lang = s?.settings.language === "tr" ? "tr" : "en";
  }, [s?.settings.language]);

  if (!s) return <div className="loading">…</div>;
  if (!s.settings.onboarded || !s.settings.hasApiKey || !s.bots.length) return <Onboarding s={s} />;

  const current = s.bots.find((b) => b.id === botId) ?? s.bots.find((b) => b.lead) ?? s.bots[0];
  const pending = s.approvals.filter((a) => a.state === "pending").length;
  const runningTasks = s.tasks.filter((x) => x.state === "running" || x.state === "paused").length;
  const sorted = [...s.bots].sort((a, b) => Number(b.lead) - Number(a.lead));
  const owner = s.owner.unlocked;

  const nav: { id: Page; label: string; badge?: number }[] = [
    { id: "records", label: `📁 ${t("Records")}` },
    { id: "memory", label: `🧠 ${t("Memory")}` },
    { id: "tasks", label: `🖥️ ${t("Screen tasks")}`, badge: runningTasks },
    { id: "approvals", label: `✅ ${t("Approvals")}`, badge: pending },
    { id: "settings", label: `⚙️ ${t("Settings")}` },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-row">
            <span>
              <span className="logo">◆</span> Teds
            </span>
            <LangSwitch lang={s.settings.language} />
          </div>
          {s.settings.orgName && <div className="org">{s.settings.orgName}</div>}
        </div>
        <div className="section-title">{t("Team")}</div>
        <div className="bots">
          <BotFolders
            s={s}
            bots={sorted}
            activeId={page === "chat" ? current?.id : undefined}
            owner={owner}
            onPick={(id) => {
              setBotId(id);
              setPage("chat");
            }}
          />
        </div>
        {owner && (
          <button className="ghost add-bot" onClick={() => setEditing("new")}>
            {t("+ Add bot")}
          </button>
        )}
        <div className="section-title">{t("Manage")}</div>
        {nav
          .filter((n) => owner || n.id !== "settings")
          .map((n) => (
            <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
              {n.label}
              {!!n.badge && <span className="badge">{n.badge}</span>}
            </button>
          ))}
        <div className="spacer" />
        <ProfileBox
          s={s}
          onLogin={() => setPage("login")}
          onSettings={() => setPage("settings")}
          onLoggedOut={() => {
            // After logging out, switch to a screen staff can use.
            const firstMate = sorted.find((b) => !b.lead);
            if (firstMate) {
              setBotId(firstMate.id);
              setPage("chat");
            } else setPage("records");
          }}
        />
      </aside>
      <main className="content">
        {page === "chat" &&
          current &&
          (current.lead && !owner ? (
            <OwnerGate why={t("{name} is the team lead; only the business owner can talk to it.", { name: current.name })} />
          ) : (
            <ChatView key={current.id} s={s} bot={current} openScreen={watchBot === current.id} onEdit={owner ? () => setEditing(current) : undefined} />
          ))}
        {page === "records" && <RecordsView s={s} />}
        {page === "memory" && <MemoryView s={s} />}
        {page === "tasks" && (
          <TasksView
            s={s}
            onWatch={(id) => {
              setBotId(id);
              setWatchBot(id);
              setPage(s.bots.find((b) => b.id === id)?.lead && !owner ? "login" : "chat");
            }}
          />
        )}
        {page === "approvals" && <ApprovalsView s={s} />}
        {page === "login" &&
          (owner ? (
            <ChatView s={s} bot={sorted[0]} onEdit={() => setEditing(sorted[0])} />
          ) : (
            <OwnerGate why={t("Log in as the business owner. This unlocks the team lead, Settings and management.")} />
          ))}
        {page === "settings" && (owner ? <SettingsView s={s} /> : <OwnerGate why={t("Settings are only available to the business owner.")} />)}
      </main>
      {editing && <BotEditor s={s} bot={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
