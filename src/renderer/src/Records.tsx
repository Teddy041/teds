import { useState } from "react";
import type { Collection, FieldDef, PublicState, RecordRow } from "../../shared/types";
import { locale, t } from "../../shared/i18n";
import { call } from "./api";

// Records: tables the user defines (with editable fields) and the records in them.

const TYPES: { id: FieldDef["type"]; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "longtext", label: "Long text" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "select", label: "Choice" },
];

function slug(label: string) {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return (
    label
      .toLocaleLowerCase("tr")
      .replace(/[çğıöşü]/g, (c) => map[c])
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "field"
  );
}

function CollectionEditor({ c, onClose }: { c: Collection | null; onClose: () => void }) {
  const [draft, setDraft] = useState<Collection>(c ? structuredClone(c) : { id: "", name: "", description: "", fields: [{ key: "ad", label: t("Name"), type: "text" }] });
  const setField = (i: number, p: Partial<FieldDef>) => setDraft({ ...draft, fields: draft.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const save = () => {
    if (!draft.name.trim()) return alert(t("Table name is required."));
    const keys = new Set<string>();
    const fields = draft.fields
      .filter((f) => f.label.trim())
      .map((f) => {
        let key = f.key || slug(f.label);
        while (keys.has(key)) key += "_";
        keys.add(key);
        return { ...f, key, label: f.label.trim() };
      });
    void call("saveCollection", { ...draft, name: draft.name.trim(), fields });
    onClose();
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{c ? t("Edit table") : t("New table")}</h2>
        <label>
          {t("Table name")}
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("e.g. Patients, Orders, Vehicles")} />
        </label>
        <label>
          {t("Description (bots read this)")}
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder={t("What is this table for?")} />
        </label>
        <div className="section-title">{t("Fields")}</div>
        {draft.fields.map((f, i) => (
          <div className="field-row" key={i}>
            <input value={f.label} placeholder={t("Field name")} onChange={(e) => setField(i, { label: e.target.value, key: c?.fields.some((x) => x.key === f.key) ? f.key : "" })} />
            <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldDef["type"] })}>
              {TYPES.map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.label)}
                </option>
              ))}
            </select>
            {f.type === "select" && (
              <input
                placeholder={t("Choices, comma separated")}
                value={(f.options ?? []).join(", ")}
                onChange={(e) =>
                  setField(i, {
                    options: e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
            <button className="ghost small" onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <button className="ghost" onClick={() => setDraft({ ...draft, fields: [...draft.fields, { key: "", label: "", type: "text" }] })}>
          {t("+ Add field")}
        </button>
        <div className="row end">
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

function RecordEditor({ c, row, onClose }: { c: Collection; row: RecordRow | null; onClose: () => void }) {
  const [data, setData] = useState<Record<string, string | number | null>>(row ? { ...row.data } : {});
  const save = () => {
    const clean: Record<string, string | number | null> = {};
    for (const f of c.fields) {
      const v = data[f.key];
      if (v === undefined || v === "") clean[f.key] = null;
      else clean[f.key] = f.type === "number" ? Number(v) : String(v);
    }
    void call("saveRecord", { id: row?.id, collectionId: c.id, data: clean });
    onClose();
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          {c.name}: {row ? t("edit record") : t("new record")}
        </h2>
        {c.fields.map((f) => (
          <label key={f.key}>
            {f.label}
            {f.type === "longtext" ? (
              <textarea rows={3} value={String(data[f.key] ?? "")} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />
            ) : f.type === "select" ? (
              <select value={String(data[f.key] ?? "")} onChange={(e) => setData({ ...data, [f.key]: e.target.value })}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={String(data[f.key] ?? "")} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />
            )}
          </label>
        ))}
        <div className="row end">
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

export function RecordsView({ s }: { s: PublicState }) {
  const [selId, setSelId] = useState<string | null>(null);
  const [editCol, setEditCol] = useState<Collection | "new" | null>(null);
  const [editRow, setEditRow] = useState<RecordRow | "new" | null>(null);
  const [q, setQ] = useState("");
  const col = s.collections.find((c) => c.id === selId) ?? s.collections[0];
  const rows = col
    ? s.records
        .filter((r) => r.collectionId === col.id)
        .filter((r) => !q || Object.values(r.data).some((v) => String(v ?? "").toLocaleLowerCase(locale()).includes(q.toLocaleLowerCase(locale()))))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    : [];

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("Records")}</h1>
        <span className="muted">{t("Bots search, add and update records in these tables. You can change the tables and fields however you like.")}</span>
      </header>
      <div className="tabs">
        {s.collections.map((c) => (
          <button key={c.id} className={`tab ${col?.id === c.id ? "active" : ""}`} onClick={() => setSelId(c.id)}>
            {c.name} <span className="muted">{s.records.filter((r) => r.collectionId === c.id).length}</span>
          </button>
        ))}
        {s.owner.unlocked && (
          <button className="tab ghost" onClick={() => setEditCol("new")}>
            {t("+ Table")}
          </button>
        )}
      </div>
      {col ? (
        <>
          <div className="row">
            <input className="grow" placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="primary" onClick={() => setEditRow("new")}>
              {t("+ Record")}
            </button>
            {s.owner.unlocked && (
              <button className="ghost" onClick={() => setEditCol(col)}>
                {t("Edit table")}
              </button>
            )}
            {s.owner.unlocked && (
              <button
                className="ghost danger-text"
                onClick={() => {
                  if (confirm(t("Delete the \"{name}\" table and all its records? This can't be undone.", { name: col.name }))) void call("deleteCollection", col.id);
                }}
              >
                {t("Delete table")}
              </button>
            )}
          </div>
          {col.description && <p className="muted">{col.description}</p>}
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {col.fields.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onDoubleClick={() => setEditRow(r)}>
                    {col.fields.map((f) => (
                      <td key={f.key}>{String(r.data[f.key] ?? "")}</td>
                    ))}
                    <td className="actions">
                      <button className="ghost small" onClick={() => setEditRow(r)}>
                        {t("Edit")}
                      </button>
                      <button
                        className="ghost small"
                        onClick={() => {
                          if (confirm(t("Delete this record?"))) void call("deleteRecord", r.id);
                        }}
                      >
                        {t("Delete")}
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={col.fields.length + 1} className="muted center">
                      {q ? t("No results.") : t("No records yet. Add one yourself or ask a bot.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="empty">
          <p>{t("No tables yet.")}</p>
          {s.owner.unlocked && (
            <button className="primary" onClick={() => setEditCol("new")}>
              {t("Create the first table")}
            </button>
          )}
        </div>
      )}
      {editCol && <CollectionEditor c={editCol === "new" ? null : editCol} onClose={() => setEditCol(null)} />}
      {editRow && col && <RecordEditor c={col} row={editRow === "new" ? null : editRow} onClose={() => setEditRow(null)} />}
    </div>
  );
}
