// Everything about the right bar: one shelf of tool tabs per session-group,
// plus the work each tool kind does (list files, read git, start a shell,
// load a Markdown into the canvas).
//
// The hook owns no knowledge of agents beyond what it is handed: `focusedSession`
// resolves the current owner and cwd at call time, so it always sees fresh state.

import { useEffect, useRef, useState } from "react";
import { api, type DirEntry, type GitStatus } from "../lib/commands";
import { isImageName, isMarkdownName, nextUntitledName } from "../lib/files";
import { normPath, parentDir } from "../lib/paths";
import {
  canCommandTool,
  makeToolTab,
  newToolId,
  type CanvasTool,
  type FilesTool,
  type ToolKind,
  type ToolOwner,
  type ToolShelf,
  type ToolTab,
} from "../lib/tool-model";
import { FILES_EXPLORER_MAX, FILES_EXPLORER_MIN, TOOL_MAX, TOOL_MIN } from "../lib/ui-metrics";
import { useStoredPx } from "../layout";

/** What the shelf needs to know about the focused agent. */
export type ShelfOwnerHint = { id: string; name: string; groupId: string; cwd: string } | null;

export function useToolShelf({
  cwd,
  focusedSession,
  showToast,
  onBrowseMarkdown,
}: {
  cwd: string;
  focusedSession: () => ShelfOwnerHint;
  showToast: (msg: string) => void;
  /** Opens the file browser in Markdown mode; the picked file lands back via `pendingCanvasTab`. */
  onBrowseMarkdown: () => void;
}) {
  const [shelves, setShelves] = useState<Record<string, ToolShelf>>({});
  const shelvesRef = useRef(shelves);
  shelvesRef.current = shelves;
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useStoredPx("cc-tool-w", 420, TOOL_MIN, TOOL_MAX);
  const [explorerW, setExplorerW] = useStoredPx("cc-files-explorer-w", 180, FILES_EXPLORER_MIN, FILES_EXPLORER_MAX);
  const [mdFiles, setMdFiles] = useState<DirEntry[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusPos, setPlusPos] = useState({ top: 0, left: 0 });

  const sideTabsRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const canvasPickId = useRef<string | null>(null);

  function shelfKeyOf(): string {
    return focusedSession()?.groupId || "_";
  }

  function ownerOf(): ToolOwner {
    const s = focusedSession();
    if (!s) return { ownerAgentId: null, ownerName: "tu" };
    return { ownerAgentId: s.id, ownerName: s.name };
  }

  function patchShelf(key: string, fn: (s: ToolShelf) => ToolShelf) {
    const k = key || "_";
    setShelves((all) => ({ ...all, [k]: fn(all[k] ?? { tabs: [], activeId: null }) }));
  }

  const key = shelfKeyOf();
  const shelf = shelves[key] ?? { tabs: [] as ToolTab[], activeId: null as string | null };
  const tabs = shelf.tabs;
  const activeId = shelf.activeId;
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  /** True when the active tool belongs to another agent: read-only for us. */
  const locked = activeTab ? !canCommandTool(activeTab, focusedSession()?.id ?? null) : false;

  // Switching session-group opens the bar only if that group already has tabs.
  useEffect(() => {
    setOpen((shelvesRef.current[key]?.tabs.length ?? 0) > 0);
  }, [key]);

  // Vertical wheel over the panel scrolls the tab strip horizontally.
  useEffect(() => {
    const chrome = chromeRef.current;
    const strip = sideTabsRef.current;
    if (!chrome || !strip || !open) return;
    const onWheel = (e: WheelEvent) => {
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? strip.clientWidth : 1;
      e.preventDefault();
      strip.scrollLeft += raw * unit;
    };
    chrome.addEventListener("wheel", onWheel, { passive: false });
    return () => chrome.removeEventListener("wheel", onWheel);
  }, [open, tabs.length]);

  useEffect(() => {
    if (!activeId || !open) return;
    sideTabsRef.current
      ?.querySelector(`[data-tool-id="${activeId}"]`)
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId, tabs.length, open]);

  // ── tab lifecycle ──────────────────────────────────────────────────────────
  function openTool(kind: ToolKind) {
    if (!cwd && kind === "files") {
      showToast("Abre uma pasta primeiro.");
      return;
    }
    const k = shelfKeyOf();
    const tab = makeToolTab(kind, ownerOf());
    setOpen(true);
    patchShelf(k, (s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
    setPlusOpen(false);
    if (kind === "files") void loadFiles(k, tab.id);
    if (kind === "canvas") void refreshMarkdownList();
    if (kind === "changes") void loadGit(k, tab.id);
    if (kind === "terminal") void startShellFor(k, tab.id);
    if (kind === "browser") void api.browserEnsure().catch((e) => showToast(String(e)));
  }

  /** Closing flushes an unsaved editor, kills a shell, and drops the webview
   *  once no shelf anywhere still holds a browser tab. */
  function closeTool(id: string) {
    const k = shelfKeyOf();
    setShelves((all) => {
      const s = all[k] ?? { tabs: [], activeId: null };
      const closing = s.tabs.find((t) => t.id === id);
      if (closing?.kind === "terminal" && closing.shellId) {
        void api.sessionKill(closing.shellId).catch(() => undefined);
      }
      if (closing?.kind === "files" && closing.filePath && closing.content != null && closing.content !== closing.saved) {
        void api.writeWorkspaceFile(closing.filePath, closing.content).catch((e) => showToast(String(e)));
      }
      const left = s.tabs.filter((t) => t.id !== id);
      if (left.length === 0) setOpen(false);
      const next = {
        ...all,
        [k]: { tabs: left, activeId: s.activeId !== id ? s.activeId : left[left.length - 1]?.id ?? null },
      };
      const anyBrowser = Object.values(next).some((sh) => sh.tabs.some((t) => t.kind === "browser"));
      if (!anyBrowser) void api.browserClose().catch(() => undefined);
      return next;
    });
  }

  function selectTab(id: string) {
    patchShelf(shelfKeyOf(), (s) => ({ ...s, activeId: id }));
  }

  function openPlus(e: { currentTarget: HTMLElement }) {
    const r = e.currentTarget.getBoundingClientRect();
    setPlusPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 292)) });
    setPlusOpen((v) => !v);
  }

  /** Show the browser tab of `owner`'s group, creating it if needed. */
  function showBrowserTab(owner: ShelfOwnerHint) {
    const k = owner?.groupId || shelfKeyOf();
    const asOwner: ToolOwner = owner ? { ownerAgentId: owner.id, ownerName: owner.name } : ownerOf();
    const existing = (shelvesRef.current[k]?.tabs ?? []).find((t) => t.kind === "browser");
    setOpen(true);
    if (existing) patchShelf(k, (s) => ({ ...s, activeId: existing.id }));
    else {
      const tab = makeToolTab("browser", asOwner);
      patchShelf(k, (s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
    }
  }

  // ── files tool ─────────────────────────────────────────────────────────────
  async function loadFiles(k: string, id: string) {
    try {
      const entries = await api.listWorkspace();
      patchShelf(k, (s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === id && t.kind === "files" ? { ...t, entries } : t)),
      }));
    } catch (e) {
      showToast(String(e));
    }
  }

  /** After opening a workspace, refresh the root listing of every root files tab. */
  function syncRootEntries(entries: DirEntry[]) {
    setShelves((all) => {
      const next = { ...all };
      for (const k of Object.keys(next)) {
        next[k] = {
          ...next[k],
          tabs: next[k].tabs.map((t) => (t.kind === "files" && !t.dir ? { ...t, entries } : t)),
        };
      }
      return next;
    });
  }

  function patchFiles(id: string, patch: Partial<FilesTool>) {
    patchShelf(shelfKeyOf(), (s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === id && t.kind === "files" ? { ...t, ...patch } : t)),
    }));
  }

  function mayCommand(tab: ToolTab): boolean {
    return canCommandTool(tab, focusedSession()?.id ?? null);
  }

  /** Flush an unsaved editor before navigating away from it. */
  async function persistIfDirty(tab: FilesTool): Promise<boolean> {
    if (tab.media === "image") return true;
    if (tab.content == null || !tab.filePath || tab.content === tab.saved) return true;
    try {
      await api.writeWorkspaceFile(tab.filePath, tab.content);
      return true;
    } catch (e) {
      showToast(String(e));
      return false;
    }
  }

  async function saveFile(tab: FilesTool) {
    if (!mayCommand(tab)) return;
    if (tab.media === "image") return;
    if (tab.content == null || !tab.filePath) return;
    if (tab.content === tab.saved) return;
    try {
      await api.writeWorkspaceFile(tab.filePath, tab.content);
      patchFiles(tab.id, { saved: tab.content });
    } catch (e) {
      showToast(String(e));
    }
  }

  async function toggleDir(tab: FilesTool, ent: DirEntry) {
    if (tab.open.includes(ent.path)) {
      patchFiles(tab.id, { open: tab.open.filter((p) => p !== ent.path) });
      return;
    }
    try {
      const kids = tab.kids[ent.path] ?? (await api.listWorkspace(ent.path));
      patchFiles(tab.id, { open: [...tab.open, ent.path], kids: { ...tab.kids, [ent.path]: kids } });
    } catch (e) {
      showToast(String(e));
    }
  }

  /** Expand every level down to `dir` so a breadcrumb click reveals the tree. */
  async function revealFolder(tab: FilesTool, dir?: string) {
    if (!dir || !cwd) return;
    try {
      const kids = { ...tab.kids };
      const opened = new Set(tab.open);
      const base = normPath(cwd);
      const cur = normPath(dir);
      const rel = cur.startsWith(base) ? cur.slice(base.length).replace(/^\//, "") : "";
      let acc = base;
      for (const part of rel.split("/").filter(Boolean)) {
        acc = `${acc}/${part}`;
        opened.add(acc);
        if (!kids[acc]) kids[acc] = await api.listWorkspace(acc);
      }
      patchFiles(tab.id, { kids, open: [...opened] });
    } catch (e) {
      showToast(String(e));
    }
  }

  async function openEntry(tab: FilesTool, ent: DirEntry) {
    if (ent.is_dir) {
      await toggleDir(tab, ent);
      return;
    }
    if (!(await persistIfDirty(tab))) return;
    const parent = parentDir(ent.path);
    const dir = parent === normPath(cwd) ? undefined : parent;
    if (isImageName(ent.name)) {
      patchFiles(tab.id, {
        file: ent.name,
        filePath: ent.path,
        content: undefined,
        saved: undefined,
        media: "image",
        view: "preview",
        dir,
      });
      return;
    }
    try {
      let text: string;
      try {
        text = await api.readWorkspaceFile(ent.path);
      } catch {
        text = await api.readUserFile(ent.path);
      }
      patchFiles(tab.id, {
        file: ent.name,
        filePath: ent.path,
        content: text,
        saved: text,
        media: "text",
        view: isMarkdownName(ent.name) ? "preview" : "code",
        dir,
      });
    } catch (e) {
      showToast(String(e));
    }
  }

  async function newWorkspaceFile(tab: FilesTool) {
    if (!mayCommand(tab)) return;
    if (!cwd) {
      showToast("Abre uma pasta primeiro.");
      return;
    }
    if (!(await persistIfDirty(tab))) return;
    const name = nextUntitledName(tab.entries.map((e) => e.name));
    const path = `${normPath(cwd)}/${name}`;
    try {
      await api.writeWorkspaceFile(path, "");
      const entries = await api.listWorkspace();
      patchFiles(tab.id, {
        entries,
        file: name,
        filePath: path,
        content: "",
        saved: "",
        media: "text",
        view: "code",
        dir: undefined,
      });
    } catch (e) {
      showToast(String(e));
    }
  }

  // ── canvas tool ────────────────────────────────────────────────────────────
  async function refreshMarkdownList() {
    try {
      setMdFiles(await api.listMarkdown());
    } catch {
      setMdFiles([]);
    }
  }

  /** Remember which canvas tab asked, then hand the browser over to App. */
  function pickMarkdown(tabId: string) {
    canvasPickId.current = tabId;
    onBrowseMarkdown();
  }

  /** The tab that is waiting for a Markdown pick, consumed once. */
  function takePendingCanvasTab(): string | undefined {
    const id = canvasPickId.current;
    canvasPickId.current = null;
    return id ?? undefined;
  }

  async function openCanvasFile(path: string, name: string, tabId?: string) {
    const k = shelfKeyOf();
    try {
      let md: string;
      try {
        md = await api.readWorkspaceFile(path);
      } catch {
        md = await api.readUserFile(path);
      }
      if (!cwd) {
        showToast("Abre uma pasta primeiro.");
        return;
      }
      if (tabId) {
        patchShelf(k, (s) => ({
          ...s,
          activeId: tabId,
          tabs: s.tabs.map((t) => (t.id === tabId && t.kind === "canvas" ? { ...t, title: name, md } : t)),
        }));
      } else {
        const owner = ownerOf();
        const tab: CanvasTool = {
          id: newToolId(),
          kind: "canvas",
          title: name,
          md,
          ownerAgentId: owner.ownerAgentId,
          ownerName: owner.ownerName,
        };
        patchShelf(k, (s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      }
      setOpen(true);
      setPlusOpen(false);
    } catch (e) {
      showToast(String(e));
    }
  }

  function clearCanvas(tabId: string) {
    patchShelf(shelfKeyOf(), (s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === tabId && t.kind === "canvas" ? { ...t, title: "", md: "" } : t)),
    }));
    void refreshMarkdownList();
  }

  // ── changes tool ───────────────────────────────────────────────────────────
  async function loadGit(k: string, id: string) {
    const dir = focusedSession()?.cwd || cwd;
    const empty: GitStatus = { repo: false, branch: "", insertions: 0, deletions: 0, entries: [] };
    const put = (git: GitStatus) =>
      patchShelf(k, (s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === id && t.kind === "changes" ? { ...t, git } : t)),
      }));
    if (!dir) {
      put(empty);
      return;
    }
    try {
      put(await api.gitStatus(dir));
    } catch (e) {
      showToast(String(e));
      put(empty);
    }
  }

  // ── terminal tool ──────────────────────────────────────────────────────────
  async function startShellFor(k: string, id: string) {
    try {
      const sh = await api.startShell(focusedSession()?.cwd || cwd || undefined);
      patchShelf(k, (s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === id && t.kind === "terminal" ? { ...t, shellId: sh.id } : t)),
      }));
    } catch (e) {
      showToast(String(e));
    }
  }

  return {
    // panel state
    open,
    setOpen,
    width,
    setWidth,
    chromeRef,
    sideTabsRef,
    // tabs
    tabs,
    activeId,
    activeTab,
    locked,
    selectTab,
    openTool,
    closeTool,
    showBrowserTab,
    // the `+` popover
    plusOpen,
    plusPos,
    openPlus,
    closePlus: () => setPlusOpen(false),
    // per-tool work
    explorerW,
    setExplorerW,
    patchFiles,
    revealFolder,
    toggleDir,
    openEntry,
    newWorkspaceFile,
    saveFile,
    syncRootEntries,
    mdFiles,
    pickMarkdown,
    takePendingCanvasTab,
    openCanvasFile,
    clearCanvas,
    refreshGit: (tabId: string) => void loadGit(shelfKeyOf(), tabId),
  };
}
