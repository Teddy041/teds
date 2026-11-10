import { useState, type DragEvent } from "react";
import type { Bot, PublicState } from "../../shared/types";
import { call } from "./api";
import { locale, t } from "../../shared/i18n";

// Kenar çubuğundaki bot listesi: klasörsüz botlar (lider dahil) üstte, sonra klasörler.
// Sahip botları sürükleyip bırakarak düzenler:
//   - bir botu klasörsüz başka bir botun üstüne bırakmak ikisi için yeni bir klasör açar,
//   - klasördeki bir botun ya da klasör başlığının üstüne bırakmak botu o klasöre taşır,
//   - "Klasörden çıkar" alanına bırakmak botu klasörden çıkarır.
// Klasöre sağ tıklayınca (veya çift tıklayınca) adı değiştirilir. Açık/kapalı durumu bu bilgisayarda hatırlanır.

const KEY = "teds.closedFolders";
const MIME = "application/x-teds-bot";

function loadClosed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveClosed(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* hatırlanamazsa sorun değil */
  }
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 40);

interface Props {
  s: PublicState;
  bots: Bot[];
  activeId?: string;
  owner: boolean;
  onPick: (id: string) => void;
}

export function BotFolders({ s, bots, activeId, owner, onPick }: Props) {
  const [closed, setClosed] = useState<string[]>(loadClosed);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  /** Üstünde sürüklenen hedef: "bot:<id>", "folder:<ad>" veya "out". */
  const [over, setOver] = useState<string | null>(null);

  const loose = bots.filter((b) => !b.folder);
  const folders = [...new Set(bots.map((b) => b.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, locale()));
  const dragged = bots.find((b) => b.id === dragId);

  const setClosedList = (next: string[]) => {
    setClosed(next);
    saveClosed(next);
  };
  const toggle = (f: string) => setClosedList(closed.includes(f) ? closed.filter((x) => x !== f) : [...closed, f]);

  const moveTo = async (b: Bot, folder: string): Promise<void> => {
    if ((b.folder ?? "") !== folder) await call("saveBot", { ...b, folder });
  };

  const startRename = (f: string) => {
    if (!owner) return;
    setNewName(f);
    setRenaming(f);
  };

  const rename = async (from: string) => {
    const to = clean(newName);
    setRenaming(null);
    if (to === from) return;
    for (const b of bots.filter((x) => x.folder === from)) await moveTo(b, to);
    if (closed.includes(from)) setClosedList(closed.filter((x) => x !== from).concat(to ? [to] : []));
  };

  const freshName = () => {
    const base = t("Yeni klasör");
    let n = base;
    for (let i = 2; folders.includes(n); i++) n = `${base} ${i}`;
    return n;
  };

  // --- Sürükle bırak ---
  const dragProps = (b: Bot) =>
    owner
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.setData(MIME, b.id);
            e.dataTransfer.effectAllowed = "move";
            setDragId(b.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setOver(null);
          },
        }
      : {};

  const dropProps = (target: string, onDrop: (b: Bot) => void | Promise<void>) =>
    owner
      ? {
          onDragOver: (e: DragEvent) => {
            if (!dragId || target === `bot:${dragId}`) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            if (over !== target) setOver(target);
          },
          onDragLeave: (e: DragEvent) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === target ? null : o));
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const b = bots.find((x) => x.id === e.dataTransfer.getData(MIME));
            setDragId(null);
            setOver(null);
            if (b && target !== `bot:${b.id}`) void onDrop(b);
          },
        }
      : {};

  const dropOnBot = (target: Bot) => async (b: Bot) => {
    if (target.folder) return moveTo(b, target.folder);
    // İki klasörsüz bot: yeni klasör aç ve hemen adını sor.
    const name = freshName();
    await moveTo(target, name);
    await moveTo(b, name);
    if (closed.includes(name)) setClosedList(closed.filter((x) => x !== name));
    setNewName(name);
    setRenaming(name);
  };

  const item = (b: Bot, nested: boolean) => {
    const c = s.chats[b.id];
    const target = `bot:${b.id}`;
    return (
      <button
        key={b.id}
        className={`bot-item ${nested ? "nested" : ""} ${activeId === b.id ? "active" : ""} ${over === target ? "drop-target" : ""} ${dragId === b.id ? "dragging" : ""}`}
        onClick={() => onPick(b.id)}
        title={owner ? t("Başka bir botun üstüne sürükleyip bırakarak klasör oluştur") : undefined}
        {...dragProps(b)}
        {...dropProps(target, dropOnBot(b))}
      >
        <span className="emoji">{b.emoji}</span>
        <span className="bot-text">
          <span className="bot-name">
            {b.name}
            {b.lead && <span className="tag">{t("lider")}</span>}
            {b.lead && !owner && <span title={t("Sadece işletme sahibi")}>🔒</span>}
          </span>
          <span className="bot-role">{c?.busy ? t("çalışıyor…") : b.role}</span>
        </span>
        {c?.busy && <span className="dot" />}
      </button>
    );
  };

  return (
    <>
      {dragged?.folder && (
        <div className={`drop-out ${over === "out" ? "drop-target" : ""}`} {...dropProps("out", (b) => moveTo(b, ""))}>
          {t("Klasörden çıkarmak için buraya bırak")}
        </div>
      )}
      {loose.map((b) => item(b, false))}
      {folders.map((f) => {
        const inside = bots.filter((b) => b.folder === f);
        const open = !closed.includes(f);
        const busy = inside.some((b) => s.chats[b.id]?.busy);
        // Kapalı klasördeki seçili bot görünmez olmasın diye başlık da vurgulanır.
        const holdsActive = !open && inside.some((b) => b.id === activeId);
        const target = `folder:${f}`;
        return (
          <div key={f} className="bot-folder">
            {renaming === f ? (
              <input
                className="folder-rename"
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                value={newName}
                placeholder={t("Klasör adı (boş bırakırsan klasör kalkar)")}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => void rename(f)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void rename(f);
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button
                className={`folder-head ${holdsActive ? "active" : ""} ${over === target ? "drop-target" : ""}`}
                onClick={() => toggle(f)}
                onDoubleClick={() => startRename(f)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  startRename(f);
                }}
                title={owner ? t("Tıkla: aç/kapa · Sağ tık: adını değiştir · Üstüne bot bırak: klasöre ekle") : t("Açmak/kapamak için tıkla")}
                aria-expanded={open}
                {...dropProps(target, (b) => moveTo(b, f))}
              >
                <span className={`chev ${open ? "open" : ""}`}>▸</span>
                <span className="folder-icon">{open ? "📂" : "📁"}</span>
                <span className="folder-name">{f}</span>
                {busy && !open && <span className="dot" />}
                <span className="folder-count">{inside.length}</span>
              </button>
            )}
            {open && inside.map((b) => item(b, true))}
          </div>
        );
      })}
      {owner && bots.length > 1 && !folders.length && !dragId && <div className="folder-hint muted tiny">{t("İpucu: bir botu başka bir botun üstüne sürükleyip bırakınca klasör oluşur.")}</div>}
    </>
  );
}
