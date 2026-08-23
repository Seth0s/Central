import { stripAnsi } from "./ansi.ts";
import { normalizeSnapshot, type ScreenView } from "./screen.ts";

/** v1 chunk path: strip ANSI. Screen interpretation lives in interpretClaudeScreen. */
export function translateClaude(chunk: string): string {
  return stripAnsi(chunk);
}

const MODEL_RE = /\b(Opus(?:\s*[\d.]+)?|Sonnet(?:\s*[\d.]+)?|Haiku(?:\s*[\d.]+)?)\b/i;
const WEEKLY_RE = /you(?:['’]|\s)?ve used\s+(\d+)\s*%\s+of your weekly limit/i;

export function interpretClaudeScreen(snapshot: string): ScreenView {
  const display = normalizeSnapshot(snapshot);
  const modelMatch = display.match(MODEL_RE);
  const weeklyMatch = display.match(WEEKLY_RE);
  return {
    display,
    model: modelMatch?.[1]?.replace(/\s+/g, " ").trim(),
    quota: weeklyMatch?.[1] ? `${weeklyMatch[1]}% semana` : undefined,
    warn: false,
  };
}
