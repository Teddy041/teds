import type { BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { TOOL_GROUP_LABELS, type Bot, type Collection, type Effort, type FieldDef, type ToolGroup } from "../shared/types";
import { requestApproval } from "./approvals";
import type { ToolCall } from "./claude";
import { changed, chatFor, newId, state } from "./store";
import { t } from "../shared/i18n";

// Admin tools: only the team lead has them. The lead adds, edits and deletes bots, grants them tools and
// approval modes, and creates, changes and deletes record tables and fields.
// Since only the business owner can talk to the lead (owner PIN), only the owner can use these tools, indirectly.

const GROUPS = Object.keys(TOOL_GROUP_LABELS) as ToolGroup[];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const FIELD_TYPES: FieldDef["type"][] = ["text", "longtext", "number", "date", "select"];

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required });

const botProps = {
  role: { type: "string", description: "Short role description" },
  instructions: { type: "string", description: "Detailed instructions for how the bot should work" },
  emoji: { type: "string", description: "A single emoji" },
  tools: {
    type: "array",
    items: { type: "string", enum: GROUPS },
    description: `Tool groups to grant: ${GROUPS.map((g) => `${g} (${TOOL_GROUP_LABELS[g].title})`).join(", ")}`,
  },
  approval: { type: "string", enum: ["ask", "auto"], description: "ask: asks before anything that writes; auto: asks only for deletes/payments" },
  effort: { type: "string", enum: EFFORTS, description: "Thinking level" },
  folder: { type: "string", description: "The bot's folder in the sidebar, e.g. 'Accounting'. An empty string removes it from its folder." },
};

const fieldSchema = {
  type: "object",
  properties: {
    label: { type: "string", description: "The field's display name" },
    type: { type: "string", enum: FIELD_TYPES },
    options: { type: "array", items: { type: "string" }, description: "Choices, only for the select type" },
  },
  required: ["label", "type"],
};

export function adminTools(): BetaToolUnion[] {
  return [
    { name: "list_bots", description: "Lists the bots on the team with their roles, tools and approval settings.", input_schema: obj({}) },
    { name: "create_bot", description: "Adds a new bot to the team.", input_schema: obj({ name: { type: "string" }, ...botProps }, ["name", "role", "instructions"]) },
    {
      name: "update_bot",
      description: "Changes a bot's name, role, instructions, tools (permissions), approval mode or folder. Only the given fields change.",
      input_schema: obj({ name: { type: "string", description: "The bot's current name" }, new_name: { type: "string" }, ...botProps }, ["name"]),
    },
    { name: "delete_bot", description: "Deletes a bot and its chat history. The team lead can't be deleted.", input_schema: obj({ name: { type: "string" } }, ["name"]) },
    {
      name: "create_collection",
      description: "Creates a new record table.",
      input_schema: obj({ name: { type: "string" }, description: { type: "string", description: "What the table is for" }, fields: { type: "array", items: fieldSchema } }, ["name", "description", "fields"]),
    },
    {
      name: "update_collection",
      description: "Renames a table or changes its description, adds fields or removes fields. Removing a field also deletes the data in it.",
      input_schema: obj(
        {
          name: { type: "string", description: "The table's current name" },
          new_name: { type: "string" },
          description: { type: "string" },
          add_fields: { type: "array", items: fieldSchema },
          remove_fields: { type: "array", items: { type: "string" }, description: "Keys or names of the fields to remove" },
        },
        ["name"],
      ),
    },
    { name: "delete_collection", description: "Deletes a table and ALL the records in it.", input_schema: obj({ name: { type: "string" } }, ["name"]) },
  ];
}

const lower = (s: unknown) => String(s ?? "").trim().toLocaleLowerCase("tr");

function findBot(name: unknown): Bot {
  const b = state.bots.find((x) => lower(x.name) === lower(name));
  if (!b) throw new Error(`There is no bot named "${String(name)}". Bots: ${state.bots.map((x) => x.name).join(", ")}`);
  return b;
}

function findCol(name: unknown): Collection {
  const c = state.collections.find((x) => lower(x.name) === lower(name));
  if (!c) throw new Error(`There is no table named "${String(name)}". Tables: ${state.collections.map((x) => x.name).join(", ") || "none"}`);
  return c;
}

/** Turns a field label into a key: lowercase ASCII with underscores (Turkish letters are mapped). */
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

function toFields(raw: unknown, existing: FieldDef[] = []): FieldDef[] {
  if (!Array.isArray(raw)) return [];
  const keys = new Set(existing.map((f) => f.key));
  return raw.map((r) => {
    const f = r as { label?: unknown; type?: unknown; options?: unknown };
    const label = String(f.label ?? "").trim();
    if (!label) throw new Error("Every field needs a name (label)");
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
  if (!Array.isArray(raw)) throw new Error("tools must be a list");
  const bad = raw.filter((x) => !GROUPS.includes(x as ToolGroup));
  if (bad.length) throw new Error(`Unknown tool group: ${bad.join(", ")}`);
  return [...new Set(raw as ToolGroup[])];
}

/** Cleans a folder name: collapses spaces and caps it at 40 characters. Returns "" for no folder. */
function cleanFolder(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function describeBot(b: Partial<Bot>) {
  return [
    b.name && `${t("Name")}: ${b.name}`,
    b.role && `${t("Role")}: ${b.role}`,
    b.tools && `${t("Tools")}: ${b.tools.map((g) => t(TOOL_GROUP_LABELS[g].title)).join(", ") || t("none")}`,
    b.approval && `${t("Approval")}: ${b.approval === "ask" ? t("asks before writing") : t("acts without asking (except deletes/payments)")}`,
    b.effort && `${t("Thinking")}: ${b.effort}`,
    b.folder !== undefined && `${t("Folder")}: ${b.folder || t("(no folder)")}`,
    b.instructions && `${t("Instructions")}: ${b.instructions.slice(0, 400)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Asks according to the lead's approval mode; with always=true it always asks. Returns an explanation if rejected. */
async function approve(lead: Bot, always: boolean, title: string, detail: string): Promise<string | null> {
  if (!always && lead.approval === "auto") return null;
  const a = await requestApproval({ botId: lead.id, title, detail });
  return a.ok ? null : `The owner REJECTED this action${a.note ? `. Their note: ${a.note}` : ""}. Don't do it.`;
}

function note(lead: Bot, text: string) {
  chatFor(lead.id).display.push({ id: newId(), kind: "tool", text, at: Date.now(), botId: lead.id });
  changed();
}

/** Runs an admin tool. Returns null if this isn't an admin tool. */
export async function runAdminTool(lead: Bot, call: ToolCall): Promise<string | null> {
  const i = call.input;
  switch (call.name) {
    case "list_bots":
      return state.bots
        .map(
          (b) =>
            `${b.emoji} ${b.name}${b.lead ? " (lead)" : ""} — ${b.role}${b.folder ? ` [folder: ${b.folder}]` : ""}\n  tools: ${b.tools.join(", ") || "none"}; approval: ${b.approval}; thinking: ${b.effort}\n  instructions: ${b.instructions.slice(0, 300)}`,
        )
        .join("\n");

    case "create_bot": {
      const name = String(i.name ?? "").trim();
      if (!name) throw new Error("name is missing");
      if (state.bots.some((b) => lower(b.name) === lower(name))) throw new Error("A bot with this name already exists");
      const bot: Bot = {
        id: newId(),
        name,
        emoji: String(i.emoji ?? "🤖").slice(0, 4) || "🤖",
        role: String(i.role ?? "Team member"),
        instructions: String(i.instructions ?? ""),
        lead: false,
        tools: pickTools(i.tools) ?? ["records", "memory"],
        approval: i.approval === "auto" ? "auto" : "ask",
        effort: EFFORTS.includes(i.effort as Effort) ? (i.effort as Effort) : "medium",
        ...(cleanFolder(i.folder) ? { folder: cleanFolder(i.folder) } : {}),
      };
      const no = await approve(lead, false, `${t("Create new bot:")} ${bot.emoji} ${bot.name}`, describeBot(bot));
      if (no) return no;
      state.bots.push(bot);
      note(lead, `🧩 ${t("New bot added:")} ${bot.emoji} ${bot.name}`);
      return `Created: ${bot.name}`;
    }

    case "update_bot": {
      const b = findBot(i.name);
      const patch: Partial<Bot> = {};
      if (i.new_name !== undefined) {
        const nn = String(i.new_name).trim();
        if (!nn) throw new Error("new_name can't be empty");
        if (state.bots.some((x) => x.id !== b.id && lower(x.name) === lower(nn))) throw new Error("A bot with this name already exists");
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
      if (!Object.keys(patch).length) return "Nothing to change was given.";
      // Widening permissions (granting tools, acting without asking) always needs the owner's approval.
      const widens = (tools && tools.some((g) => !b.tools.includes(g))) || (patch.approval === "auto" && b.approval !== "auto");
      const no = await approve(lead, !!widens, t("Update {bot}", { bot: `${b.emoji} ${b.name}` }), describeBot(patch));
      if (no) return no;
      Object.assign(b, patch);
      note(lead, `🧩 ${t("{bot} updated", { bot: `${b.emoji} ${b.name}` })}`);
      return `Updated: ${b.name}`;
    }

    case "delete_bot": {
      const b = findBot(i.name);
      if (b.lead) throw new Error("The team lead can't be deleted");
      const no = await approve(lead, true, t("DELETE {bot}", { bot: `${b.emoji} ${b.name}` }), `${b.role}\n${t("Its chat history is deleted too.")}`);
      if (no) return no;
      state.bots = state.bots.filter((x) => x.id !== b.id);
      delete state.chats[b.id];
      note(lead, `🧩 ${t("{bot} deleted", { bot: b.name })}`);
      return `Deleted: ${b.name}`;
    }

    case "create_collection": {
      const name = String(i.name ?? "").trim();
      if (!name) throw new Error("name is missing");
      if (state.collections.some((c) => lower(c.name) === lower(name))) throw new Error("A table with this name already exists");
      const fields = toFields(i.fields);
      if (!fields.length) throw new Error("At least one field is required");
      const c: Collection = { id: newId(), name, description: String(i.description ?? ""), fields };
      const no = await approve(lead, false, `${t("Create new table:")} ${name}`, `${c.description}\n${t("Fields")}: ${fields.map((f) => `${f.label} (${f.type})`).join(", ")}`);
      if (no) return no;
      state.collections.push(c);
      note(lead, `🗂️ ${t("New table:")} ${name}`);
      return `Created: ${name}. Field keys: ${fields.map((f) => f.key).join(", ")}`;
    }

    case "update_collection": {
      const c = findCol(i.name);
      const add = toFields(i.add_fields, c.fields);
      const removeKeys = Array.isArray(i.remove_fields)
        ? i.remove_fields.map((r) => {
            const f = c.fields.find((x) => x.key === String(r) || lower(x.label) === lower(r));
            if (!f) throw new Error(`The ${c.name} table has no field "${String(r)}"`);
            return f.key;
          })
        : [];
      const newName = i.new_name !== undefined ? String(i.new_name).trim() : undefined;
      if (newName && state.collections.some((x) => x.id !== c.id && lower(x.name) === lower(newName))) throw new Error("A table with this name already exists");
      const lines = [
        newName && `${t("New name:")} ${newName}`,
        i.description !== undefined && `${t("Description:")} ${String(i.description)}`,
        add.length && `${t("Fields to add:")} ${add.map((f) => `${f.label} (${f.type})`).join(", ")}`,
        removeKeys.length && `${t("Fields to DELETE (with their data):")} ${removeKeys.join(", ")}`,
      ].filter(Boolean);
      if (!lines.length) return "Nothing to change was given.";
      const no = await approve(lead, removeKeys.length > 0, t("Change the {table} table", { table: c.name }), lines.join("\n"));
      if (no) return no;
      if (newName) c.name = newName;
      if (i.description !== undefined) c.description = String(i.description);
      c.fields = [...c.fields.filter((f) => !removeKeys.includes(f.key)), ...add];
      if (removeKeys.length) for (const r of state.records) if (r.collectionId === c.id) for (const k of removeKeys) delete r.data[k];
      note(lead, `🗂️ ${t("{table} table updated", { table: c.name })}`);
      return `Updated. Fields: ${c.fields.map((f) => `${f.key}:${f.type}`).join(", ")}`;
    }

    case "delete_collection": {
      const c = findCol(i.name);
      const n = state.records.filter((r) => r.collectionId === c.id).length;
      const no = await approve(lead, true, t("DELETE the {table} table", { table: c.name }), t("Its {n} records are deleted too. This can't be undone.", { n }));
      if (no) return no;
      state.collections = state.collections.filter((x) => x.id !== c.id);
      state.records = state.records.filter((r) => r.collectionId !== c.id);
      note(lead, `🗂️ ${t("{table} table deleted", { table: c.name })}`);
      return `Deleted: ${c.name} (with ${n} records)`;
    }

    default:
      return null;
  }
}
