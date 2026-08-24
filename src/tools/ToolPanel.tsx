// Right bar: the tool shelf of the active session-group. The tab strip lives in
// the panel header; below it exactly one tool body shows.
//
// Invariant worth keeping: every terminal tab stays mounted and merely `hidden`,
// because unmounting a TermView kills its shell PTY. The other bodies are
// mounted only when active.

import type { MutableRefObject } from "react";
import { Plus, X } from "lucide-react";
import { TOOL_ICON, UiIcon } from "../icons";
import { SidebarPanel, SidebarToggle } from "../layout";
import { TermView } from "../NativeTermHost";
import BrowserPane from "../BrowserPane";
import Skeleton from "../ui/Skeleton";
import type { PtyHandle } from "../PtyTerm";
import type { DirEntry, TermBackend } from "../lib/commands";
import { TOOL_MAX, TOOL_MIN } from "../lib/ui-metrics";
import type { Theme } from "../lib/ui-model";
import { canCommandTool, toolTabLabel, type FilesTool, type TerminalTool, type ToolTab } from "../lib/tool-model";
import FilesToolBody from "./FilesToolBody";
import CanvasToolBody from "./CanvasToolBody";
import ChangesToolBody from "./ChangesToolBody";

export type FilesToolHandlers = {
  explorerW: number;
  onExplorerW: (px: number) => void;
  onPatch: (id: string, patch: Partial<FilesTool>) => void;
  onReveal: (tab: FilesTool, dir?: string) => void;
  onToggleDir: (tab: FilesTool, ent: DirEntry) => void;
  onOpenEntry: (tab: FilesTool, ent: DirEntry) => void;
  onNewFile: (tab: FilesTool) => void;
  onSave: (tab: FilesTool) => void;
};

export type CanvasToolHandlers = {
  mdFiles: DirEntry[];
  onPick: (tabId: string) => void;
  onOpenFile: (path: string, name: string, tabId: string) => void;
  onClear: (tabId: string) => void;
};

export default function ToolPanel({
  width,
  onResize,
  onClose,
  chromeRef,
  sideTabsRef,
  tabs,
  activeId,
  onSelectTab,
  onCloseTab,
  onPlus,
  cwd,
  theme,
  locked,
  occluded,
  plusOpen = false,
  activeAgentId,
  termBackend,
  ptyRefs,
  onToast,
  agentUrls,
  files,
  canvas,
  onRefreshGit,
  onRestartTerminal,
}: {
  width: number;
  onResize: (px: number) => void;
  onClose: () => void;
  chromeRef: MutableRefObject<HTMLDivElement | null>;
  sideTabsRef: MutableRefObject<HTMLDivElement | null>;
  tabs: ToolTab[];
  activeId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onPlus: (e: { currentTarget: HTMLElement }) => void;
  cwd: string;
  theme: Theme;
  locked: boolean;
  occluded: boolean;
  plusOpen?: boolean;
  activeAgentId: string | null;
  termBackend: TermBackend | null;
  ptyRefs: MutableRefObject<Map<string, PtyHandle>>;
  onToast: (msg: string) => void;
  /** URLs the focused agent printed, offered by the browser tool. */
  agentUrls: string[];
  files: FilesToolHandlers;
  canvas: CanvasToolHandlers;
  onRefreshGit: (tabId: string) => void;
  onRestartTerminal: (tabId: string) => void;
}) {
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  return (
    <SidebarPanel
      side="right"
      width={width}
      min={TOOL_MIN}
      max={TOOL_MAX}
      onResize={onResize}
      label="Barra direita"
      className="tool-pane"
      chromeRef={chromeRef}
      header={
        <>
          <div className="side-tabs" ref={sideTabsRef}>
            <div className="side-tabs-row">
              {tabs.map((tab) => (
                <div key={tab.id} data-tool-id={tab.id} className={`tab ${tab.id === activeId ? "on" : ""}`}>
                  <button type="button" className="tab-hit" onClick={() => onSelectTab(tab.id)}>
                    <UiIcon icon={TOOL_ICON[tab.kind]} size={14} />
                    <span className="tab-agent">{toolTabLabel(tab, tabs)}</span>
                  </button>
                  <button
                    type="button"
                    className="tab-close"
                    onClick={() => onCloseTab(tab.id)}
                    aria-label={`Fechar ${toolTabLabel(tab, tabs)}`}
                  >
                    <UiIcon icon={X} size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="side-chrome-end">
            <button type="button" className="tab-add" onClick={onPlus} aria-label="Abrir ferramenta">
              <UiIcon icon={Plus} size={16} />
            </button>
            <SidebarToggle side="right" open onClick={onClose} />
          </div>
        </>
      }
    >
      {tabs
        .filter((t): t is TerminalTool => t.kind === "terminal")
        .map((tab) => (
          <div key={tab.id} className="tool-body" hidden={tab.id !== activeId}>
            {tab.shellId ? (
              <TermView
                sessionId={tab.shellId}
                className="pty-host"
                native={termBackend !== "xterm"}
                visible={tab.id === activeId && !occluded}
                interactive={tab.id === activeId && !occluded && !plusOpen && canCommandTool(tab, activeAgentId)}
                ptyRef={(h) => {
                  if (h && tab.shellId) ptyRefs.current.set(tab.shellId, h);
                  else if (tab.shellId) ptyRefs.current.delete(tab.shellId);
                }}
              />
            ) : tab.stopped ? (
              <div className="pane-empty">
                <p>Terminal parado</p>
                <button type="button" className="ghost" onClick={() => onRestartTerminal(tab.id)}>
                  Reiniciar
                </button>
              </div>
            ) : (
              <Skeleton.Pane label="A iniciar o terminal…" />
            )}
          </div>
        ))}

      {activeTab?.kind === "files" && (
        <FilesToolBody
          tab={activeTab}
          cwd={cwd}
          theme={theme}
          locked={locked}
          explorerW={files.explorerW}
          onExplorerW={files.onExplorerW}
          onPatch={(patch) => files.onPatch(activeTab.id, patch)}
          onReveal={(dir) => files.onReveal(activeTab, dir)}
          onToggleDir={(ent) => files.onToggleDir(activeTab, ent)}
          onOpenEntry={(ent) => files.onOpenEntry(activeTab, ent)}
          onNewFile={() => files.onNewFile(activeTab)}
          onSave={() => files.onSave(activeTab)}
        />
      )}

      {activeTab?.kind === "canvas" && (
        <CanvasToolBody
          tab={activeTab}
          cwd={cwd}
          theme={theme}
          locked={locked}
          mdFiles={canvas.mdFiles}
          onPick={() => canvas.onPick(activeTab.id)}
          onOpenFile={(path, name) => canvas.onOpenFile(path, name, activeTab.id)}
          onClear={() => canvas.onClear(activeTab.id)}
        />
      )}

      {activeTab?.kind === "changes" && (
        <ChangesToolBody tab={activeTab} onRefresh={() => onRefreshGit(activeTab.id)} />
      )}

      {activeTab?.kind === "browser" && (
        <BrowserPane
          sessionId={activeAgentId}
          occluded={occluded || plusOpen}
          onToast={onToast}
          readOnly={locked}
          agentUrls={agentUrls}
        />
      )}

      {!activeTab && (
        <div className="tool-body">
          <div className="pane-empty">
            <p>Abre uma ferramenta para começar</p>
            <button type="button" className="ghost" onClick={onPlus}>
              Abrir ferramenta
            </button>
          </div>
        </div>
      )}
    </SidebarPanel>
  );
}
