import { stripAnsi } from "./ansi.ts";
import { isBoxDrawingLine, normalizeSnapshot, type ScreenView } from "./screen.ts";

export function translateCursor(chunk: string): string {
  return stripAnsi(chunk);
}

const TIP_RE = /^tip:/i;
const HINT_RE = /type [`']?\?[`']? in the prompt/i;
const AUTO_PCT_RE = /\bAuto\s*[·•.]\s*(\d+(?:\.\d+)?)\s*%/i;

export function interpretCursorScreen(snapshot: string): ScreenView {
  const normalized = normalizeSnapshot(snapshot);
  const pctRaw = normalized.match(AUTO_PCT_RE)?.[1];
  const pct = pctRaw != null ? Number(pctRaw) : undefined;
  const display = normalized
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (TIP_RE.test(t)) return false;
      if (HINT_RE.test(t)) return false;
      if (isBoxDrawingLine(line)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { display, pct: Number.isFinite(pct) ? pct : undefined, warn: false };
}
