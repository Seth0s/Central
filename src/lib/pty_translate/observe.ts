import type { ChatTurn, ToolRun } from "../chat.ts";
import { isBoxDrawingLine } from "./screen.ts";

const TIP_RE = /^tip:/i;
const HINT_RE = /type [`']?\?[`']? in the prompt/i;
const AUTO_PCT_RE = /\bAuto\s*[·•.]\s*(\d+(?:\.\d+)?)\s*%/i;
const CWD_RE = /^[~\/][^\s]*$/;
const STATUS_NOISE_RE =
  /\b(esc to interrupt|ctrl\+c to stop|press (?:esc|ctrl)|thinking…|composing)\b/i;
const CURSOR_CTX_RE = /\bctx\s*[—–-]\s*$/i;
const SPINNER_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●○◉◎◐◑◒◓]+$/;

const TOOL_NAME_RE =
  /^(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch|NotebookEdit|Shell|ApplyPatch|Explore)\b/i;
const TOOL_LINE_RE =
  /^(?:[⏺●•❯›$⚙]\s*)?(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch|NotebookEdit|Shell|ApplyPatch|Explore)\s+(\S.*)$/i;
const GENERIC_CMD_RE = /^(?:[❯›$]\s+|exec\s+)(.+)$/;
const ACTIVITY_RE = /^(?:running|working|executing|calling)\b/i;

export function isVendorChrome(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (TIP_RE.test(t) || HINT_RE.test(t)) return true;
  if (isBoxDrawingLine(line)) return true;
  if (AUTO_PCT_RE.test(t) && t.length < 48) return true;
  if (CURSOR_CTX_RE.test(t)) return true;
  if (STATUS_NOISE_RE.test(t)) return true;
  if (SPINNER_RE.test(t)) return true;
  if (CWD_RE.test(t) && t.length < 80) return true;
  if (/^(claude|codex|cursor)(?:\s+code|\s+agent)?\b/i.test(t) && t.length < 80) return true;
  return false;
}

export function filterVendorChrome(display: string): string {
  return display
    .split("\n")
    .filter((line) => !isVendorChrome(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function addedLines(previous: string, current: string): string[] {
  if (!previous) return current.split("\n");
  if (current.startsWith(previous)) {
    return current.slice(previous.length).split("\n");
  }
  const prev = new Set(previous.split("\n").map((l) => l.trim()).filter(Boolean));
  return current.split("\n").filter((line) => {
    const t = line.trim();
    return t && !prev.has(t);
  });
}

export type ObserveResult = {
  assistant: string;
  tools: ToolRun[];
  genericActivity: boolean;
};

export function observeScreen(
  _provider: string,
  previous: string,
  current: string,
  userText: string,
): ObserveResult {
  const delta = addedLines(previous, current)
    .map((l) => l.trimEnd())
    .filter((l) => !isVendorChrome(l));
  const tools: ToolRun[] = [];
  const prose: string[] = [];
  let genericActivity = false;
  const user = userText.trim();

  for (const line of delta) {
    const t = line.trim();
    if (!t || t === user) continue;
    const tool = TOOL_LINE_RE.exec(t);
    if (tool) {
      const name = tool[1] ?? "tool";
      const detail = (tool[2] ?? "").trim();
      tools.push({
        id: `pty-${name}-${tools.length}`,
        name,
        detail,
        status: "running",
      });
      continue;
    }
    if (GENERIC_CMD_RE.test(t) || (TOOL_NAME_RE.test(t) && t.length < 160)) {
      genericActivity = true;
      tools.push({
        id: `pty-act-${tools.length}`,
        name: "actividade",
        detail: t.slice(0, 200),
        status: "running",
      });
      continue;
    }
    if (ACTIVITY_RE.test(t)) {
      genericActivity = true;
      continue;
    }
    prose.push(line);
  }

  let assistant = prose.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (user && assistant === user) assistant = "";
  return { assistant, tools, genericActivity };
}

function mergeTools(prev: ToolRun[], next: ToolRun[]): ToolRun[] {
  if (!next.length) {
    return prev.map((t) => (t.status === "running" ? { ...t, status: "done" } : t));
  }
  const out: ToolRun[] = prev.map((t) => ({ ...t, status: "done" }));
  for (const t of next) {
    const hit = out.findIndex((p) => p.name === t.name && p.detail === t.detail);
    if (hit >= 0) out[hit] = { ...out[hit]!, status: "running" };
    else out.push(t);
  }
  return out;
}

/** Same object if the open user turn did not change. */
export function applySkinObservers<T extends {
  turns: ChatTurn[];
  ptyLog: string;
  provider: string;
  lastBytesAt?: number;
}>(
  session: T,
  previousDisplay: string,
  now: number,
): T {
  const last = session.turns[session.turns.length - 1];
  if (!last || last.origin === "system" || !last.user) return session;
  if (last.endedAt != null) return session;
  const seen = observeScreen(session.provider, previousDisplay, session.ptyLog, last.user);
  const tools = seen.tools.length || last.tools.some((t) => t.status === "running")
    ? mergeTools(last.tools, seen.tools)
    : last.tools;
  const assistant = seen.assistant || last.assistant;
  if (assistant === last.assistant && tools === last.tools) return session;
  const nextTurn = { ...last, assistant, tools, startedAt: last.startedAt || now };
  return {
    ...session,
    turns: [...session.turns.slice(0, -1), nextTurn],
    // Activity clock only when the open turn actually advanced — not on TUI chrome redraws.
    lastBytesAt: now,
  };
}

export function settleTurnsIfIdle<T extends { turns: ChatTurn[]; lastBytesAt?: number }>(
  session: T,
  now: number,
  idleMs = 1500,
): T {
  const last = session.turns[session.turns.length - 1];
  if (!last || last.endedAt != null) return session;
  if (last.tools.some((t) => t.status === "running")) return session;
  if (!last.assistant && !last.tools.length) return session;
  const lastAt = session.lastBytesAt ?? last.startedAt;
  if (now - lastAt < idleMs) return session;
  const tools = last.tools.map((t) => (t.status === "running" ? { ...t, status: "done" as const } : t));
  return {
    ...session,
    turns: [...session.turns.slice(0, -1), { ...last, tools, endedAt: lastAt }],
  };
}

/** True while a user turn is open — tools running, or waiting/streaming until settle. */
export function turnHasOpenWork(turns: ChatTurn[]): boolean {
  const last = turns[turns.length - 1];
  return Boolean(
    last &&
      last.endedAt == null &&
      last.origin !== "system" &&
      last.user,
  );
}
