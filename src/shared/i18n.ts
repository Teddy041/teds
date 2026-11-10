import { TR } from "./i18n.tr";

// Language support. The source language is English: every UI string is written as t("English text").
// When Turkish is selected, its translation from i18n.tr.ts is shown; strings without one stay in English.
// Variables use the {name} form: t("{name} is thinking…", { name: "Teds" }).

export type Lang = "tr" | "en";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "tr", label: "Türkçe" },
];

let current: Lang = "en";

export function setLang(l: Lang | undefined) {
  current = l === "tr" ? "tr" : "en";
}

export function getLang(): Lang {
  return current;
}

/** Locale for formatting dates and times. */
export function locale(): string {
  return current === "tr" ? "tr-TR" : "en-GB";
}

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = current === "tr" ? (TR[text] ?? text) : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
