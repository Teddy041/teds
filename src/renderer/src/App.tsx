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

  // Dil her çizimden önce ayarlanır; böylece bütün bileşenler aynı dilde yazar.
  setLang(s?.settings.language);
  useEffect(() => {
    document.documentElement.lang = s?.settings.language === "en" ? "en" : "tr";
  }, [s?.settings.language]);

  if (!s) return <div className="loading">…</div>;
  if (!s.settings.onboarded || !s.settings.hasApiKey || !s.bots.length) return <Onboarding s={s} />;

  const current = s.bots.find((b) => b.id === botId) ?? s.bots.find((b) => b.lead) ?? s.bots[0];
  const pending = s.approvals.filter((a) => a.state === "pending").length;
  const runningTasks = s.tasks.filter((x) => x.state === "running" || x.state === "paused").length;
  const sorted = [...s.bots].sort((a, b) => Number(b.lead) - Number(a.lead));
  const owner = s.owner.unlocked;

  const nav: { id: Page; label: string; badge?: number }[] = [
    { id: "records", label: `📁 ${t("Kayıtlar")}` },
    { id: "memory", label: `🧠 ${t("Hafıza")}` },
    { id: "tasks", label: `🖥️ ${t("Ekran görevleri")}`, badge: runningTasks },
    { id: "approvals", label: `✅ ${t("Onaylar")}`, badge: pending },
    { id: "settings", label: `⚙️ ${t("Ayarlar")}` },
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
        <div className="section-title">{t("Ekip")}</div>
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
            {t("+ Bot ekle")}
          </button>
        )}
        <div className="section-title">{t("Yönetim")}</div>
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
            // Çıkıştan sonra çalışanların kullanabileceği bir ekrana geç.
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
            <OwnerGate why={t("{name} ekip lideridir; onunla sadece işletme sahibi konuşabilir.", { name: current.name })} />
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
            <OwnerGate why={t("İşletme sahibi olarak giriş yap. Ekip lideri, Ayarlar ve yönetim açılır.")} />
          ))}
        {page === "settings" && (owner ? <SettingsView s={s} /> : <OwnerGate why={t("Ayarlar sadece işletme sahibine açıktır.")} />)}
      </main>
      {editing && <BotEditor s={s} bot={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
