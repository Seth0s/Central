// Left bar: Novo chat, search/archive filters, and the Projects tree
// (folder → session-group → agents). Owns no state beyond what it is handed.

import type { ComponentProps } from "react";
import { Archive, Folder, FolderOpen, FolderPlus, MessageSquarePlus, MessagesSquare, Search, Settings } from "lucide-react";
import { UiIcon } from "../icons";
import { SidebarPanel, SidebarToggle } from "../layout";
import SessionTree, { type LiveAgentView } from "../SessionTree";
import type { History } from "../lib/commands";
import { sameCwd } from "../lib/paths";
import { SIDEBAR_MAX, SIDEBAR_MIN } from "../lib/ui-metrics";

/** Every row action the tree can raise, forwarded straight to App. */
export type SessionTreeHandlers = Pick<
  ComponentProps<typeof SessionTree>,
  | "onSelectGroup"
  | "onSelectAgent"
  | "onSelectTask"
  | "onAddAgent"
  | "onRenameSession"
  | "onRenameAgent"
  | "onDeleteSession"
  | "onDeleteAgent"
  | "onStopAgent"
  | "onOpenSplit"
  | "onPinSession"
  | "onArchiveSession"
  | "onExportSession"
  | "onMoveAgent"
  | "onSendToSibling"
  | "onMenuOpen"
>;

export default function ProjectsSidebar({
  width,
  onResize,
  onClose,
  history,
  cwd,
  openRepos,
  onOpenRepo,
  query,
  onQuery,
  showArchived,
  onShowArchived,
  live,
  activeId,
  onNewChat,
  onPickWorkspace,
  onNewSession,
  onSettings,
  tree,
}: {
  width: number;
  onResize: (px: number) => void;
  onClose: () => void;
  history: History;
  cwd: string;
  openRepos: Record<string, boolean>;
  onOpenRepo: (path: string, open: boolean) => void;
  query: string;
  onQuery: (q: string) => void;
  showArchived: boolean;
  onShowArchived: (v: boolean) => void;
  live: LiveAgentView[];
  activeId: string | null;
  onNewChat: () => void;
  onPickWorkspace: () => void;
  onNewSession: (repoPath: string) => void;
  onSettings: () => void;
  tree: SessionTreeHandlers;
}) {
  return (
    <SidebarPanel
      side="left"
      width={width}
      min={SIDEBAR_MIN}
      max={SIDEBAR_MAX}
      onResize={onResize}
      label="Barra esquerda"
      className="sidebar"
      header={<SidebarToggle side="left" open onClick={onClose} />}
    >
      <section className="sidebar-content">
        <button type="button" className="nav-action" onClick={onNewChat}>
          <UiIcon icon={MessageSquarePlus} size={18} />
          Novo chat
        </button>
        <div className="tree-toolbar">
          <label className="tree-search">
            <UiIcon icon={Search} size={14} />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Pesquisar"
              aria-label="Pesquisar sessões"
            />
          </label>
          <button
            type="button"
            className={`tree-filter${showArchived ? " on" : ""}`}
            title="Arquivo"
            aria-pressed={showArchived}
            onClick={() => onShowArchived(!showArchived)}
          >
            <UiIcon icon={Archive} size={14} />
          </button>
        </div>
        <div className="repo-head">
          <h2 className="tree-section-label">Projects</h2>
          <button type="button" className="tiny" title="Abrir pasta" onClick={onPickWorkspace}>
            <UiIcon icon={FolderPlus} size={14} />
          </button>
        </div>
        {history.repositories.length === 0 && <p className="muted">Abre uma pasta no ícone de pasta.</p>}
        {history.repositories.map((repo) => {
          const kids = history.sessions.filter((s) => sameCwd(s.cwd, repo.path));
          const current = sameCwd(repo.path, cwd);
          const forced = Object.entries(openRepos).find(([k]) => sameCwd(k, repo.path))?.[1];
          const isOpen = forced ?? (current || kids.length > 0);
          return (
            <div key={repo.path} className="repo-block">
              <div className="repo-summary">
                <button type="button" className="repo-folder" onClick={() => onOpenRepo(repo.path, !isOpen)}>
                  <UiIcon icon={isOpen ? FolderOpen : Folder} size={16} />
                  <span className="repo-name">{repo.name}</span>
                </button>
                <button
                  type="button"
                  className="repo-add"
                  title={`Nova sessão em ${repo.name}`}
                  aria-label={`Nova sessão em ${repo.name}`}
                  onClick={() => onNewSession(repo.path)}
                >
                  <UiIcon icon={MessagesSquare} size={14} />
                </button>
              </div>
              {isOpen && kids.length === 0 && <p className="muted nested">Sem sessões gravadas.</p>}
              {isOpen && kids.length > 0 && (
                <SessionTree
                  groups={kids}
                  live={live}
                  activeId={activeId}
                  query={query}
                  showArchived={showArchived}
                  {...tree}
                />
              )}
            </div>
          );
        })}
      </section>
      <div className="sidebar-foot">
        <button type="button" className="nav-action" onClick={onSettings}>
          <UiIcon icon={Settings} size={18} />
          Configurações
        </button>
      </div>
    </SidebarPanel>
  );
}

