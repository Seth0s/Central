/** UI prefs that live in localStorage (not SQLite). */

export const TERM_FONT_MIN = 9;
export const TERM_FONT_MAX = 18;
export const TERM_FONT_DEFAULT = 11;
const TERM_FONT_KEY = "cc-term-font-size";

export function clampTermFontSize(n: number): number {
  if (!Number.isFinite(n)) return TERM_FONT_DEFAULT;
  return Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, Math.round(n)));
}

export function readTermFontSize(): number {
  const raw = localStorage.getItem(TERM_FONT_KEY);
  if (!raw) return TERM_FONT_DEFAULT;
  return clampTermFontSize(Number(raw));
}

export function writeTermFontSize(n: number): number {
  const next = clampTermFontSize(n);
  localStorage.setItem(TERM_FONT_KEY, String(next));
  window.dispatchEvent(new CustomEvent("cc-term-font", { detail: next }));
  return next;
}
