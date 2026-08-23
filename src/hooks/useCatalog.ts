// The app's own catalog in SQLite: repositories, session-groups, agent rows and
// the legacy turns table. This is chrome state only — the conversation itself
// belongs to the vendor CLI (docs/architecture.md § Sessões).
//
// Every write goes through the Rust side and replaces the whole `History`, so
// the tree never drifts from the database.

import { useState } from "react";
import { api, type History, type SavedAgent, type SavedSession } from "../lib/commands";
import { hydrateTurns, type ChatTurn } from "../lib/chat";
import type { UiSession } from "../lib/ui-model";

const EMPTY: History = { repositories: [], sessions: [] };

function stamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function useCatalog({
  showToast,
  onAgentRenamed,
  onAgentMoved,
}: {
  showToast: (msg: string) => void;
  /** A catalog rename must also retitle the live pane. */
  onAgentRenamed: (agentId: string, name: string) => void;
  /** A drag between groups must also move the live pane. */
  onAgentMoved: (agentId: string, toGroupId: string) => void;
}) {
  const [history, setHistory] = useState<History>(EMPTY);

  // Tree presentation, kept next to the data it filters.
  const [openRepos, setOpenRepos] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");

  async function reload(): Promise<History> {
    const next = await api.historyGet();
    setHistory(next);
    return next;
  }

  /** Write a group and keep the returned History. Returns null on failure. */
  async function upsert(payload: SavedSession): Promise<History | null> {
    try {
      const next = await api.historyUpsertSession(payload);
      setHistory(next);
      return next;
    } catch (e) {
      showToast(String(e));
      return null;
    }
  }

  /** Record (or replace) one agent row for a live session. */
  async function persistSession(session: UiSession, title?: string, replaceAgentId?: string) {
    const groupId = session.groupId;
    let existing: SavedSession | undefined;
    try {
      existing = (await api.historyGet()).sessions.find((g) => g.id === groupId);
    } catch {
      existing = history.sessions.find((g) => g.id === groupId);
    }
    const catalogId = session.catalogId || replaceAgentId || session.id;
    const task = existing?.title || title || session.name;
    const agent = {
      id: catalogId,
      provider: session.provider,
      name: session.name,
      mode: session.view,
      resume_id: session.resumeId ?? null,
    };
    // Drop rows that describe this same agent under an older id or resume id.
    const agents = existing
      ? [
          ...existing.agents.filter((a) => {
            if (a.id === catalogId || a.id === session.id || a.id === replaceAgentId) return false;
            if (session.resumeId && a.resume_id === session.resumeId) return false;
            if (!a.resume_id && !session.resumeId && a.provider === session.provider && a.name === session.name) {
              return false;
            }
            return true;
          }),
          agent,
        ]
      : [agent];
    await upsert({
      id: groupId,
      title: task.slice(0, 120),
      cwd: session.cwd,
      updated_at: stamp(),
      agents,
      pinned: existing?.pinned ?? false,
      archived: existing?.archived ?? false,
      goal: existing?.goal ?? "",
      brief: existing?.brief ?? "",
    });
  }

  async function persistTurns(session: UiSession) {
    const catalogId = session.catalogId || session.id;
    try {
      await api.historyReplaceTurns(catalogId, session.turns);
    } catch (e) {
      showToast(String(e));
    }
  }

  async function loadTurns(agentId: string): Promise<ChatTurn[]> {
    try {
      return hydrateTurns(await api.historyListTurns(agentId));
    } catch (e) {
      showToast(String(e));
      return [];
    }
  }

  async function pinGroup(group: SavedSession) {
    await upsert({ ...group, pinned: !group.pinned, updated_at: stamp() });
  }

  async function archiveGroup(group: SavedSession) {
    await upsert({ ...group, archived: !group.archived, updated_at: stamp() });
  }

  async function renameAgent(group: SavedSession, agent: { id: string; name: string }) {
    const answer = window.prompt("Nome do agente", agent.name);
    if (answer == null) return;
    const name = answer.trim();
    if (!name) return;
    const agents = group.agents.map((a) => (a.id === agent.id ? { ...a, name } : a));
    const next = await upsert({ ...group, agents, updated_at: stamp() });
    if (next) onAgentRenamed(agent.id, name);
  }

  /** Agents only move between groups of the same folder. */
  async function moveAgent(from: SavedSession, to: SavedSession, agent: SavedAgent) {
    if (from.cwd !== to.cwd) {
      showToast("Só podes arrastar entre sessões da mesma pasta.");
      return;
    }
    try {
      setHistory(await api.historyMoveAgent(from.id, to.id, agent.id));
      onAgentMoved(agent.id, to.id);
    } catch (e) {
      showToast(String(e));
    }
  }

  async function deleteGroup(groupId: string) {
    try {
      setHistory(await api.historyDeleteSession(groupId));
    } catch (e) {
      showToast(String(e));
    }
  }

  async function deleteAgent(groupId: string, agentId: string) {
    try {
      setHistory(await api.historyDeleteAgent(groupId, agentId));
    } catch (e) {
      showToast(String(e));
    }
  }

  function markRepoOpen(path: string, open: boolean) {
    setOpenRepos((m) => ({ ...m, [path]: open }));
  }

  function markReposOpen(paths: string[]) {
    setOpenRepos((m) => ({ ...m, ...Object.fromEntries(paths.map((p) => [p, true])) }));
  }

  return {
    history,
    setHistory,
    reload,
    upsert,
    persistSession,
    persistTurns,
    loadTurns,
    pinGroup,
    archiveGroup,
    renameAgent,
    moveAgent,
    deleteGroup,
    deleteAgent,
    // tree presentation
    openRepos,
    markRepoOpen,
    markReposOpen,
    showArchived,
    setShowArchived,
    query,
    setQuery,
  };
}
