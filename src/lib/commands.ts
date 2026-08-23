import { invoke } from "@tauri-apps/api/core";
import type { ChatTurn } from "./chat";

export type SessionMode = "json_stream" | "interactive_pty";

export type ProviderInfo = {
  id: string;
  detected: boolean;
  binary: string | null;
  modes: SessionMode[];
};

export type DirEntry = { name: string; path: string; is_dir: boolean };

export type BrowseListing = {
  path: string;
  parent: string | null;
  entries: DirEntry[];
};

export type GitEntry = {
  path: string;
  status: string;
  insertions: number;
  deletions: number;
};

export type GitStatus = {
  repo: boolean;
  branch: string;
  insertions: number;
  deletions: number;
  entries: GitEntry[];
};

export type SessionInfo = {
  id: string;
  name: string;
  provider: string;
  mode: string;
  cwd: string;
  model: string | null;
};

export type SessionEvent =
  | { session_id: string; kind: "bytes"; data: string }
  | { session_id: string; kind: "screen"; text: string }
  | { session_id: string; kind: "json_line"; line: string }
  | { session_id: string; kind: "exit"; code: number }
  | { session_id: string; kind: "error"; message: string };

export type TermBackend = "vte" | "xterm";

export type TermBounds = {
  sessionId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  interactive: boolean;
  bg?: string;
  fg?: string;
};

export type StartSessionOpts = {
  providerId: string;
  mode: SessionMode;
  cwd?: string;
  name?: string;
  model?: string;
  systemPrompt?: string;
  resumeId?: string;
  continueLast?: boolean;
};

export type HistoryRepo = {
  path: string;
  name: string;
  opened_at: number;
};

export type SavedAgent = {
  id: string;
  provider: string;
  name: string;
  mode: string;
  resume_id: string | null;
};

export type SavedSession = {
  id: string;
  title: string;
  cwd: string;
  updated_at: number;
  agents: SavedAgent[];
  pinned?: boolean;
  archived?: boolean;
  goal?: string;
  brief?: string;
};

export type History = {
  repositories: HistoryRepo[];
  sessions: SavedSession[];
};

export type BrowserPushKind = "url" | "console" | "network" | "snapshot" | "design" | "scripts";

export type BrowserConsoleLine = { level: string; text: string };

export type BrowserNetLine = {
  kind: string;
  method: string | null;
  status: number | null;
  url: string;
};

export type BrowserPick = {
  selector: string;
  tag: string;
  text: string;
  html: string;
  role: string;
};

export type BrowserBookmark = { url: string; title: string };

export type BrowserCurrent = {
  running: boolean;
  url: string;
  title: string;
  viewport_w: number;
  viewport_h: number;
  console: BrowserConsoleLine[];
  network: BrowserNetLine[];
  scripts: string[];
  pick: BrowserPick | null;
  design: boolean;
  bookmarks: BrowserBookmark[];
  bookmark_bar: boolean;
};

export type BrowserUiEvent =
  | { type: "console"; level: string; text: string }
  | { type: "request"; method: string; url: string }
  | { type: "response"; status: number; url: string }
  | { type: "navigated"; url: string; title: string };

export const api = {
  listProviders: () => invoke<ProviderInfo[]>("list_providers"),
  openWorkspace: (path: string) => invoke<string>("open_workspace", { path }),
  workspaceCwd: () => invoke<string | null>("workspace_cwd"),
  listWorkspace: (path?: string) => invoke<DirEntry[]>("list_workspace", { path: path ?? null }),
  readWorkspaceFile: (path: string) => invoke<string>("read_workspace_file", { path }),
  writeWorkspaceFile: (path: string, body: string) =>
    invoke<void>("write_workspace_file", { path, body }),
  writeUserFile: (path: string, body: string) => invoke<void>("write_user_file", { path, body }),
  readUserFile: (path: string) => invoke<string>("read_user_file", { path }),
  listMarkdown: () => invoke<DirEntry[]>("list_markdown"),
  browseDir: (path?: string) => invoke<BrowseListing>("browse_dir", { path: path ?? null }),
  gitStatus: (cwd?: string) => invoke<GitStatus>("git_status", { cwd: cwd ?? null }),
  historyGet: () => invoke<History>("history_get"),
  historyUpsertSession: (session: SavedSession) =>
    invoke<History>("history_upsert_session", { session }),
  historyDeleteSession: (id: string) => invoke<History>("history_delete_session", { id }),
  historyDeleteAgent: (sessionId: string, agentId: string) =>
    invoke<History>("history_delete_agent", { sessionId, agentId }),
  historyMoveAgent: (fromSession: string, toSession: string, agentId: string) =>
    invoke<History>("history_move_agent", { fromSession, toSession, agentId }),
  historyListTurns: (agentId: string) => invoke<ChatTurn[]>("history_list_turns", { agentId }),
  historyPutTurn: (agentId: string, seq: number, turn: ChatTurn) =>
    invoke<void>("history_put_turn", { agentId, seq, turn }),
  historyReplaceTurns: (agentId: string, turns: ChatTurn[]) =>
    invoke<void>("history_replace_turns", { agentId, turns }),
  startSession: (opts: StartSessionOpts) =>
    invoke<SessionInfo>("start_session", {
      providerId: opts.providerId,
      mode: opts.mode,
      cwd: opts.cwd ?? null,
      name: opts.name ?? null,
      model: opts.model ?? null,
      systemPrompt: opts.systemPrompt ?? null,
      resumeId: opts.resumeId ?? null,
      continueLast: opts.continueLast ?? false,
    }),
  startShell: (cwd?: string) => invoke<SessionInfo>("start_shell", { cwd: cwd ?? null }),
  listSessions: () => invoke<SessionInfo[]>("list_sessions"),
  sessionWrite: (sessionId: string, data: string) =>
    invoke<void>("session_write", { sessionId, data }),
  sessionResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("session_resize", { sessionId, cols, rows }),
  sessionKill: (sessionId: string) => invoke<void>("session_kill", { sessionId }),
  sessionInterrupt: (sessionId: string) => invoke<void>("session_interrupt", { sessionId }),
  termBackend: () => invoke<TermBackend>("term_backend"),
  termSetBounds: (opts: TermBounds) =>
    invoke<void>("term_set_bounds", {
      sessionId: opts.sessionId,
      x: opts.x,
      y: opts.y,
      w: opts.w,
      h: opts.h,
      visible: opts.visible,
      interactive: opts.interactive,
      bg: opts.bg ?? null,
      fg: opts.fg ?? null,
    }),
  termClose: (sessionId: string) => invoke<void>("term_close", { sessionId }),
  sendSelectionStub: () => invoke<{ ok: boolean; reason: string }>("send_selection_stub"),
  browserEnsure: () => invoke<BrowserCurrent>("browser_ensure"),
  browserNavigate: (url: string) => invoke<BrowserCurrent>("browser_navigate", { url }),
  browserCurrent: () => invoke<BrowserCurrent>("browser_current"),
  browserSetViewport: (w: number, h: number) => invoke<BrowserCurrent>("browser_set_viewport", { w, h }),
  browserReload: () => invoke<BrowserCurrent>("browser_reload"),
  browserHistoryGo: (back: boolean) => invoke<BrowserCurrent>("browser_history_go", { back }),
  browserSetDesign: (on: boolean) => invoke<BrowserCurrent>("browser_set_design", { on }),
  browserAckPick: () => invoke<void>("browser_ack_pick"),
  browserOpenDevtools: () => invoke<void>("browser_open_devtools"),
  browserClearData: () => invoke<void>("browser_clear_data"),
  browserToggleBookmark: () => invoke<BrowserCurrent>("browser_toggle_bookmark"),
  browserSetBookmarkBar: (on: boolean) => invoke<BrowserCurrent>("browser_set_bookmark_bar", { on }),
  browserSetBounds: (x: number, y: number, w: number, h: number) =>
    invoke<void>("browser_set_bounds", { x, y, w, h }),
  browserSetVisible: (visible: boolean) => invoke<void>("browser_set_visible", { visible }),
  browserClose: () => invoke<void>("browser_close"),
  browserPushToSession: (sessionId: string, kind: BrowserPushKind) =>
    invoke<void>("browser_push_to_session", { sessionId, kind }),
  statsEnabled: () => invoke<boolean>("stats_enabled"),
  /** `fields` is a JSON object body without the braces. */
  statsLog: (event: string, fields: string) => invoke<void>("stats_log", { event, fields }),
  mcpListTools: () => invoke<{ name: string; description: string }[]>("mcp_list_tools"),
  mcpListResources: () => invoke<{ uri: string; name: string }[]>("mcp_list_resources"),
};
