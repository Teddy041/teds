import type { Bot, Template, ToolGroup } from "./types";
import { t } from "./i18n";

// Industry templates: each one brings a ready-made bot team and record tables.
// After applying a template the user can change everything; templates are only a starting point.

const ALL: ToolGroup[] = ["records", "memory", "team", "screen", "web"];

const LEAD_INTRO =
  "You run the team. Understand what the user wants; do simple jobs yourself, hand specialist work to the right teammate, " +
  "and give the user a short, clear summary of the result. ";

function lead(name: string, extra: string): Omit<Bot, "id"> {
  return {
    name,
    emoji: "🧭",
    role: "Team lead",
    instructions: LEAD_INTRO + extra,
    lead: true,
    tools: ALL,
    approval: "ask",
    effort: "medium",
  };
}

function bot(name: string, emoji: string, role: string, instructions: string, tools: ToolGroup[] = ["records", "memory"]): Omit<Bot, "id"> {
  return { name, emoji, role, instructions, lead: false, tools, approval: "ask", effort: "medium" };
}

const TEMPLATES: Template[] = [
  {
    id: "health",
    name: "Clinic / healthcare",
    kind: "Healthcare",
    description: "Clinic or medical practice: patient records, appointments, invoices.",
    bots: [
      lead("Teds", "Patient information is sensitive: don't repeat it needlessly and share only what the task requires. Never give a diagnosis or treatment advice; always leave that to the doctor."),
      bot("Booking", "📅", "Appointment manager", "Creates and updates appointments and checks for clashes. Before adding one, check whether the same doctor already has an appointment at that time."),
      bot("Billing", "🧾", "Invoices and payments", "Tracks invoices, lists unpaid ones and drafts reminder messages."),
    ],
    collections: [
      {
        name: "Patients",
        description: "Registered patients and their contact details.",
        fields: [
          { key: "name", label: "Full name", type: "text" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "birth_date", label: "Date of birth", type: "date" },
          { key: "note", label: "Note", type: "longtext" },
        ],
      },
      {
        name: "Appointments",
        description: "Patient appointments. The Patient field matches the full name in the Patients table.",
        fields: [
          { key: "patient", label: "Patient", type: "text" },
          { key: "doctor", label: "Doctor", type: "text" },
          { key: "date", label: "Date and time", type: "text" },
          { key: "status", label: "Status", type: "select", options: ["Scheduled", "Attended", "No-show", "Cancelled"] },
        ],
      },
      {
        name: "Invoices",
        description: "Issued invoices and their payment status.",
        fields: [
          { key: "patient", label: "Patient", type: "text" },
          { key: "amount", label: "Amount", type: "number" },
          { key: "date", label: "Date", type: "date" },
          { key: "status", label: "Status", type: "select", options: ["Unpaid", "Paid", "Partial"] },
        ],
      },
    ],
  },
  {
    id: "retail",
    name: "Shop / retail",
    kind: "Retail",
    description: "Products and stock, orders, customers.",
    bots: [
      lead("Teds", "For stock and order questions, check the records first; don't guess."),
      bot("Stock", "📦", "Stock manager", "Tracks product stock and reports items that fall below their critical level."),
      bot("Sales", "🛒", "Orders and customers", "Records orders, updates their status and drafts replies to customer questions."),
    ],
    collections: [
      {
        name: "Products",
        description: "Products for sale, their prices and stock levels.",
        fields: [
          { key: "name", label: "Product", type: "text" },
          { key: "price", label: "Price", type: "number" },
          { key: "stock", label: "Stock", type: "number" },
          { key: "critical", label: "Critical level", type: "number" },
        ],
      },
      {
        name: "Orders",
        description: "Customer orders.",
        fields: [
          { key: "customer", label: "Customer", type: "text" },
          { key: "products", label: "Products", type: "longtext" },
          { key: "amount", label: "Amount", type: "number" },
          { key: "status", label: "Status", type: "select", options: ["New", "Preparing", "Shipped", "Delivered", "Returned"] },
        ],
      },
      {
        name: "Customers",
        description: "Customer contact details.",
        fields: [
          { key: "name", label: "Full name", type: "text" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "email", label: "Email", type: "text" },
        ],
      },
    ],
  },
  {
    id: "realestate",
    name: "Real estate agency",
    kind: "Real estate",
    description: "Listings, buyer/tenant leads, viewings.",
    bots: [
      lead("Teds", ""),
      bot("Portfolio", "🏠", "Listings manager", "Records and updates listings, and finds listings that match a client's criteria.", ["records", "memory", "screen"]),
      bot("Customer", "🤝", "Client relations", "Follows up with leads, schedules viewings and drafts follow-up messages."),
    ],
    collections: [
      {
        name: "Listings",
        description: "Properties for sale and for rent.",
        fields: [
          { key: "title", label: "Title", type: "text" },
          { key: "type", label: "Type", type: "select", options: ["For sale", "For rent"] },
          { key: "price", label: "Price", type: "number" },
          { key: "location", label: "Location", type: "text" },
          { key: "rooms", label: "Rooms", type: "text" },
        ],
      },
      {
        name: "Leads",
        description: "Prospective buyers and tenants and what they're looking for.",
        fields: [
          { key: "name", label: "Full name", type: "text" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "looking_for", label: "Looking for", type: "longtext" },
          { key: "budget", label: "Budget", type: "number" },
        ],
      },
    ],
  },
  {
    id: "restaurant",
    name: "Restaurant / café",
    kind: "Food and drink",
    description: "Reservations, suppliers, ingredient stock.",
    bots: [
      lead("Teds", ""),
      bot("Reception", "🍽️", "Reservations manager", "Takes reservations and checks capacity."),
      bot("Supply", "🥕", "Supply and stock", "Tracks ingredient stock and drafts supplier orders for anything running low."),
    ],
    collections: [
      {
        name: "Reservations",
        description: "Table reservations.",
        fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "guests", label: "Guests", type: "number" },
          { key: "date", label: "Date and time", type: "text" },
          { key: "phone", label: "Phone", type: "text" },
        ],
      },
      {
        name: "Ingredients",
        description: "Kitchen ingredients and stock levels.",
        fields: [
          { key: "name", label: "Ingredient", type: "text" },
          { key: "quantity", label: "Quantity", type: "number" },
          { key: "unit", label: "Unit", type: "text" },
          { key: "supplier", label: "Supplier", type: "text" },
        ],
      },
    ],
  },
  {
    id: "office",
    name: "General office / SMB",
    kind: "General",
    description: "Customers, jobs/projects, to-dos. Fits any industry.",
    bots: [
      lead("Teds", ""),
      bot("Researcher", "🔎", "Research", "Researches online, gathers company and contact information, and summarizes it with sources.", ["memory", "web", "screen"]),
      bot("Operations", "📋", "Operations", "Tracks jobs and to-dos and reports anything overdue."),
    ],
    collections: [
      {
        name: "Customers",
        description: "Customer and company details.",
        fields: [
          { key: "name", label: "Name / Company", type: "text" },
          { key: "contact", label: "Contact person", type: "text" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "email", label: "Email", type: "text" },
        ],
      },
      {
        name: "Jobs",
        description: "Jobs and projects to do.",
        fields: [
          { key: "title", label: "Job", type: "text" },
          { key: "owner", label: "Owner", type: "text" },
          { key: "due", label: "Due", type: "date" },
          { key: "status", label: "Status", type: "select", options: ["Waiting", "In progress", "Done"] },
        ],
      },
    ],
  },
  {
    id: "blank",
    name: "Blank",
    kind: "General",
    description: "Just the main bot. Build the team and tables yourself.",
    bots: [lead("Teds", "")],
    collections: [],
  },
];

/** The templates in the selected language. English source strings are translated with the i18n dictionary (field keys stay the same). */
export function templates(): Template[] {
  return TEMPLATES.map((x) => ({
    ...x,
    name: t(x.name),
    kind: t(x.kind),
    description: t(x.description),
    bots: x.bots.map((b) => ({ ...b, name: b.name === "Teds" ? b.name : t(b.name), role: t(b.role), instructions: leadText(b.instructions) })),
    collections: x.collections.map((c) => ({
      ...c,
      name: t(c.name),
      description: t(c.description),
      fields: c.fields.map((f) => ({ ...f, label: t(f.label), ...(f.options ? { options: f.options.map((o) => t(o)) } : {}) })),
    })),
  }));
}

/** A lead's instructions have two parts (shared intro + template-specific extra); each is translated separately. */
function leadText(s: string): string {
  if (!s.startsWith(LEAD_INTRO)) return t(s);
  const extra = s.slice(LEAD_INTRO.length);
  return [t(LEAD_INTRO.trim()), extra ? t(extra) : ""].filter(Boolean).join(" ");
}
