// The live side of the skin: N agent panes, each one a vendor TUI on a PTY.
//
// It owns the panes (`sessions`), the single `session-event` subscription, the
// spawn/resume/close lifecycle, and everything the composer does — including the
// slash palette and the skin's pickers, which only ever write a documented
// vendor slash into the PTY (docs/architecture.md § Compositor).
//
// It depends on the catalog one way only: `persistSession` / `persistTurns` come
// in as parameters. It never reads the catalog's state.

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type ProviderInfo, type SavedSession, type SessionEvent } from "../lib/commands";
import {
  agentPulse,
  claudeSiblingRoster,
  currentTaskLabel,
  emptyTurn,
  finishOpenWork,
  newTurnId,
  replaceLiveAgent,
  sessionBelongsToAgent,
  sessionContext,
  type ChatTurn,
} from "../lib/chat";
import {
  classifyOutgoing,
  composeOutgoing,
  defaultChatMode,
  defaultEffort,
  isPickCmd,
  pickOptions,
  providerModes,
  slashItems,
  type ClassifiedSlash,
  type PickCmd,
} from "../lib/slash";
import {
  applySkinObservers,
  browseProtocolPrompt,
  interpretScreen,
  mergeScreenSession,
  mergeSeenUrls,
  observeBrowseRequests,
  settleTurnsIfIdle,
  turnHasOpenWork,
} from "../lib/pty_translate";
import { ptyLine, newSid } from "../lib/paths";
import {
  MAX_SESSIONS,
  messagesFromTurns,
  savedView,
  type SessionView,
  type SystemUi,
  type UiSession,
} from "../lib/ui-model";
import type { PtyHandle } from "../PtyTerm";

export type SpawnOpts = {
  providerId: string;
  cwd: string;
  name: string;
  model?: string;
  systemPrompt?: string;
  resumeId?: string;
  view?: SessionView;
  groupId?: string;
  groupTitle?: string;
  replaceAgentId?: string;
  catalogId?: string;
  chatMode?: string;
  effort?: string;
  continueLast?: boolean;
};

export function useAgentRuntime({
  providers,
  cwd,
  groups,
  showToast,
  switchRepo,
  persistSession,
  persistTurns,
  loadTurns,
}: {
  providers: ProviderInfo[];
  cwd: string;
  /** The catalog's session-groups, read at call time for goal/brief/roster. */
  groups: SavedSession[];
  showToast: (msg: string) => void;
  switchRepo: (path: string) => Promise<string | null>;
  persistSession: (session: UiSession, title?: string, replaceAgentId?: string) => Promise<void>;
  persistTurns: (session: UiSession) => Promise<void>;
  loadTurns: (agentId: string) => Promise<ChatTurn[]>;
}) {
  const [sessions, setSessions] = useState<UiSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pulseNow, setPulseNow] = useState(() => Date.now());
  const [systemUi, setSystemUi] = useState<SystemUi | null>(null);

  // Slash palette over the composer.
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashPos, setSlashPos] = useState({ bottom: 80, left: 80 });
  const slashMenuRef = useRef<HTMLDivElement>(null);

  const ptyRefs = useRef<Map<string, PtyHandle>>(new Map());
  const composerRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const sessionsRef = useRef<UiSession[]>([]);
  const persistTurnsRef = useRef(persistTurns);
  persistTurnsRef.current = persistTurns;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Pulse tick: settles idle turns and drives the activity orb.
  const anyRunning = sessions.some((s) => s.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setPulseNow(now);
      setSessions((all) => {
        let changed = false;
        const next = all.map((s) => {
          const settled = settleTurnsIfIdle(s, now);
          if (settled !== s) changed = true;
          return settled;
        });
        if (!changed) return all;
        sessionsRef.current = next;
        return next;
      });
    }, 400);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  /** A VTE/xterm snapshot: interpret it, run the chat observers, then read it
   *  for browse requests. The open marker raises a permission ask; bare URLs are
   *  only collected. */
  function applyPtyScreen(sessionId: string, snapshot: string) {
    const now = Date.now();
    let asked: string | undefined;
    setSessions((all) => {
      let changed = false;
      const next = all.map((s) => {
        if (s.id !== sessionId) return s;
        const prevLog = s.ptyLog;
        const merged = mergeScreenSession(s, snapshot, s.provider, now, interpretScreen);
        const skinned = applySkinObservers(merged, prevLog, now);
        const browse = observeBrowseRequests(prevLog, skinned.ptyLog);
        asked = browse.requests[0];
        const seenUrls = mergeSeenUrls(s.seenUrls, browse.urls);
        const withUrls = seenUrls === s.seenUrls ? skinned : { ...skinned, seenUrls };
        if (withUrls !== s) changed = true;
        return withUrls;
      });
      if (!changed) return all;
      sessionsRef.current = next;
      return next;
    });
    // One ask at a time: a pending overlay is never replaced mid-decision.
    if (asked) {
      setSystemUi((cur) => (cur ? cur : { kind: "ask", sessionId, url: asked! }));
    }
  }

  // The single `session-event` subscription: bytes to the emulator, screen
  // snapshots to the translators, exit/error to the pane state.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<SessionEvent>("session-event", (ev) => {
      const p = ev.payload;
      if (p.kind === "bytes") {
        ptyRefs.current.get(p.session_id)?.write(p.data);
        return;
      }
      if (p.kind === "screen") {
        applyPtyScreen(p.session_id, p.text);
        return;
      }
      if (p.kind === "json_line") {
        return;
      }
      if (p.kind === "exit") {
        let ended: UiSession | undefined;
        const now = Date.now();
        setSessions((all) => {
          const nextAll = all.map((s) => {
            if (s.id !== p.session_id) return s;
            ended = {
              ...finishOpenWork(s, now),
              status: "exit" as const,
              exitCode: p.code,
              droppingStream: false,
              pendingSystem: undefined,
            };
            return ended;
          });
          sessionsRef.current = nextAll;
          return nextAll;
        });
        if (ended?.turns.length) void persistTurnsRef.current(ended);
      }
      if (p.kind === "error") {
        showToast(p.message);
        setSessions((all) => all.map((s) => (s.id === p.session_id ? { ...s, warned: true } : s)));
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [showToast]);

  // ── lifecycle ──────────────────────────────────────────────────────────────
  async function spawnAgent(opts: SpawnOpts): Promise<UiSession | undefined> {
    const replacing = opts.catalogId || opts.replaceAgentId;
    if (
      sessionsRef.current.filter((s) => s.status === "running" && s.catalogId !== replacing && s.id !== replacing)
        .length >= MAX_SESSIONS
    ) {
      showToast("Máximo de 3 agentes abertos.");
      return;
    }
    const p = providers.find((x) => x.id === opts.providerId);
    if (!p?.detected) {
      showToast("CLI não detectado.");
      return;
    }
    const mode = "interactive_pty" as const;
    const catalogId = opts.catalogId || opts.replaceAgentId || newSid();
    const groupId = opts.groupId || `g-${crypto.randomUUID()}`;
    const group = groups.find((g) => g.id === groupId);
    const savedTurns = replacing ? await loadTurns(catalogId) : [];

    // Group goal/brief become the system prompt; Claude also gets a sibling
    // roster and the browse protocol, which only reaches providers that accept a
    // system prompt at spawn.
    let systemPrompt = opts.systemPrompt;
    const ctx = sessionContext(group?.goal, group?.brief);
    if (p.id === "claude") {
      const seen = new Map<string, string>();
      for (const a of group?.agents ?? []) seen.set(a.id, a.name);
      for (const s of sessions.filter((s) => s.groupId === groupId)) seen.set(s.id, s.name);
      const roster = claudeSiblingRoster([...seen.entries()].map(([id, name]) => ({ id, name })));
      systemPrompt =
        [ctx, opts.systemPrompt, roster, browseProtocolPrompt()]
          .filter((x) => x && x.trim())
          .join("\n\n") || undefined;
    } else if (ctx) {
      systemPrompt = [ctx, opts.systemPrompt].filter((x) => x && x.trim()).join("\n\n") || undefined;
    }

    const prev = sessionsRef.current.find((s) => s.catalogId === catalogId || s.id === catalogId);
    const view = opts.view ?? prev?.view ?? "cli";
    const seed: UiSession = {
      id: catalogId,
      name: opts.name,
      provider: p.id,
      mode,
      cwd: opts.cwd,
      model: opts.model ?? null,
      status: "running",
      view,
      draft: "",
      draftFiles: [],
      chatMode: opts.chatMode ?? defaultChatMode(p.id),
      effort: opts.effort ?? defaultEffort(p.id),
      messages: [],
      turns: [],
      files: [],
      usage: null,
      streamModel: opts.model,
      resumeId: opts.resumeId,
      catalogId,
      groupId,
      nested: [],
      ptyLog: "",
    };
    await persistSession(seed, opts.groupTitle, opts.replaceAgentId);
    const info = await api.startSession({
      providerId: p.id,
      mode,
      cwd: opts.cwd,
      name: opts.name,
      model: opts.model,
      systemPrompt,
      resumeId: opts.resumeId,
      continueLast: opts.continueLast ?? false,
    });
    const ui: UiSession = {
      ...seed,
      ...info,
      status: "running",
      mode: "interactive_pty",
      view,
      catalogId,
      groupId,
      resumeId: opts.resumeId ?? prev?.resumeId,
      turns: savedTurns,
      messages: messagesFromTurns(savedTurns),
      draft: prev?.draft ?? seed.draft,
      draftFiles: prev?.draftFiles ?? seed.draftFiles,
      ptyLog: "",
      lastBytesAt: undefined,
      nested: [],
      streamModel: opts.model ?? prev?.streamModel,
    };
    const next = replaceLiveAgent(sessionsRef.current, ui);
    sessionsRef.current = next;
    setSessions(next);
    setActiveId(info.id);

    // Best-effort Claude resume id capture after spawn without an explicit id.
    if (p.id === "claude" && !ui.resumeId) {
      const spawnedAt = Date.now();
      const liveId = info.id;
      const catId = catalogId;
      window.setTimeout(() => {
        void (async () => {
          try {
            const rid = await api.probeVendorResume("claude", opts.cwd, spawnedAt);
            if (!rid) return;
            setSessions((all) => {
              const cur = all.find((s) => s.id === liveId);
              if (!cur || cur.resumeId) return all;
              const patched = { ...cur, resumeId: rid };
              void persistSession(patched);
              const updated = all.map((s) => (s.id === liveId || s.catalogId === catId ? patched : s));
              sessionsRef.current = updated;
              return updated;
            });
          } catch {
            /* probe is best-effort */
          }
        })();
      }, 2500);
    }

    return ui;
  }

  /** Match a catalog row against a live pane by id, catalog id, or resume id.
   *  Search is global across groups so focusing an agent in another session of
   *  the same cwd does not spawn a duplicate pane. */
  function findLiveAgent(
    group: SavedSession,
    agent: { id: string; name: string; provider: string; resume_id: string | null },
  ): UiSession | undefined {
    const inGroup = sessions.filter((s) => s.groupId === group.id);
    return (
      inGroup.find((s) => s.id === agent.id) ??
      inGroup.find((s) => s.catalogId === agent.id) ??
      inGroup.find((s) => Boolean(agent.resume_id) && s.resumeId === agent.resume_id) ??
      sessions.find((s) => s.catalogId === agent.id || s.id === agent.id) ??
      sessions.find((s) => Boolean(agent.resume_id) && s.resumeId === agent.resume_id)
    );
  }

  /** Focus a live agent, or spawn the TUI again in that cwd. */
  async function resumeSaved(
    group: SavedSession,
    agent: { id: string; provider: string; name: string; mode: string; resume_id: string | null },
  ): Promise<UiSession | undefined> {
    const live = findLiveAgent(group, agent);
    if (live) {
      setActiveId(live.id);
      if (live.cwd && live.cwd !== cwd) await switchRepo(live.cwd);
      return live;
    }
    try {
      await switchRepo(group.cwd);
      return await spawnAgent({
        providerId: agent.provider,
        cwd: group.cwd,
        name: agent.name,
        resumeId: agent.resume_id ?? undefined,
        view: savedView(agent.mode),
        groupId: group.id,
        groupTitle: group.title,
        replaceAgentId: agent.id,
        catalogId: agent.id,
        continueLast: !agent.resume_id && (agent.provider === "claude" || agent.provider === "codex"),
      });
    } catch {
      showToast("Não foi possível reabrir o agente.");
    }
  }

  async function selectSession(session: UiSession) {
    setActiveId(session.id);
    if (session.cwd && session.cwd !== cwd) await switchRepo(session.cwd);
  }

  async function selectGroup(group: SavedSession) {
    const live =
      sessions.find((s) => s.groupId === group.id && s.id === activeId) ??
      sessions.find((s) => s.groupId === group.id);
    if (live) {
      await selectSession(live);
      return;
    }
    const first = group.agents[0];
    if (first) await resumeSaved(group, first);
  }

  async function restartAgent(session: UiSession, patch: { model?: string }) {
    try {
      await api.sessionKill(session.id);
    } catch {
      /* already gone */
    }
    return await spawnAgent({
      providerId: session.provider,
      cwd: session.cwd,
      name: session.name,
      model: patch.model ?? session.streamModel ?? session.model ?? undefined,
      view: session.view,
      groupId: session.groupId,
      catalogId: session.catalogId,
      replaceAgentId: session.catalogId,
      chatMode: session.chatMode,
      effort: session.effort,
    });
  }

  async function ensureRunning(session: UiSession): Promise<UiSession | null> {
    const live = sessionsRef.current.find((s) => s.id === session.id) ?? session;
    if (live.status === "running") return live;
    return (await restartAgent(live, { model: live.streamModel ?? live.model ?? undefined })) ?? null;
  }

  async function closeSession(id: string) {
    const live = sessionsRef.current.find((s) => s.id === id);
    if (live?.turns.length) await persistTurns(live);
    try {
      await api.sessionKill(id);
    } catch {
      /* already gone */
    }
    setSessions((s) => {
      const next = s.filter((x) => x.id !== id);
      sessionsRef.current = next;
      setActiveId((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur));
      return next;
    });
  }

  // ── composer ───────────────────────────────────────────────────────────────
  async function sendSystem(session: UiSession, line: string) {
    const live = sessionsRef.current.find((s) => s.id === session.id) ?? session;
    const running = live.status === "running" ? live : await ensureRunning(live);
    if (!running) return;
    try {
      await api.sessionWrite(running.id, ptyLine(line));
    } catch (e) {
      const msg = String(e);
      if (msg.includes("session_not_found") || /broken pipe|os error 32/i.test(msg)) return;
      showToast(msg);
    }
  }

  /** Anchor a popover just above the session's composer. */
  function anchorAtComposer(sessionId: string) {
    const el = composerRefs.current.get(sessionId);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSlashPos({ bottom: window.innerHeight - r.top + 8, left: r.left });
  }

  function openSystemPick(session: UiSession, command: PickCmd) {
    const options = pickOptions(session.provider, command);
    if (options.length === 0) {
      showToast("Este agente não tem catálogo para esse comando.");
      return;
    }
    setSlashOpen(false);
    anchorAtComposer(session.id);
    const title = command === "/model" ? "Modelo" : command === "/effort" ? "Effort" : "Auto-compact";
    const current =
      command === "/model"
        ? session.streamModel || session.model || undefined
        : command === "/effort"
          ? session.effort
          : undefined;
    setSystemUi({ kind: "pick", sessionId: session.id, command, title, options, current });
  }

  function applyEffort(session: UiSession, id: string) {
    setSessions((all) => all.map((s) => (s.id === session.id ? { ...s, effort: id } : s)));
    void sendSystem({ ...session, effort: id }, `/effort ${id}`);
  }

  function applyMode(session: UiSession, id: string) {
    const mode = providerModes(session.provider).find((m) => m.id === id);
    setSessions((all) => all.map((s) => (s.id === session.id ? { ...s, chatMode: id } : s)));
    if (mode?.slash) void sendSystem({ ...session, chatMode: id }, mode.slash);
  }

  /** `/model` is written into the TUI; only a dead process gets relaunched. */
  async function applyModel(session: UiSession, id: string) {
    setSessions((all) => all.map((s) => (s.id === session.id ? { ...s, streamModel: id, model: id } : s)));
    const live = sessionsRef.current.find((s) => s.id === session.id) ?? { ...session, streamModel: id, model: id };
    if (live.status === "running") {
      try {
        await api.sessionWrite(live.id, ptyLine(`/model ${id}`));
        return;
      } catch {
        /* process gone — write after relaunch */
      }
    }
    const next = await ensureRunning({ ...live, streamModel: id, model: id });
    if (next) {
      try {
        await api.sessionWrite(next.id, ptyLine(`/model ${id}`));
      } catch (e) {
        showToast(String(e));
      }
    }
  }

  function applyChromeSlash(session: UiSession, line: string) {
    const clears = line === "/clear" || line.startsWith("/new");
    setSessions((all) =>
      all.map((s) => {
        if (s.id !== session.id) return s;
        if (clears) return { ...s, draft: "", draftFiles: [], ptyLog: "", turns: [], pendingSystem: undefined };
        return { ...s, draft: "" };
      }),
    );
    void sendSystem(session, line);
  }

  function dispatchClassified(session: UiSession, classified: ClassifiedSlash) {
    if (classified.kind === "prompt") {
      onDraftChange(session, `${classified.cmd} `);
      return;
    }
    if (classified.kind === "pick") {
      if (isPickCmd(classified.cmd)) openSystemPick(session, classified.cmd);
      return;
    }
    if (classified.kind === "chrome") {
      applyChromeSlash(session, classified.line);
      return;
    }
    if (classified.kind === "control") {
      if (classified.cmd === "/plan") {
        setSessions((all) => all.map((s) => (s.id === session.id ? { ...s, chatMode: "plan" } : s)));
      }
      if (classified.cmd === "/effort" && classified.rest) {
        setSessions((all) => all.map((s) => (s.id === session.id ? { ...s, effort: classified.rest } : s)));
      }
      if (classified.cmd === "/model" && classified.rest) {
        setSessions((all) => all.map((s) => (s.id === session.id ? { ...s, streamModel: classified.rest } : s)));
      }
      void sendSystem(session, classified.line);
      return;
    }
    if (classified.kind === "report") {
      void sendSystem(session, classified.line);
    }
  }

  async function sendDraft(session: UiSession) {
    const text = composeOutgoing({ draft: session.draft, files: session.draftFiles });
    if (!text) return;
    const live = await ensureRunning(session);
    if (!live) return;
    setSlashOpen(false);
    const classified = session.draftFiles.length ? null : classifyOutgoing(live.provider, text);
    if (classified) {
      setSessions((all) => all.map((s) => (s.id === live.id ? { ...s, draft: "", draftFiles: [] } : s)));
      dispatchClassified(live, classified);
      return;
    }
    setSessions((all) =>
      all.map((s) => {
        if (s.id !== live.id) return s;
        return {
          ...s,
          warned: false,
          draft: "",
          draftFiles: [],
          turns: [...s.turns, emptyTurn(newTurnId(), text, Date.now())],
          lastBytesAt: Date.now(),
        };
      }),
    );
    try {
      await api.sessionWrite(live.id, ptyLine(text));
    } catch (e) {
      showToast(String(e));
    }
  }

  /** Stop = Ctrl+C into the PTY. */
  async function stopInference(session: UiSession) {
    const live = sessionsRef.current.find((s) => s.id === session.id) ?? session;
    if (live.status !== "running") return;
    try {
      await api.sessionInterrupt(live.id);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("session_not_found")) showToast(msg);
    }
  }

  function onDraftChange(session: UiSession, value: string) {
    setSessions((all) => all.map((s) => (s.id === session.id ? { ...s, draft: value } : s)));
    const token = value.split(/\s/)[0] ?? "";
    if (token.startsWith("/")) {
      setSlashOpen(true);
      setSlashIndex(0);
      anchorAtComposer(session.id);
    } else {
      setSlashOpen(false);
    }
  }

  function setDraftFiles(sessionId: string, files: UiSession["draftFiles"]) {
    setSessions((all) => all.map((s) => (s.id === sessionId ? { ...s, draftFiles: files } : s)));
  }

  function setView(sessionId: string, view: SessionView) {
    setSessions((all) => all.map((s) => (s.id === sessionId ? { ...s, view } : s)));
  }

  function setDraft(sessionId: string, draft: string) {
    setSessions((all) => all.map((s) => (s.id === sessionId ? { ...s, draft } : s)));
  }

  // Catalog edits that must also land on the live pane.
  function renameLiveAgent(agentId: string, name: string) {
    setSessions((all) => all.map((s) => (sessionBelongsToAgent(s, agentId) ? { ...s, name } : s)));
  }

  function moveLiveAgent(agentId: string, toGroupId: string) {
    setSessions((all) =>
      all.map((s) => (s.catalogId === agentId || s.id === agentId ? { ...s, groupId: toGroupId } : s)),
    );
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null;
  const slashList = active ? slashItems(active.provider, active.draft.split(/\s/)[0] ?? "") : [];

  useEffect(() => {
    if (!slashOpen) return;
    slashMenuRef.current?.querySelector(".item.on")?.scrollIntoView({ block: "nearest" });
  }, [slashIndex, slashOpen, slashList.length]);

  const liveViews = sessions.map((s) => ({
    id: s.id,
    catalogId: s.catalogId,
    groupId: s.groupId,
    name: s.name,
    provider: s.provider,
    status: s.status,
    nested: s.nested,
    taskLabel: currentTaskLabel(s.nested, s.messages),
    files: s.files,
    cwd: s.cwd,
    resumeId: s.resumeId,
    pulse: agentPulse({
      status: s.status,
      exitCode: s.exitCode,
      liveTurn: turnHasOpenWork(s.turns),
      nestedRunning: s.nested.some((n) => n.status === "running"),
      pendingAsk: systemUi?.kind === "ask" && systemUi.sessionId === s.id,
      warned: Boolean(s.warned),
    }),
  }));

  function nudgeSlash(dir: number) {
    setSlashIndex((i) => {
      const n = slashList.length || 1;
      return (i + dir + n) % n;
    });
  }

  return {
    // panes
    sessions,
    sessionsRef,
    active,
    activeId,
    setActiveId,
    liveViews,
    pulseNow,
    ptyRefs,
    composerRefs,
    // lifecycle
    spawnAgent,
    findLiveAgent,
    resumeSaved,
    selectSession,
    selectGroup,
    closeSession,
    applyPtyScreen,
    // composer
    sendDraft,
    stopInference,
    onDraftChange,
    setDraft,
    setDraftFiles,
    setView,
    applyMode,
    applyEffort,
    applyModel,
    sendSystem,
    openSystemPick,
    dispatchClassified,
    // slash palette
    slashOpen,
    setSlashOpen,
    slashIndex,
    slashPos,
    slashList,
    slashMenuRef,
    nudgeSlash,
    // skin pickers / permission asks
    systemUi,
    setSystemUi,
    askSessionId: systemUi?.kind === "ask" ? systemUi.sessionId : null,
    // catalog callbacks
    renameLiveAgent,
    moveLiveAgent,
  };
}
