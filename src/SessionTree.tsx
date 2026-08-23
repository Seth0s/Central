import { useEffect, useMemo, useState, type DragEvent } from "react";
import type { SavedAgent, SavedSession } from "./lib/commands";
import type { AgentPulse, NestedAgent } from "./lib/chat";
import { UiIcon } from "./icons";
import { Bot, Check, EllipsisVertical, ListTodo, LoaderCircle, MessagesSquare, Pin, Send } from "lucide-react";

export type LiveAgentView = {
  id: string;
  catalogId?: string;
  groupId: string;
  name: string;
  status: "running" | "exit";
  nested: NestedAgent[];
  taskLabel: string;
  files: string[];
  cwd: string;
  resumeId?: string;
  pulse: AgentPulse;
};

const PULSE_LABEL: Record<AgentPulse, string> = {
  idle: "Inactivo",
  run: "Em execução",
  warn: "À espera de resposta",
  error: "Erro fatal",
};

function AgentOrb({ pulse }: { pulse: AgentPulse }) {
  return (
    <span className={`agent-orb ${pulse}`} title={PULSE_LABEL[pulse]} aria-label={PULSE_LABEL[pulse]}>
      <span className="agent-orb-core" />
      <span className="agent-orb-ring" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

type Menu =
  | { kind: "session"; x: number; y: number; group: SavedSession }
  | { kind: "agent"; x: number; y: number; group: SavedSession; agent: SavedAgent };

type SendPick = { x: number; y: number; group: SavedSession; agent: SavedAgent };

function matches(group: SavedSession, live: LiveAgentView[], q: string): boolean {
  if (!q) return true;
  const hay = [
    group.title,
    ...group.agents.map((a) => a.name),
    ...live.filter((l) => l.groupId === group.id).flatMap((l) => [l.taskLabel, ...l.nested.map((n) => n.title)]),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export default function SessionTree({
  groups,
  live,
  activeId,
  query,
  showArchived,
  onSelectGroup,
  onSelectAgent,
  onSelectTask,
  onAddAgent,
  onRenameSession,
  onRenameAgent,
  onDeleteSession,
  onDeleteAgent,
  onStopAgent,
  onOpenSplit,
  onPinSession,
  onArchiveSession,
  onExportSession,
  onMoveAgent,
  onSendToSibling,
  onMenuOpen,
}: {
  groups: SavedSession[];
  live: LiveAgentView[];
  activeId: string | null;
  query: string;
  showArchived: boolean;
  onSelectGroup: (group: SavedSession) => void;
  onSelectAgent: (group: SavedSession, agent: SavedAgent) => void;
  onSelectTask: (agentId: string, toolId: string) => void;
  onAddAgent: (group: SavedSession) => void;
  onRenameSession: (group: SavedSession) => void;
  onRenameAgent: (group: SavedSession, agent: SavedAgent) => void;
  onDeleteSession: (group: SavedSession) => void;
  onDeleteAgent: (group: SavedSession, agent: SavedAgent) => void;
  onStopAgent: (agentId: string) => void;
  onOpenSplit: (group: SavedSession, agent: SavedAgent) => void;
  onPinSession: (group: SavedSession) => void;
  onArchiveSession: (group: SavedSession) => void;
  onExportSession: (group: SavedSession) => void;
  onMoveAgent: (from: SavedSession, to: SavedSession, agent: SavedAgent) => void;
  onSendToSibling: (from: SavedSession, fromAgent: SavedAgent, to: SavedSession, toAgent: SavedAgent) => void;
  onMenuOpen: (open: boolean) => void;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [sendPick, setSendPick] = useState<SendPick | null>(null);
  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    const filtered = groups
      .filter((g) => (showArchived ? Boolean(g.archived) : !g.archived))
      .filter((g) => matches(g, live, q));
    return [...filtered].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updated_at - a.updated_at);
  }, [groups, live, q, showArchived]);

  useEffect(() => {
    function close() {
      setMenu(null);
      setSendPick(null);
    }
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    onMenuOpen(Boolean(menu || sendPick));
    return () => onMenuOpen(false);
  }, [menu, sendPick, onMenuOpen]);

  function liveOf(groupId: string, agent: SavedAgent) {
    return (
      live.find((l) => l.id === agent.id) ??
      live.find((l) => l.catalogId === agent.id) ??
      live.find((l) => Boolean(agent.resume_id) && l.resumeId === agent.resume_id) ??
      live.find((l) => l.groupId === groupId && l.name === agent.name)
    );
  }

  function onDragStart(e: DragEvent, group: SavedSession, agent: SavedAgent) {
    e.dataTransfer.setData("application/x-cc-agent", JSON.stringify({ groupId: group.id, agentId: agent.id, cwd: group.cwd }));
    e.dataTransfer.setData("text/plain", `${group.id}\t${agent.id}\t${group.cwd}`);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOverGroup(e: DragEvent, group: SavedSession) {
    const raw = e.dataTransfer.types.includes("application/x-cc-agent") || e.dataTransfer.types.includes("text/plain");
    if (!raw) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropId(group.id);
  }

  function onDropGroup(e: DragEvent, group: SavedSession) {
    e.preventDefault();
    setDropId(null);
    let payload: { groupId: string; agentId: string; cwd: string };
    try {
      const custom = e.dataTransfer.getData("application/x-cc-agent");
      payload = custom
        ? JSON.parse(custom)
        : (() => {
            const [groupId, agentId, cwd] = e.dataTransfer.getData("text/plain").split("\t");
            return { groupId, agentId, cwd };
          })();
    } catch {
      return;
    }
    if (!payload.groupId || !payload.agentId) return;
    if (payload.cwd !== group.cwd || payload.groupId === group.id) return;
    const from = groups.find((g) => g.id === payload.groupId);
    const agent = from?.agents.find((a) => a.id === payload.agentId);
    if (from && agent) onMoveAgent(from, group, agent);
  }

  const siblingsOf = sendPick ? sendPick.group.agents.filter((a) => a.id !== sendPick.agent.id) : [];

  return (
    <div className="session-tree">
      {visible.length === 0 && (
        <p className="muted nested">{showArchived ? "Arquivo vazio." : "Nada corresponde."}</p>
      )}
      {visible.map((group) => {
        const agents = group.agents ?? [];
        const groupLive = live.filter((l) => l.groupId === group.id);
        const selectedHere = agents.some((a) => {
          const lv = liveOf(group.id, a);
          return a.id === activeId || lv?.id === activeId;
        }) || groupLive.some((l) => l.id === activeId);
        const groupOpen = true;
        return (
          <div
            key={group.id}
            className={`tree-group${dropId === group.id ? " drop" : ""}`}
            onDragOver={(e) => onDragOverGroup(e, group)}
            onDragLeave={() => setDropId((id) => (id === group.id ? null : id))}
            onDrop={(e) => onDropGroup(e, group)}
          >
            <div className={`tree-flat-row${selectedHere && agents.length === 0 ? " on" : ""}`}>
              <button
                type="button"
                className="tree-flat"
                onClick={() => onSelectGroup(group)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: "session", x: e.clientX, y: e.clientY, group });
                }}
              >
                <UiIcon icon={MessagesSquare} size={14} />
                {group.pinned ? <UiIcon icon={Pin} size={11} /> : null}
                <span className="tree-title">{group.title || "Sessão"}</span>
              </button>
              <button
                type="button"
                className="tree-icon ghost-hover"
                title="Adicionar agente"
                onClick={() => onAddAgent(group)}
              >
                <UiIcon icon={Bot} size={14} />
              </button>
              <button
                type="button"
                className="tree-icon ghost-hover"
                title="Mais"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ kind: "session", x: r.left, y: r.bottom, group });
                }}
              >
                <UiIcon icon={EllipsisVertical} size={14} />
              </button>
            </div>
            {groupOpen && (
              <div className="tree-children">
                {agents.map((agent) => {
                  const lv = liveOf(group.id, agent);
                  const selected = activeId === agent.id || activeId === lv?.id;
                  const pulse = lv?.pulse ?? "idle";
                  return (
                    <div
                      key={agent.id}
                      className="tree-child"
                      draggable
                      onDragStart={(e) => onDragStart(e, group, agent)}
                    >
                      <div className={`tree-flat-row${selected ? " on" : ""}`}>
                        <button
                          type="button"
                          className="tree-flat"
                          onClick={() => onSelectAgent(group, agent)}
                          onDoubleClick={() => onOpenSplit(group, agent)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ kind: "agent", x: e.clientX, y: e.clientY, group, agent });
                          }}
                        >
                          {pulse !== "idle" ? <AgentOrb pulse={pulse} /> : null}
                          <span className="tree-title">{lv?.name || agent.name}</span>
                        </button>
                        <button
                          type="button"
                          className="tree-icon ghost-hover"
                          title="Mais"
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = e.currentTarget.getBoundingClientRect();
                            setMenu({ kind: "agent", x: r.left, y: r.bottom, group, agent });
                          }}
                        >
                          <UiIcon icon={EllipsisVertical} size={14} />
                        </button>
                      </div>
                      {(lv?.nested ?? []).map((task) => (
                        <div key={task.id} className="tree-child deep">
                          <button
                            type="button"
                            className="tree-flat"
                            onClick={() => onSelectTask(lv!.id, task.id)}
                          >
                            {task.status === "running" ? (
                              <UiIcon icon={LoaderCircle} size={13} className="spin" />
                            ) : (
                              <UiIcon icon={task.status === "done" ? Check : ListTodo} size={13} />
                            )}
                            <span className="tree-title">
                              {task.kind} · {task.title || task.id}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {menu && (
        <div
          className="tree-menu"
          style={{ top: menu.y, left: menu.x }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === "session" && (
            <>
              <button type="button" onClick={() => { onAddAgent(menu.group); setMenu(null); }}>
                Adicionar agente
              </button>
              <button type="button" onClick={() => { onPinSession(menu.group); setMenu(null); }}>
                {menu.group.pinned ? "Desafixar" : "Fixar no topo"}
              </button>
              <button type="button" onClick={() => { onArchiveSession(menu.group); setMenu(null); }}>
                {menu.group.archived ? "Restaurar" : "Arquivar"}
              </button>
              <button type="button" onClick={() => { onExportSession(menu.group); setMenu(null); }}>
                Exportar .md
              </button>
              <button type="button" onClick={() => { onRenameSession(menu.group); setMenu(null); }}>
                Editar sessão
              </button>
              <button type="button" className="danger" onClick={() => { onDeleteSession(menu.group); setMenu(null); }}>
                Apagar sessão
              </button>
            </>
          )}
          {menu.kind === "agent" && (
            <>
              <button type="button" onClick={() => { onOpenSplit(menu.group, menu.agent); setMenu(null); }}>
                Abrir em split
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSendPick({ x: menu.x, y: menu.y, group: menu.group, agent: menu.agent });
                  setMenu(null);
                }}
              >
                Enviar ao agente…
              </button>
              <button type="button" onClick={() => { onRenameAgent(menu.group, menu.agent); setMenu(null); }}>
                Renomear agente
              </button>
              {liveOf(menu.group.id, menu.agent)?.status === "running" && (
                <button
                  type="button"
                  onClick={() => {
                    const lv = liveOf(menu.group.id, menu.agent);
                    if (lv) onStopAgent(lv.id);
                    setMenu(null);
                  }}
                >
                  Parar
                </button>
              )}
              <button
                type="button"
                className="danger"
                onClick={() => { onDeleteAgent(menu.group, menu.agent); setMenu(null); }}
              >
                Apagar agente
              </button>
            </>
          )}
        </div>
      )}
      {sendPick && (
        <div
          className="tree-menu"
          style={{ top: sendPick.y, left: sendPick.x }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="muted nested" style={{ padding: "6px 10px", margin: 0 }}>
            Enviar recorte para
          </p>
          {siblingsOf.length === 0 && <p className="muted nested">Sem irmãos neste grupo.</p>}
          {siblingsOf.map((sib) => (
            <button
              key={sib.id}
              type="button"
              onClick={() => {
                onSendToSibling(sendPick.group, sendPick.agent, sendPick.group, sib);
                setSendPick(null);
              }}
            >
              <UiIcon icon={Send} size={13} />
              {sib.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
