/* Bilingual text (Korean / English).

   UI code:      L("한국어", "English")  → string in the viewer's current language (evaluate at render time).
   Engine code:  tx("한국어", "English") → {ko, en}. Engines run on the host, whose language may differ from each viewer's,
                 so every text an engine produces is bilingual and is resolved on the viewer's device with loc().
   loc(x):       accepts a plain string (legacy / language-neutral), a {ko, en} object, or null.

   The language defaults to the device language (Korean for "ko*", English otherwise) and is remembered per device.
   This module must stay importable from Node (engines import tx), so browser APIs are guarded. */

const KEY = "bg.lang";
const listeners = new Set();

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch (e) { }
  const nav = typeof navigator !== "undefined" ? (navigator.language || "") : "";
  return /^ko/i.test(nav) || !nav ? "ko" : "en";
}

export let lang = typeof window !== "undefined" ? initial() : "ko";

export function setLang(l) {
  if (l !== "ko" && l !== "en" || l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch (e) { }
  if (typeof document !== "undefined") document.documentElement.lang = l;
  for (const f of listeners) try { f(l); } catch (e) { console.error(e); }
}
export const toggleLang = () => setLang(lang === "ko" ? "en" : "ko");
export const onLang = f => { listeners.add(f); return () => listeners.delete(f); };

export const L = (ko, en) => (lang === "en" ? en : ko);
export const tx = (ko, en) => ({ ko, en });
export function loc(x) {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  return x[lang] ?? x.ko ?? x.en ?? "";
}
