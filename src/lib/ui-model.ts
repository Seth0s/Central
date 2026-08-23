// The shapes the chrome keeps in React state: a live agent pane, the overlays
// it can raise, and the small mappings between catalog rows and UI rows.

import { PROVIDER_LABELS, type DraftFile, type PickCmd } from "./slash";
import type { ChatMessage, ChatTurn, NestedAgent, RateLimits, Usage } from "./chat";
import type { SessionInfo } from "./commands";

/** Three panes max in the split (docs/architecture.md § Chrome). */
export const MAX_SESSIONS = 3;

export type Theme = "dark" | "light";

/** Two views over the same PTY, never two processes. */
export type SessionView = "cli" | "chrome";

export type UiSession = SessionInfo & {
  status: "running" | "exit";
  exitCode?: number;
  view: SessionView;
  draft: string;
  draftFiles: DraftFile[];
  chatMode: string;
  effort: string;
  messages: ChatMessage[];
  turns: ChatTurn[];
  files: string[];
  usage: Usage | null;
  streamModel?: string;
  rateLimits?: RateLimits;
  contextWindow?: number;
  resumeId?: string;
  catalogId: string;
  groupId: string;
  nested: NestedAgent[];
  warned?: boolean;
  pendingSystem?: "control" | "report";
  droppingStream?: boolean;
  ptyLog: string;
  lastBytesAt?: number;
  /** http(s) URLs the agent printed, offered by the browser panel. Capped. */
  seenUrls?: string[];
  screenQuota?: string;
  screenPct?: number;
};

/** A modal the runtime asked for: a skin picker, or a browser permission ask. */
export type SystemUi =
  | {
      kind: "pick";
      sessionId: string;
      command: PickCmd;
      title: string;
      options: { id: string; label: string }[];
      current?: string;
    }
  | { kind: "ask"; sessionId: string; url: string };

export type BrowseMode = "workspace" | "agent" | "md";

export function labelOf(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/** `agents.mode` in SQLite still carries pre-PTY values; map them onto a view. */
export function savedView(mode?: string | null): SessionView {
  if (mode === "chrome" || mode === "json_stream" || mode === "chat") return "chrome";
  return "cli";
}

export function messagesFromTurns(turns: ChatTurn[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const t of turns) {
    if (t.user) out.push({ id: `${t.id}-u`, role: "user", text: t.user });
    if (t.assistant) out.push({ id: `${t.id}-a`, role: "assistant", text: t.assistant });
  }
  return out;
}
