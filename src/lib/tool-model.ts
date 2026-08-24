// The right-bar tool shelf: what a tool tab is, who owns it, who may drive it.
// A shelf belongs to a session-group, not to a folder (docs/architecture.md § Ferramentas).

import type { DirEntry, GitStatus } from "./commands";

export type ToolKind = "files" | "canvas" | "terminal" | "changes" | "browser";

export const TOOL_LABEL: Record<ToolKind, string> = {
  files: "Arquivos",
  canvas: "Canvas",
  terminal: "Terminal",
  changes: "Alterações",
  browser: "Navegador",
};

export type FilesTool = {
  id: string;
  kind: "files";
  ownerAgentId: string | null;
  ownerName: string;
  dir?: string;
  file?: string;
  filePath?: string;
  content?: string;
  saved?: string;
  media?: "text" | "image";
  view: "code" | "preview";
  explorer: boolean;
  entries: DirEntry[];
  kids: Record<string, DirEntry[]>;
  open: string[];
  loading?: boolean;
};
export type CanvasTool = {
  id: string;
  kind: "canvas";
  ownerAgentId: string | null;
  ownerName: string;
  title: string;
  md: string;
  loading?: boolean;
};
export type TerminalTool = {
  id: string;
  kind: "terminal";
  ownerAgentId: string | null;
  ownerName: string;
  shellId: string | null;
  stopped?: boolean;
};
export type ChangesTool = { id: string; kind: "changes"; ownerAgentId: string | null; ownerName: string; git: GitStatus | null };
export type BrowserTool = { id: string; kind: "browser"; ownerAgentId: string | null; ownerName: string };
export type ToolTab = FilesTool | CanvasTool | TerminalTool | ChangesTool | BrowserTool;
export type ToolShelf = { tabs: ToolTab[]; activeId: string | null };
export type ToolOwner = { ownerAgentId: string | null; ownerName: string };

let toolSeq = 0;
export function newToolId(): string {
  toolSeq += 1;
  return `tool-${toolSeq}`;
}

export function makeToolTab(kind: ToolKind, owner: ToolOwner): ToolTab {
  const id = newToolId();
  const meta = { id, ownerAgentId: owner.ownerAgentId, ownerName: owner.ownerName };
  if (kind === "files") return { ...meta, kind, entries: [], kids: {}, open: [], view: "code", explorer: true, loading: true };
  if (kind === "canvas") return { ...meta, kind, title: "", md: "", loading: true };
  if (kind === "terminal") return { ...meta, kind, shellId: null };
  if (kind === "browser") return { ...meta, kind };
  return { ...meta, kind, git: null };
}

export function toolTabLabel(tab: ToolTab, tabs: ToolTab[]): string {
  const same = tabs.filter((t) => t.kind === tab.kind);
  const base = same.length < 2 ? TOOL_LABEL[tab.kind] : `${TOOL_LABEL[tab.kind]} ${same.findIndex((t) => t.id === tab.id) + 1}`;
  return `${base} · ${tab.ownerName || "tu"}`;
}

/** Only the owning agent drives a tool; a user with no agent focused always may. */
export function canCommandTool(tab: ToolTab, focusedAgentId: string | null): boolean {
  if (!tab.ownerAgentId) return true;
  if (!focusedAgentId) return true;
  return tab.ownerAgentId === focusedAgentId;
}
