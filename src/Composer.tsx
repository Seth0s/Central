import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowUp, ChevronDown, Mic, Plus, Square, X } from "lucide-react";
import { isImageName } from "./lib/files";
import { providerEffort, providerModes, type DraftFile } from "./lib/slash";
import { UiIcon } from "./icons";

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Menu = "mode" | "effort" | null;

type Props = {
  sessionId: string;
  provider: string;
  cwd: string;
  draft: string;
  files: DraftFile[];
  chatMode: string;
  effort: string;
  model: string;
  modelTitle?: string;
  tokensLabel: string | null;
  contextLabel: string | null;
  contextPct: number | null;
  contextTone: string;
  fiveHour: string | null;
  weekly: string | null;
  statusWarn: string | null;
  liveTurn: boolean;
  slashOpen: boolean;
  composerRefs: MutableRefObject<Map<string, HTMLTextAreaElement>>;
  onDraft: (v: string) => void;
  onFiles: (files: DraftFile[]) => void;
  onMode: (id: string) => void;
  onEffort: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
  onSlashNav: (dir: number) => void;
  onSlashPick: () => void;
  onModelClick: () => void;
};

export default function Composer({
  sessionId,
  provider,
  cwd,
  draft,
  files,
  chatMode,
  effort,
  model,
  modelTitle,
  tokensLabel,
  contextLabel,
  contextPct,
  contextTone,
  fiveHour,
  weekly,
  statusWarn,
  liveTurn,
  slashOpen,
  composerRefs,
  onDraft,
  onFiles,
  onMode,
  onEffort,
  onSend,
  onStop,
  onSlashNav,
  onSlashPick,
  onModelClick,
}: Props) {
  const [menu, setMenu] = useState<Menu>(null);
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const draftRef = useRef(draft);
  const boxRef = useRef<HTMLDivElement>(null);
  const modes = providerModes(provider);
  const efforts = providerEffort(provider);
  const mode = modes.find((m) => m.id === chatMode) ?? modes[0];
  const effortMeta = efforts.find((e) => e.id === effort) ?? efforts.find((e) => e.id === "medium") ?? efforts[0];
  const canSend = Boolean(draft.trim() || files.length);
  const modeId = mode?.id ?? "agent";

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    setVoiceOk(Boolean(speechCtor()));
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setMenu(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  async function attach() {
    const selected = await open({
      multiple: true,
      defaultPath: cwd || undefined,
      title: "Anexar ficheiros",
    });
    if (selected == null) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const next: DraftFile[] = paths.map((path) => ({
      path,
      name: path.replace(/\\/g, "/").split("/").pop() || path,
    }));
    const seen = new Set(files.map((f) => f.path));
    onFiles([...files, ...next.filter((f) => !seen.has(f.path))]);
  }

  function toggleVoice() {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      setListening(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1];
      const piece = last?.[0]?.transcript?.trim();
      if (!piece) return;
      const cur = draftRef.current.trim();
      onDraft(cur ? `${cur} ${piece}` : piece);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  return (
    <div className="composer">
      <div className="composer-box" data-mode={modeId} ref={boxRef}>
        {files.length > 0 && (
          <div className="composer-chips">
            {files.map((f) => (
              <div key={f.path} className="composer-chip">
                {isImageName(f.name) ? (
                  <img src={convertFileSrc(f.path)} alt="" />
                ) : null}
                <span title={f.path}>{f.name}</span>
                <button
                  type="button"
                  className="composer-chip-x"
                  aria-label={`Remover ${f.name}`}
                  onClick={() => onFiles(files.filter((x) => x.path !== f.path))}
                >
                  <UiIcon icon={X} size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={(el) => {
            if (el) {
              composerRefs.current.set(sessionId, el);
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            } else composerRefs.current.delete(sessionId);
          }}
          rows={1}
          value={draft}
          placeholder="Mensagem ou /comando"
          onChange={(e) => {
            onDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (slashOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              onSlashNav(e.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (slashOpen && e.key === "Enter") {
              e.preventDefault();
              onSlashPick();
              return;
            }
            if (e.key === "Escape" && liveTurn) {
              e.preventDefault();
              onStop();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (liveTurn) return;
              onSend();
            }
          }}
        />
        <div className="composer-bar">
          <button type="button" className="composer-icon" title="Anexar" aria-label="Anexar" onClick={() => void attach()}>
            <UiIcon icon={Plus} size={18} />
          </button>
          {modes.length > 0 && (
            <div className="composer-pop">
              <button
                type="button"
                className={`composer-mode mode-${modeId}`}
                aria-haspopup="menu"
                aria-expanded={menu === "mode"}
                onClick={() => setMenu(menu === "mode" ? null : "mode")}
              >
                {mode?.label ?? "Agent"}
              </button>
              {menu === "mode" && (
                <div className="composer-menu" role="menu">
                  {modes.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitem"
                      className={m.id === modeId ? "on" : ""}
                      onClick={() => {
                        onMode(m.id);
                        setMenu(null);
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {efforts.length > 0 && (
            <div className="composer-pop">
              <button
                type="button"
                className="composer-effort"
                aria-haspopup="menu"
                aria-expanded={menu === "effort"}
                onClick={() => setMenu(menu === "effort" ? null : "effort")}
              >
                {effortMeta?.label ?? "Effort"}
                <UiIcon icon={ChevronDown} size={14} />
              </button>
              {menu === "effort" && (
                <div className="composer-menu" role="menu">
                  {efforts.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      role="menuitem"
                      className={e.id === effortMeta?.id ? "on" : ""}
                      onClick={() => {
                        onEffort(e.id);
                        setMenu(null);
                      }}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <span className="grow" />
          {voiceOk && (
            <button
              type="button"
              className={`composer-icon${listening ? " on" : ""}`}
              title="Voz"
              aria-label="Ditafone"
              aria-pressed={listening}
              onClick={toggleVoice}
            >
              <UiIcon icon={Mic} size={16} />
            </button>
          )}
          {liveTurn ? (
            <button
              type="button"
              className="composer-send stop"
              title="Parar"
              aria-label="Parar inferência"
              onClick={onStop}
            >
              <UiIcon icon={Square} size={12} />
            </button>
          ) : canSend ? (
            <button
              type="button"
              className="composer-send"
              title="Enviar"
              aria-label="Enviar"
              onClick={onSend}
            >
              <UiIcon icon={ArrowUp} size={16} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="status-line">
        <button type="button" className="sl-model" onClick={onModelClick} title={modelTitle || "Trocar modelo"}>
          {model}
        </button>
        {tokensLabel ? (
          <>
            <span className="sep">·</span>
            <span className="sl-tok">{tokensLabel}</span>
          </>
        ) : null}
        {contextLabel ? (
          <>
            <span className="sep">·</span>
            <span className="sl-ctx">{contextLabel}</span>
          </>
        ) : null}
        {fiveHour ? (
          <>
            <span className="sep">·</span>
            <span className="sl-rate">{fiveHour}</span>
          </>
        ) : null}
        {weekly ? (
          <>
            <span className="sep">·</span>
            <span className="sl-rate">{weekly}</span>
          </>
        ) : null}
        {statusWarn ? (
          <>
            <span className="sep">·</span>
            <span className="sl-warn">{statusWarn}</span>
          </>
        ) : null}
        {contextPct != null ? (
          <>
            <span className={`sl-meter ${contextTone}`}>
              <span style={{ width: `${contextPct}%` }} />
            </span>
            <span className={`sl-pct ${contextTone}`}>{contextPct}%</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
