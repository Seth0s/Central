// App is the wiring, not the work. Three hooks hold the state, components hold
// the markup, and `lib/` holds everything pure.
//
//   useCatalog        — SQLite: repositories, session-groups, agent rows
//   useAgentRuntime   — live panes, PTY events, spawn/close, composer, slashes
//   useToolShelf      — the right bar: tool tabs and what each tool does
//
// What is left here, in order:
//   1. state and hook wiring
//   2. effects            — theme, first load, Escape, modal focus trap
//   3. workspace          — open a folder, browse the machine
//   4. session-groups     — the actions that need both catalog and live agents
//   5. agent modal        — the New chat / Add agent form
//   6. render             — the window grid, then the overlays
//
// The grid and its sizes are specified in docs/architecture.md § Chrome.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, type ProviderInfo, type SavedAgent, type SavedSession, type TermBackend } from "./lib/commands";
import { exportTranscriptMd, lastText, sessionBelongsToAgent, siblingStamp } from "./lib/chat";
import { newSid, ptyLine } from "./lib/paths";
import { labelOf, messagesFromTurns, type BrowseMode, type Theme } from "./lib/ui-model";
import { readTermFontSize, writeTermFontSize } from "./lib/app-prefs";
import { SIDEBAR_MAX, SIDEBAR_MIN } from "./lib/ui-metrics";
import { useCatalog } from "./hooks/useCatalog";
import { useAgentRuntime } from "./hooks/useAgentRuntime";
import { useToolShelf } from "./hooks/useToolShelf";
import { SidebarToggle, useStoredOpen, useStoredPx } from "./layout";
import TitleBar from "./chrome/TitleBar";
import WindowResizeEdges from "./chrome/WindowResizeEdges";
import StatusBar from "./chrome/StatusBar";
import ProjectsSidebar from "./chrome/ProjectsSidebar";
import SessionPane from "./session/SessionPane";
import EmptyState from "./session/EmptyState";
import ToolPanel from "./tools/ToolPanel";
import PlusMenu from "./overlays/PlusMenu";
import SlashMenu from "./overlays/SlashMenu";
import SystemPickMenu from "./overlays/SystemPickMenu";
import BrowserAskModal from "./overlays/BrowserAskModal";
import SessionModal from "./overlays/SessionModal";
import AgentModal, { EMPTY_AGENT_FORM, type AgentForm } from "./overlays/AgentModal";
import BrowseModal, { type BrowseState } from "./overlays/BrowseModal";
import SettingsModal from "./overlays/SettingsModal";
import "./App.css";

/** The session-group modal's draft; `existing` means edit instead of create. */
type SessionDraft = { cwd: string; existing?: SavedSession; title: string; goal: string; brief: string };

export default function App() {
  // ── 1. state and hook wiring ───────────────────────────────────────────────
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("cc-theme") as Theme) || "dark");
  const [termFontSize, setTermFontSize] = useState(() => readTermFontSize());
  const [leftOpen, setLeftOpen] = useStoredOpen("cc-left-open", true);
  const [sidebarW, setSidebarW] = useStoredPx("cc-sidebar-w", 280, SIDEBAR_MIN, SIDEBAR_MAX);
  const [toast, setToast] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [termBackend, setTermBackend] = useState<TermBackend | null>(null);
  const [cwd, setCwd] = useState("");

  const [treeMenuOpen, setTreeMenuOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentForm, setAgentForm] = useState<AgentForm>(EMPTY_AGENT_FORM);
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null);
  const [browse, setBrowse] = useState<BrowseState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  // The catalog is created first, so the runtime can persist through it. Its two
  // live-pane callbacks reach the runtime through a ref, which is the only place
  // the one-way dependency has to bend.
  const liveOps = useRef({
    rename: (_id: string, _name: string) => {},
    move: (_id: string, _groupId: string) => {},
  });
  const catalog = useCatalog({
    showToast,
    onAgentRenamed: (id, name) => liveOps.current.rename(id, name),
    onAgentMoved: (id, groupId) => liveOps.current.move(id, groupId),
  });

  const runtime = useAgentRuntime({
    providers,
    cwd,
    groups: catalog.history.sessions,
    showToast,
    switchRepo,
    persistSession: catalog.persistSession,
    persistTurns: catalog.persistTurns,
    loadTurns: catalog.loadTurns,
  });
  liveOps.current = { rename: runtime.renameLiveAgent, move: runtime.moveLiveAgent };

  const shelf = useToolShelf({
    cwd,
    focusedSession: () => runtime.active,
    showToast,
    onBrowseMarkdown: () => void openBrowse("md", cwd || undefined),
  });

  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const syncRootEntriesRef = useRef(shelf.syncRootEntries);
  syncRootEntriesRef.current = shelf.syncRootEntries;

  const active = runtime.active;
  const chromeOccluded =
    shelf.plusOpen ||
    agentOpen ||
    settingsOpen ||
    !!sessionDraft ||
    !!runtime.systemUi ||
    !!browse ||
    treeMenuOpen ||
    runtime.slashOpen;

  // ── 2. effects ─────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("cc-theme", theme);
  }, [theme]);

  useEffect(() => {
    void api.termSetFont(termFontSize).catch(() => undefined);
  }, [termFontSize]);

  function applyTermFontSize(px: number) {
    setTermFontSize(writeTermFontSize(px));
  }

  /** First load: providers, terminal backend, catalog, and the last workspace. */
  const refresh = useCallback(async () => {
    setProviders(await api.listProviders());
    try {
      setTermBackend(await api.termBackend());
    } catch {
      setTermBackend("xterm");
    }
    const hist = await catalogRef.current.reload();
    let w = await api.workspaceCwd();
    if (!w && hist.repositories[0]) {
      try {
        w = await api.openWorkspace(hist.repositories[0].path);
        await catalogRef.current.reload();
      } catch {
        w = null;
      }
    }
    if (w) {
      setCwd(w);
      syncRootEntriesRef.current(await api.listWorkspace());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Escape closes the topmost overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (browse) {
        setBrowse(null);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      shelf.closePlus();
      runtime.setSlashOpen(false);
      setAgentOpen(false);
      setSessionDraft(null);
      runtime.setSystemUi(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browse, settingsOpen]);

  // Focus trap for the two form modals. Depend on open/closed only — not on
  // draft field values, or every keystroke re-runs and steals focus back to Nome.
  const sessionModalOpen = Boolean(sessionDraft);
  useEffect(() => {
    if (!agentOpen && !sessionModalOpen) return;
    const root = modalRef.current;
    const focusable = root?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([readonly]), textarea",
    );
    const start = root?.querySelector<HTMLElement>("input:not([readonly]), textarea") ?? focusable?.[0];
    start?.focus();
    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", trap);
    return () => window.removeEventListener("keydown", trap);
  }, [agentOpen, sessionModalOpen]);

  // ── 3. workspace ───────────────────────────────────────────────────────────
  async function switchRepo(path: string) {
    try {
      const shown = await api.openWorkspace(path);
      setCwd(shown);
      await catalogRef.current.reload();
      return shown;
    } catch (e) {
      showToast(String(e));
      return null;
    }
  }

  async function openBrowse(mode: BrowseMode, start?: string) {
    try {
      setBrowse({ mode, ...(await api.browseDir(start || cwd || undefined)) });
    } catch (e) {
      showToast(String(e));
    }
  }

  async function goBrowse(path: string) {
    try {
      const listing = await api.browseDir(path);
      setBrowse((b) => (b ? { ...b, ...listing } : b));
    } catch (e) {
      showToast(String(e));
    }
  }

  async function confirmBrowseDir() {
    if (!browse || browse.mode === "md") return;
    try {
      if (browse.mode === "workspace") {
        setCwd(await api.openWorkspace(browse.path));
        await catalog.reload();
      } else {
        setAgentForm((f) => ({ ...f, cwd: browse.path }));
      }
      setBrowse(null);
    } catch (e) {
      showToast(String(e));
    }
  }

  // ── 4. session-groups ──────────────────────────────────────────────────────
  // Plain catalog writes live in useCatalog; what stays here also needs live agents.
  function openSessionModal(atCwd: string, existing?: SavedSession) {
    setSessionDraft({
      cwd: atCwd,
      existing,
      title: existing?.title || "Sessão",
      goal: existing?.goal || "",
      brief: existing?.brief || "",
    });
  }

  async function submitSessionModal() {
    if (!sessionDraft) return;
    const title = sessionDraft.title.trim() || "Sessão";
    const goal = sessionDraft.goal.trim();
    const brief = sessionDraft.brief.trim();
    const originCwd = sessionDraft.cwd;
    let saveCwd = originCwd;
    try {
      saveCwd = await api.openWorkspace(originCwd);
      setCwd(saveCwd);
    } catch (e) {
      showToast(String(e));
    }
    const now = Math.floor(Date.now() / 1000);
    const payload: SavedSession = sessionDraft.existing
      ? { ...sessionDraft.existing, title, cwd: saveCwd, goal, brief, updated_at: now }
      : {
          id: `g-${newSid()}`,
          title,
          cwd: saveCwd,
          updated_at: now,
          agents: [],
          pinned: false,
          archived: false,
          goal,
          brief,
        };
    const next = await catalog.upsert(payload);
    if (!next) return;
    if (!next.sessions.some((g) => g.id === payload.id)) {
      showToast("A sessão não ficou no histórico. Reinicia o tauri dev para recarregar o núcleo Rust.");
      return;
    }
    catalog.markReposOpen([saveCwd, originCwd]);
    setSessionDraft(null);
  }

  /** Export merges the catalog turns with whatever is still live in memory. */
  async function exportSessionGroup(group: SavedSession) {
    const path = await save({
      defaultPath: `${group.title || "sessao"}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    const agents = await Promise.all(
      group.agents.map(async (agent) => {
        const live = runtime.findLiveAgent(group, agent);
        const turns = live?.turns?.length ? live.turns : await catalog.loadTurns(agent.id);
        return {
          name: live?.name || agent.name,
          provider: live?.provider || agent.provider,
          turns,
          messages: live?.messages ?? messagesFromTurns(turns),
        };
      }),
    );
    try {
      await api.writeUserFile(path, exportTranscriptMd(group.title, group.cwd, agents));
      showToast("Transcrição exportada.");
    } catch (e) {
      showToast(String(e));
    }
  }

  /** Deleting kills the live processes first, then the catalog rows. */
  async function deleteSessionGroup(group: SavedSession) {
    if (!window.confirm(`Apagar a sessão “${group.title}” e os agentes?`)) return;
    for (const s of runtime.sessionsRef.current.filter((x) => x.groupId === group.id)) {
      await runtime.closeSession(s.id);
    }
    await catalog.deleteGroup(group.id);
  }

  async function deleteAgentRow(group: SavedSession, agent: { id: string; name: string }) {
    if (!window.confirm(`Apagar o agente “${agent.name}”?`)) return;
    const live = runtime.sessionsRef.current.find((s) => sessionBelongsToAgent(s, agent.id));
    if (live) await runtime.closeSession(live.id);
    await catalog.deleteAgent(group.id, agent.id);
  }

  /** Carve a recort of one agent's screen into a sibling's composer. */
  async function sendToSibling(
    fromGroup: SavedSession,
    fromAgent: SavedAgent,
    toGroup: SavedSession,
    toAgent: SavedAgent,
  ) {
    const src = runtime.findLiveAgent(fromGroup, fromAgent);
    const lastTurn = src?.turns[src.turns.length - 1];
    const excerpt =
      (src?.ptyLog && src.ptyLog.trim().slice(-4000)) ||
      (src && (lastText(src.messages, "assistant") || lastText(src.messages, "user"))) ||
      lastTurn?.assistant ||
      lastTurn?.user ||
      "";
    const stamped = `${siblingStamp(fromAgent.provider, fromGroup.id, fromAgent.id, fromAgent.name)}\n${excerpt}`.trim();
    const dest = runtime.findLiveAgent(toGroup, toAgent) ?? (await runtime.resumeSaved(toGroup, toAgent));
    if (dest) {
      runtime.setDraft(dest.id, stamped);
      runtime.setActiveId(dest.id);
      if (dest.status === "running" && window.confirm("Enviar já para o processo vivo?")) {
        try {
          await api.sessionWrite(dest.id, ptyLine(stamped));
        } catch (e) {
          showToast(String(e));
        }
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(stamped);
      showToast("Carimbo copiado. Abre o agente e cola no compositor.");
    } catch {
      showToast("Abre o agente destino para colar o recorte.");
    }
  }

  // ── 5. agent modal ─────────────────────────────────────────────────────────
  function openAgentModal(workspace?: string, groupId?: string) {
    const detected = providers.filter((p) => p.detected);
    const first = detected.find((p) => p.id !== "fixture") ?? detected[0] ?? providers[0];
    setAgentForm({
      ...EMPTY_AGENT_FORM,
      provider: first?.id ?? "fixture",
      name: first ? labelOf(first.id) : "",
      cwd: workspace ?? cwd,
      groupId: groupId ?? null,
    });
    setAgentOpen(true);
    shelf.closePlus();
  }

  async function createAgent() {
    const spawnCwd = agentForm.cwd.trim() || cwd;
    if (!spawnCwd) {
      showToast("Escolhe uma pasta de trabalho.");
      return;
    }
    try {
      if (spawnCwd !== cwd) await switchRepo(spawnCwd);
      await runtime.spawnAgent({
        providerId: agentForm.provider,
        cwd: spawnCwd,
        name: agentForm.name.trim() || labelOf(agentForm.provider),
        model: agentForm.model.trim() || undefined,
        systemPrompt: agentForm.prompt.trim() || undefined,
        resumeId: agentForm.resumeId.trim() || undefined,
        continueLast: !agentForm.resumeId.trim() && agentForm.continueLast,
        groupId: agentForm.groupId ?? undefined,
        groupTitle: agentForm.groupId
          ? catalog.history.sessions.find((g) => g.id === agentForm.groupId)?.title
          : undefined,
      });
      setAgentOpen(false);
    } catch (e) {
      showToast(String(e));
    }
  }

  /** An agent's URL ask was allowed: show the page and mark it as the owner. */
  async function allowBrowser() {
    const ask = runtime.systemUi;
    if (ask?.kind !== "ask") return;
    const agent = runtime.sessions.find((s) => s.id === ask.sessionId) ?? null;
    runtime.setSystemUi(null);
    shelf.showBrowserTab(agent);
    try {
      await api.browserEnsure();
      await api.browserNavigate(ask.url);
      await api.browserSetVisible(true);
    } catch (e) {
      showToast(String(e));
    }
  }

  function focusToolBubble(agentId: string, toolId: string) {
    runtime.setActiveId(agentId);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-tool-id="${CSS.escape(toolId)}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  // ── 6. render ──────────────────────────────────────────────────────────────
  return (
    <div
      className="app"
      data-theme={theme}
      style={
        {
          "--left": leftOpen ? `${sidebarW}px` : "0px",
          "--right": shelf.open ? `${shelf.width}px` : "0px",
        } as CSSProperties
      }
    >
      <TitleBar />
      <WindowResizeEdges />

      {leftOpen && (
        <ProjectsSidebar
          width={sidebarW}
          onResize={setSidebarW}
          onClose={() => setLeftOpen(false)}
          history={catalog.history}
          cwd={cwd}
          openRepos={catalog.openRepos}
          onOpenRepo={(path, open) => {
            void switchRepo(path);
            catalog.markRepoOpen(path, open);
          }}
          query={catalog.query}
          onQuery={catalog.setQuery}
          showArchived={catalog.showArchived}
          onShowArchived={catalog.setShowArchived}
          live={runtime.liveViews}
          activeId={active?.id ?? null}
          onNewChat={() => openAgentModal()}
          onPickWorkspace={() => void openBrowse("workspace", cwd || undefined)}
          onNewSession={(repoPath) => openSessionModal(repoPath)}
          onSettings={() => setSettingsOpen(true)}
          tree={{
            onSelectGroup: (group) => void runtime.selectGroup(group),
            onSelectAgent: (group, agent) => void runtime.resumeSaved(group, agent),
            onSelectTask: focusToolBubble,
            onAddAgent: (group) => openAgentModal(group.cwd, group.id),
            onRenameSession: (group) => openSessionModal(group.cwd, group),
            onRenameAgent: (group, agent) => void catalog.renameAgent(group, agent),
            onDeleteSession: (group) => void deleteSessionGroup(group),
            onDeleteAgent: (group, agent) => void deleteAgentRow(group, agent),
            onStopAgent: (id) => void runtime.closeSession(id),
            onOpenSplit: (group, agent) => void runtime.resumeSaved(group, agent),
            onPinSession: (group) => void catalog.pinGroup(group),
            onArchiveSession: (group) => void catalog.archiveGroup(group),
            onExportSession: (group) => void exportSessionGroup(group),
            onMoveAgent: (from, to, agent) => void catalog.moveAgent(from, to, agent),
            onSendToSibling: (from, fromAgent, to, toAgent) =>
              void sendToSibling(from, fromAgent, to, toAgent),
            onMenuOpen: setTreeMenuOpen,
          }}
        />
      )}

      <div className={`main${!leftOpen ? " dock-left" : ""}${!shelf.open ? " dock-right" : ""}`}>
        {!leftOpen && (
          <SidebarToggle
            side="left"
            open={false}
            className="dock-toggle dock-left"
            onClick={() => setLeftOpen(true)}
          />
        )}
        <div className="sessions">
          {runtime.sessions.length === 0 && <EmptyState />}
          {runtime.sessions.map((s) => (
            <SessionPane
              key={s.catalogId || s.id}
              session={s}
              active={s.id === active?.id}
              ptyRefs={runtime.ptyRefs}
              composerRefs={runtime.composerRefs}
              onActivate={() => void runtime.selectSession(s)}
              onDraft={(v) => runtime.onDraftChange(s, v)}
              onFiles={(files) => runtime.setDraftFiles(s.id, files)}
              onMode={(id) => runtime.applyMode(s, id)}
              onEffort={(id) => runtime.applyEffort(s, id)}
              onSend={() => void runtime.sendDraft(s)}
              onStop={() => void runtime.stopInference(s)}
              onClose={() => void runtime.closeSession(s.id)}
              onSlashNav={runtime.nudgeSlash}
              onSlashPick={() => {
                const pick = runtime.slashList[runtime.slashIndex];
                if (!pick || !active) return;
                runtime.setSlashOpen(false);
                runtime.onDraftChange(active, "");
                runtime.dispatchClassified(active, { cmd: pick.cmd, rest: "", kind: pick.kind, line: pick.cmd });
              }}
              onModelClick={() => runtime.openSystemPick(s, "/model")}
              onView={(view) => {
                runtime.setView(s.id, view);
                void catalog.persistSession({ ...s, view, resumeId: s.resumeId });
              }}
              pulseNow={runtime.pulseNow}
              slashOpen={runtime.slashOpen && s.id === active?.id}
              termBackend={termBackend}
              occluded={chromeOccluded}
              onScreen={(text) => runtime.applyPtyScreen(s.id, text)}
            />
          ))}
        </div>
        {!shelf.open && (
          <SidebarToggle
            side="right"
            open={false}
            className="dock-toggle dock-right"
            onClick={() => shelf.setOpen(true)}
          />
        )}
      </div>

      {shelf.open && (
        <ToolPanel
          width={shelf.width}
          onResize={shelf.setWidth}
          onClose={() => shelf.setOpen(false)}
          chromeRef={shelf.chromeRef}
          sideTabsRef={shelf.sideTabsRef}
          tabs={shelf.tabs}
          activeId={shelf.activeId}
          onSelectTab={shelf.selectTab}
          onCloseTab={shelf.closeTool}
          onPlus={shelf.openPlus}
          cwd={cwd}
          theme={theme}
          locked={shelf.locked}
          occluded={chromeOccluded}
          plusOpen={shelf.plusOpen}
          activeAgentId={active?.id ?? null}
          termBackend={termBackend}
          ptyRefs={runtime.ptyRefs}
          onToast={showToast}
          agentUrls={active?.seenUrls ?? []}
          files={{
            explorerW: shelf.explorerW,
            onExplorerW: shelf.setExplorerW,
            onPatch: shelf.patchFiles,
            onReveal: (tab, dir) => void shelf.revealFolder(tab, dir),
            onToggleDir: (tab, ent) => void shelf.toggleDir(tab, ent),
            onOpenEntry: (tab, ent) => void shelf.openEntry(tab, ent),
            onNewFile: (tab) => void shelf.newWorkspaceFile(tab),
            onSave: (tab) => void shelf.saveFile(tab),
          }}
          canvas={{
            mdFiles: shelf.mdFiles,
            onPick: shelf.pickMarkdown,
            onOpenFile: (path, name, tabId) => void shelf.openCanvasFile(path, name, tabId),
            onClear: shelf.clearCanvas,
          }}
          onRefreshGit={shelf.refreshGit}
          onRestartTerminal={(tabId) => void shelf.restartTerminal(tabId)}
        />
      )}

      <StatusBar
        cwd={cwd}
        active={active}
        pulse={runtime.liveViews.find((l) => l.id === active?.id)?.pulse}
      />

      {shelf.plusOpen && <PlusMenu pos={shelf.plusPos} onPick={shelf.openTool} />}

      {runtime.slashOpen && active && runtime.slashList.length > 0 && !runtime.systemUi && (
        <SlashMenu
          menuRef={runtime.slashMenuRef}
          pos={runtime.slashPos}
          caption={labelOf(active.provider)}
          items={runtime.slashList}
          index={runtime.slashIndex}
          onPick={(item) => {
            runtime.setSlashOpen(false);
            runtime.onDraftChange(active, "");
            runtime.dispatchClassified(active, { cmd: item.cmd, rest: "", kind: item.kind, line: item.cmd });
          }}
        />
      )}

      {runtime.systemUi?.kind === "pick" && (
        <SystemPickMenu
          pos={runtime.slashPos}
          title={runtime.systemUi.title}
          options={runtime.systemUi.options}
          current={runtime.systemUi.current}
          onPick={(id) => {
            const pick = runtime.systemUi;
            if (pick?.kind !== "pick") return;
            const sess = runtime.sessions.find((s) => s.id === pick.sessionId);
            runtime.setSystemUi(null);
            if (!sess) return;
            if (pick.command === "/model") void runtime.applyModel(sess, id);
            else if (pick.command === "/effort") runtime.applyEffort(sess, id);
            else void runtime.sendSystem(sess, `${pick.command} ${id}`);
          }}
        />
      )}

      {runtime.systemUi?.kind === "ask" && (
        <BrowserAskModal
          url={runtime.systemUi.url}
          agentName={runtime.sessions.find((s) => s.id === runtime.askSessionId)?.name}
          onDeny={() => runtime.setSystemUi(null)}
          onAllow={() => void allowBrowser()}
        />
      )}

      {sessionDraft && (
        <SessionModal
          modalRef={modalRef}
          editing={Boolean(sessionDraft.existing)}
          cwd={sessionDraft.cwd}
          title={sessionDraft.title}
          goal={sessionDraft.goal}
          brief={sessionDraft.brief}
          onTitle={(title) => setSessionDraft((d) => (d ? { ...d, title } : d))}
          onGoal={(goal) => setSessionDraft((d) => (d ? { ...d, goal } : d))}
          onBrief={(brief) => setSessionDraft((d) => (d ? { ...d, brief } : d))}
          onCancel={() => setSessionDraft(null)}
          onSubmit={() => void submitSessionModal()}
        />
      )}

      {agentOpen && (
        <AgentModal
          modalRef={modalRef}
          providers={providers}
          form={agentForm}
          onForm={(patch) => setAgentForm((f) => ({ ...f, ...patch }))}
          cwdPlaceholder={cwd}
          onPickFolder={() => void openBrowse("agent", agentForm.cwd || cwd || undefined)}
          onCancel={() => setAgentOpen(false)}
          onSubmit={() => void createAgent()}
        />
      )}

      {browse && (
        <BrowseModal
          browse={browse}
          onPath={(path) => setBrowse((b) => (b ? { ...b, path } : b))}
          onGo={(path) => void goBrowse(path)}
          onCancel={() => setBrowse(null)}
          onPickFile={(entry) => {
            setBrowse(null);
            void shelf.openCanvasFile(entry.path, entry.name, shelf.takePendingCanvasTab());
          }}
          onConfirmDir={() => void confirmBrowseDir()}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onTheme={setTheme}
          termFontSize={termFontSize}
          onTermFontSize={applyTermFontSize}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
