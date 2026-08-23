import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Copy, LoaderCircle } from "lucide-react";
import {
  formatDuration,
  groupToolRuns,
  nestedToolKind,
  toolGroupLabel,
  type ChatTurn,
  type ToolGroup,
  type ToolRun,
} from "./lib/chat";
import { renderChatMarkdown } from "./lib/markdown";
import MarkdownHtml from "./MarkdownHtml";
import { UiIcon } from "./icons";

function ChatMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  const parsed = useMemo(() => (text ? renderChatMarkdown(text, streaming) : { html: "", mermaid: [] }), [text, streaming]);
  if (!text && !streaming) return null;
  return (
    <div className="msg assistant">
      {parsed.html ? <MarkdownHtml html={parsed.html} mermaid={parsed.mermaid} className="md chat-md" /> : null}
      {streaming ? <span className="stream-caret" aria-hidden /> : null}
    </div>
  );
}

function LiveDuration({ start, end }: { start: number; end: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (end != null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [end]);
  return <>{formatDuration((end ?? now) - start)}</>;
}

function ThinkingBlock({ text, live, start, end }: { text: string; live: boolean; start: number; end: number | null }) {
  const [open, setOpen] = useState(live);
  useEffect(() => {
    if (live) setOpen(true);
    else setOpen(false);
  }, [live]);
  if (!text) return null;
  return (
    <div className={`turn-think${live ? " live" : ""}`}>
      <button type="button" className="turn-think-toggle" onClick={() => setOpen((v) => !v)}>
        <span>{live ? "Pensando…" : "Pensamento"}</span>
        <span className="muted">
          <LiveDuration start={start} end={end} />
        </span>
      </button>
      {open && <pre className="turn-think-body">{text}</pre>}
    </div>
  );
}

function StatusIcon({ status }: { status: "running" | "done" }) {
  return status === "running" ? (
    <UiIcon icon={LoaderCircle} size={14} className="spin" />
  ) : (
    <UiIcon icon={Check} size={14} />
  );
}

function ToolRow({ id, name, detail, status }: { id: string; name: string; detail: string; status: "running" | "done" }) {
  return (
    <div className={`turn-exec ${status}`} data-tool-id={id}>
      <StatusIcon status={status} />
      <span>
        {status === "running" ? "Executando" : "Feito"} {name}
        {detail ? <span className="muted"> {detail}</span> : null}
      </span>
    </div>
  );
}

function childSummary(tools: ToolRun[]): string {
  if (!tools.length) return "";
  const name = tools[0]!.name;
  if (tools.every((t) => t.name === name)) return toolGroupLabel(name, tools.length);
  return String(tools.length);
}

function liveDetail(tools: ToolRun[]): string {
  return tools.find((t) => t.status === "running")?.detail || tools[tools.length - 1]?.detail || "";
}

function BatchGroup({ name, tools }: { name: string; tools: ToolRun[] }) {
  const live = tools.some((t) => t.status === "running");
  const [open, setOpen] = useState(live);
  useEffect(() => {
    if (live) setOpen(true);
    else setOpen(false);
  }, [live]);
  if (tools.length === 1) {
    const t = tools[0]!;
    return <ToolRow id={t.id} name={t.name} detail={t.detail} status={t.status} />;
  }
  const status = live ? "running" : "done";
  const hint = liveDetail(tools);
  return (
    <div className={`turn-exec-group ${status}`} data-tool-id={tools[0]?.id}>
      <button type="button" className="turn-exec-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <StatusIcon status={status} />
        <span>{toolGroupLabel(name, tools.length)}</span>
        {hint ? <span className="muted turn-exec-hint">{hint}</span> : null}
        <UiIcon icon={ChevronRight} size={14} className={open ? "chev open" : "chev"} />
      </button>
      <div className={`turn-exec-body${open ? " open" : ""}`}>
        <div className="turn-exec-stack">
          {tools.map((t) => (
            <ToolRow key={t.id} id={t.id} name={t.name} detail={t.detail} status={t.status} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NestedCard({ group }: { group: Extract<ToolGroup, { kind: "nested" }> }) {
  const childGroups = useMemo(() => groupToolRuns(group.children), [group.children]);
  const live = group.status === "running" || group.children.some((t) => t.status === "running");
  const [open, setOpen] = useState(live);
  useEffect(() => {
    if (live) setOpen(true);
    else setOpen(false);
  }, [live]);
  const kind = nestedToolKind(group.name) || group.name;
  const status = live ? "running" : "done";
  return (
    <div className={`turn-exec-group nested-card ${status}`} data-tool-id={group.id}>
      <button type="button" className="turn-exec-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <StatusIcon status={status} />
        <span>
          {kind} · {group.title}
        </span>
        {group.children.length > 0 ? <span className="muted">{childSummary(group.children)}</span> : null}
        <UiIcon icon={ChevronRight} size={14} className={open ? "chev open" : "chev"} />
      </button>
      <div className={`turn-exec-body${open ? " open" : ""}`}>
        <div className="turn-exec-stack">
          {childGroups.map((g, i) => (
            <ExecGroup key={g.kind === "nested" ? g.id : `${g.name}-${i}`} group={g} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ExecGroup({ group }: { group: ToolGroup }) {
  if (group.kind === "nested") return <NestedCard group={group} />;
  return <BatchGroup name={group.name} tools={group.tools} />;
}

function TurnFooter({ index, start, end }: { index: number; start: number; end: number | null }) {
  return (
    <div className="turn-foot">
      <span>turno {index + 1}</span>
      <span className="sep">·</span>
      <span>
        <LiveDuration start={start} end={end} />
      </span>
    </div>
  );
}

function ChatTranscript({ turns }: { turns: ChatTurn[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="chat"
      ref={scroller}
      onScroll={() => {
        const el = scroller.current;
        if (!el) return;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
      }}
    >
      <div className="chat-col">
        {turns.length === 0 && <p className="muted chat-empty">Escreve no compositor para começar.</p>}
        {turns.map((turn, index) => {
          const live = turn.endedAt == null && Boolean(turn.user || turn.thinking || turn.tools.length || turn.assistant);
          const body = [turn.user, turn.assistant].filter(Boolean).join("\n\n");
          const groups = groupToolRuns(turn.tools);
          return (
            <div key={turn.id} className={`chat-turn${live ? " live" : ""}${turn.origin === "system" ? " system" : ""}`}>
              {turn.user ? (
                <article className="msg user">
                  <div className="msg-body">{turn.user}</div>
                  <button type="button" className="msg-copy" title="Copiar" onClick={() => void copy(turn.user)}>
                    <UiIcon icon={Copy} size={13} />
                  </button>
                </article>
              ) : null}
              <ThinkingBlock text={turn.thinking} live={turn.endedAt == null} start={turn.startedAt} end={turn.endedAt} />
              {groups.map((g, i) => (
                <ExecGroup key={g.kind === "nested" ? g.id : `${g.name}-${i}`} group={g} />
              ))}
              <ChatMarkdown text={turn.assistant} streaming={live && Boolean(turn.assistant)} />
              {(live || turn.endedAt != null) && (turn.user || turn.assistant || turn.thinking || turn.tools.length) ? (
                <div className="turn-meta">
                  <TurnFooter index={index} start={turn.startedAt} end={turn.endedAt} />
                  {body ? (
                    <button type="button" className="msg-copy" title="Copiar turno" onClick={() => void copy(body)}>
                      <UiIcon icon={Copy} size={13} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ChatTranscript);
