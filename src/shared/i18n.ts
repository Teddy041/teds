import { EN } from "./i18n.en";

// Dil desteği. Uygulamanın kaynak dili Türkçedir: her metin t("Türkçe metin") ile yazılır,
// İngilizce seçiliyse i18n.en.ts sözlüğündeki karşılığı gösterilir. Karşılığı yoksa Türkçe metin kalır.
// Değişkenler {ad} biçiminde yazılır: t("{name} düşünüyor…", { name: "Teds" }).

export type Lang = "tr" | "en";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "tr", label: "Türkçe" },
  { id: "en", label: "English" },
];

let current: Lang = "tr";

export function setLang(l: Lang | undefined) {
  current = l === "en" ? "en" : "tr";
}

export function getLang(): Lang {
  return current;
}

/** Tarih/saat biçimlendirmesi için yerel ayar. */
export function locale(): string {
  return current === "en" ? "en-GB" : "tr-TR";
}

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = current === "en" ? (EN[text] ?? text) : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Sözlükte karşılığı olmayan metinleri bulmak için (geliştirme). */
export function hasTranslation(text: string): boolean {
  return text in EN;
}
