import type { BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { TOOL_GROUP_LABELS, type Bot, type Collection, type Effort, type FieldDef, type ToolGroup } from "../shared/types";
import { requestApproval } from "./approvals";
import type { ToolCall } from "./claude";
import { changed, chatFor, newId, state } from "./store";
import { t } from "../shared/i18n";

// Yönetici araçları: sadece ekip liderinde bulunur. Lider; bot ekler, düzenler, siler, botlara araç ve
// onay yetkisi verir, kayıt tablolarını ve alanlarını oluşturur, değiştirir, siler.
// Liderle sadece işletme sahibi konuşabildiği için (Sahip PIN'i) bu araçları da dolaylı olarak sadece sahip kullanır.

const GROUPS = Object.keys(TOOL_GROUP_LABELS) as ToolGroup[];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const FIELD_TYPES: FieldDef["type"][] = ["text", "longtext", "number", "date", "select"];

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required });

const botProps = {
  role: { type: "string", description: "Kısa görev tanımı" },
  instructions: { type: "string", description: "Botun nasıl çalışacağına dair ayrıntılı talimatlar" },
  emoji: { type: "string", description: "Tek bir emoji" },
  tools: {
    type: "array",
    items: { type: "string", enum: GROUPS },
    description: `Verilecek araç grupları: ${GROUPS.map((g) => `${g} (${TOOL_GROUP_LABELS[g].title})`).join(", ")}`,
  },
  approval: { type: "string", enum: ["ask", "auto"], description: "ask: yazan her işlemden önce sorar; auto: sadece silme/ödeme için sorar" },
  effort: { type: "string", enum: EFFORTS, description: "Düşünme düzeyi" },
  folder: { type: "string", description: "Botun kenar çubuğundaki klasörü, örn. 'Muhasebe'. Boş metin klasörden çıkarır." },
};

const fieldSchema = {
  type: "object",
  properties: {
    label: { type: "string", description: "Alanın görünen adı" },
    type: { type: "string", enum: FIELD_TYPES },
    options: { type: "array", items: { type: "string" }, description: "Sadece select tipi için seçenekler" },
  },
  required: ["label", "type"],
};

export function adminTools(): BetaToolUnion[] {
  return [
    { name: "list_bots", description: "Ekipteki botları, görevlerini, araçlarını ve onay ayarlarını listeler.", input_schema: obj({}) },
    { name: "create_bot", description: "Ekibe yeni bir bot ekler.", input_schema: obj({ name: { type: "string" }, ...botProps }, ["name", "role", "instructions"]) },
    {
      name: "update_bot",
      description: "Bir botun adını, görevini, talimatlarını, araçlarını (yetkilerini) veya onay ayarını veya klasörünü değiştirir. Sadece verilen alanlar değişir.",
      input_schema: obj({ name: { type: "string", description: "Botun şu anki adı" }, new_name: { type: "string" }, ...botProps }, ["name"]),
    },
    { name: "delete_bot", description: "Bir botu ve sohbet geçmişini siler. Ekip lideri silinemez.", input_schema: obj({ name: { type: "string" } }, ["name"]) },
    {
      name: "create_collection",
      description: "Yeni bir kayıt tablosu oluşturur.",
      input_schema: obj({ name: { type: "string" }, description: { type: "string", description: "Tablonun ne için kullanıldığı" }, fields: { type: "array", items: fieldSchema } }, ["name", "description", "fields"]),
    },
    {
      name: "update_collection",
      description: "Bir tablonun adını/açıklamasını değiştirir, alan ekler veya alan siler. Alan silmek o alandaki verileri de siler.",
      input_schema: obj(
        {
          name: { type: "string", description: "Tablonun şu anki adı" },
          new_name: { type: "string" },
          description: { type: "string" },
          add_fields: { type: "array", items: fieldSchema },
          remove_fields: { type: "array", items: { type: "string" }, description: "Silinecek alanların anahtarı veya adı" },
        },
        ["name"],
      ),
    },
    { name: "delete_collection", description: "Bir tabloyu ve içindeki TÜM kayıtları siler.", input_schema: obj({ name: { type: "string" } }, ["name"]) },
  ];
}

const lower = (s: unknown) => String(s ?? "").trim().toLocaleLowerCase("tr");

function findBot(name: unknown): Bot {
  const b = state.bots.find((x) => lower(x.name) === lower(name));
  if (!b) throw new Error(`"${String(name)}" adında bot yok. Botlar: ${state.bots.map((x) => x.name).join(", ")}`);
  return b;
}

function findCol(name: unknown): Collection {
  const c = state.collections.find((x) => lower(x.name) === lower(name));
  if (!c) throw new Error(`"${String(name)}" adında tablo yok. Tablolar: ${state.collections.map((x) => x.name).join(", ") || "yok"}`);
  return c;
}

function slug(label: string) {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return label.toLocaleLowerCase("tr").replace(/[çğıöşü]/g, (c) => map[c]).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "alan";
}

function toFields(raw: unknown, existing: FieldDef[] = []): FieldDef[] {
  if (!Array.isArray(raw)) return [];
  const keys = new Set(existing.map((f) => f.key));
  return raw.map((r) => {
    const f = r as { label?: unknown; type?: unknown; options?: unknown };
    const label = String(f.label ?? "").trim();
    if (!label) throw new Error("Her alanın bir adı (label) olmalı");
    const type = FIELD_TYPES.includes(f.type as FieldDef["type"]) ? (f.type as FieldDef["type"]) : "text";
    let key = slug(label);
    while (keys.has(key)) key += "_";
    keys.add(key);
    const options = type === "select" && Array.isArray(f.options) ? f.options.map(String) : undefined;
    return { key, label, type, ...(options ? { options } : {}) };
  });
}

function pickTools(raw: unknown): ToolGroup[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("tools bir liste olmalı");
  const bad = raw.filter((x) => !GROUPS.includes(x as ToolGroup));
  if (bad.length) throw new Error(`Bilinmeyen araç grubu: ${bad.join(", ")}`);
  return [...new Set(raw as ToolGroup[])];
}

/** Klasör adını temizler: boşlukları kırpar, 40 karakterle sınırlar. Boşsa "" döner (klasörsüz). */
function cleanFolder(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
}

function describeBot(b: Partial<Bot>) {
  return [
    b.name && `${t("Ad")}: ${b.name}`,
    b.role && `${t("Görev")}: ${b.role}`,
    b.tools && `${t("Araçlar")}: ${b.tools.map((g) => t(TOOL_GROUP_LABELS[g].title)).join(", ") || t("yok")}`,
    b.approval && `${t("Onay")}: ${b.approval === "ask" ? t("yazmadan önce sorar") : t("sormadan yapar (silme/ödeme hariç)")}`,
    b.effort && `${t("Düşünme")}: ${b.effort}`,
    b.folder !== undefined && `${t("Klasör")}: ${b.folder || t("(klasörsüz)")}`,
    b.instructions && `${t("Talimatlar")}: ${b.instructions.slice(0, 400)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Liderin onay ayarına göre sorar; always=true ise her durumda sorar. Reddedilirse açıklama döner. */
async function approve(lead: Bot, always: boolean, title: string, detail: string): Promise<string | null> {
  if (!always && lead.approval === "auto") return null;
  const a = await requestApproval({ botId: lead.id, title, detail });
  return a.ok ? null : `Sahip bu işlemi REDDETTİ${a.note ? `. Notu: ${a.note}` : ""}. Yapma.`;
}

function note(lead: Bot, text: string) {
  chatFor(lead.id).display.push({ id: newId(), kind: "tool", text, at: Date.now(), botId: lead.id });
  changed();
}

/** Yönetici aracını çalıştırır. Bu bir yönetici aracı değilse null döner. */
export async function runAdminTool(lead: Bot, call: ToolCall): Promise<string | null> {
  const i = call.input;
  switch (call.name) {
    case "list_bots":
      return state.bots
        .map((b) => `${b.emoji} ${b.name}${b.lead ? " (lider)" : ""} — ${b.role}${b.folder ? ` [klasör: ${b.folder}]` : ""}\n  araçlar: ${b.tools.join(", ") || "yok"}; onay: ${b.approval}; düşünme: ${b.effort}\n  talimatlar: ${b.instructions.slice(0, 300)}`)
        .join("\n");

    case "create_bot": {
      const name = String(i.name ?? "").trim();
      if (!name) throw new Error("name eksik");
      if (state.bots.some((b) => lower(b.name) === lower(name))) throw new Error("Bu adda bir bot zaten var");
      const bot: Bot = {
        id: newId(),
        name,
        emoji: String(i.emoji ?? "🤖").slice(0, 4) || "🤖",
        role: String(i.role ?? "Ekip üyesi"),
        instructions: String(i.instructions ?? ""),
        lead: false,
        tools: pickTools(i.tools) ?? ["records", "memory"],
        approval: i.approval === "auto" ? "auto" : "ask",
        effort: EFFORTS.includes(i.effort as Effort) ? (i.effort as Effort) : "medium",
        ...(cleanFolder(i.folder) ? { folder: cleanFolder(i.folder) } : {}),
      };
      const no = await approve(lead, false, `${t("Yeni bot oluştur:")} ${bot.emoji} ${bot.name}`, describeBot(bot));
      if (no) return no;
      state.bots.push(bot);
      note(lead, `🧩 ${t("Yeni bot eklendi:")} ${bot.emoji} ${bot.name}`);
      return `Oluşturuldu: ${bot.name}`;
    }

    case "update_bot": {
      const b = findBot(i.name);
      const patch: Partial<Bot> = {};
      if (i.new_name !== undefined) {
        const nn = String(i.new_name).trim();
        if (!nn) throw new Error("new_name boş olamaz");
        if (state.bots.some((x) => x.id !== b.id && lower(x.name) === lower(nn))) throw new Error("Bu adda bir bot zaten var");
        patch.name = nn;
      }
      if (i.role !== undefined) patch.role = String(i.role);
      if (i.instructions !== undefined) patch.instructions = String(i.instructions);
      if (i.emoji !== undefined) patch.emoji = String(i.emoji).slice(0, 4);
      const tools = pickTools(i.tools);
      if (tools) patch.tools = tools;
      if (i.approval !== undefined) patch.approval = i.approval === "auto" ? "auto" : "ask";
      if (i.effort !== undefined && EFFORTS.includes(i.effort as Effort)) patch.effort = i.effort as Effort;
      if (i.folder !== undefined) patch.folder = cleanFolder(i.folder);
      if (!Object.keys(patch).length) return "Değişecek bir şey verilmedi.";
      // Yetki genişletmek (araç vermek, sormadan yapma) her zaman sahibin onayına tabidir.
      const widens = (tools && tools.some((g) => !b.tools.includes(g))) || (patch.approval === "auto" && b.approval !== "auto");
      const no = await approve(lead, !!widens, t("{bot} botunu güncelle", { bot: `${b.emoji} ${b.name}` }), describeBot(patch));
      if (no) return no;
      Object.assign(b, patch);
      note(lead, `🧩 ${t("{bot} güncellendi", { bot: `${b.emoji} ${b.name}` })}`);
      return `Güncellendi: ${b.name}`;
    }

    case "delete_bot": {
      const b = findBot(i.name);
      if (b.lead) throw new Error("Ekip lideri silinemez");
      const no = await approve(lead, true, t("{bot} botunu SİL", { bot: `${b.emoji} ${b.name}` }), `${b.role}\n${t("Sohbet geçmişi de silinir.")}`);
      if (no) return no;
      state.bots = state.bots.filter((x) => x.id !== b.id);
      delete state.chats[b.id];
      note(lead, `🧩 ${t("{bot} silindi", { bot: b.name })}`);
      return `Silindi: ${b.name}`;
    }

    case "create_collection": {
      const name = String(i.name ?? "").trim();
      if (!name) throw new Error("name eksik");
      if (state.collections.some((c) => lower(c.name) === lower(name))) throw new Error("Bu adda bir tablo zaten var");
      const fields = toFields(i.fields);
      if (!fields.length) throw new Error("En az bir alan gerekli");
      const c: Collection = { id: newId(), name, description: String(i.description ?? ""), fields };
      const no = await approve(lead, false, `${t("Yeni tablo oluştur:")} ${name}`, `${c.description}\n${t("Alanlar")}: ${fields.map((f) => `${f.label} (${f.type})`).join(", ")}`);
      if (no) return no;
      state.collections.push(c);
      note(lead, `🗂️ ${t("Yeni tablo:")} ${name}`);
      return `Oluşturuldu: ${name}. Alan anahtarları: ${fields.map((f) => f.key).join(", ")}`;
    }

    case "update_collection": {
      const c = findCol(i.name);
      const add = toFields(i.add_fields, c.fields);
      const removeKeys = Array.isArray(i.remove_fields)
        ? i.remove_fields.map((r) => {
            const f = c.fields.find((x) => x.key === String(r) || lower(x.label) === lower(r));
            if (!f) throw new Error(`"${String(r)}" alanı ${c.name} tablosunda yok`);
            return f.key;
          })
        : [];
      const newName = i.new_name !== undefined ? String(i.new_name).trim() : undefined;
      if (newName && state.collections.some((x) => x.id !== c.id && lower(x.name) === lower(newName))) throw new Error("Bu adda bir tablo zaten var");
      const lines = [
        newName && `Yeni ad: ${newName}`,
        i.description !== undefined && `Açıklama: ${String(i.description)}`,
        add.length && `Eklenecek alanlar: ${add.map((f) => `${f.label} (${f.type})`).join(", ")}`,
        removeKeys.length && `SİLİNECEK alanlar (içindeki veriyle): ${removeKeys.join(", ")}`,
      ].filter(Boolean);
      if (!lines.length) return "Değişecek bir şey verilmedi.";
      const no = await approve(lead, removeKeys.length > 0, t("{table} tablosunu değiştir", { table: c.name }), lines.join("\n"));
      if (no) return no;
      if (newName) c.name = newName;
      if (i.description !== undefined) c.description = String(i.description);
      c.fields = [...c.fields.filter((f) => !removeKeys.includes(f.key)), ...add];
      if (removeKeys.length) for (const r of state.records) if (r.collectionId === c.id) for (const k of removeKeys) delete r.data[k];
      note(lead, `🗂️ ${t("{table} tablosu güncellendi", { table: c.name })}`);
      return `Güncellendi. Alanlar: ${c.fields.map((f) => `${f.key}:${f.type}`).join(", ")}`;
    }

    case "delete_collection": {
      const c = findCol(i.name);
      const n = state.records.filter((r) => r.collectionId === c.id).length;
      const no = await approve(lead, true, t("{table} tablosunu SİL", { table: c.name }), t("İçindeki {n} kayıt da silinir. Geri alınamaz.", { n }));
      if (no) return no;
      state.collections = state.collections.filter((x) => x.id !== c.id);
      state.records = state.records.filter((r) => r.collectionId !== c.id);
      note(lead, `🗂️ ${t("{table} tablosu silindi", { table: c.name })}`);
      return `Silindi: ${c.name} (${n} kayıtla birlikte)`;
    }

    default:
      return null;
  }
}
