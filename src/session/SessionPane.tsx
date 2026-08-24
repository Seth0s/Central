// One agent pane = one PTY. The terminal is always mounted at its real size;
// the Chrome view lays a transcript + composer over it so the TUI never
// collapses (docs/architecture.md § Sessões).

import type { MutableRefObject } from "react";
import { X } from "lucide-react";
import { UiIcon } from "../icons";
import { TermView } from "../NativeTermHost";
import ChatTranscript from "../ChatTranscript";
import Composer from "../Composer";
import type { PtyHandle } from "../PtyTerm";
import type { DraftFile } from "../lib/slash";
import type { TermBackend } from "../lib/commands";
import { folderName } from "../lib/paths";
import { chromeStatus } from "../lib/status-line";
import type { SessionView, UiSession } from "../lib/ui-model";
import Skeleton from "../ui/Skeleton";

export default function SessionPane({
  session,
  active,
  ptyRefs,
  composerRefs,
  onActivate,
  onDraft,
  onFiles,
  onMode,
  onEffort,
  onSend,
  onStop,
  onClose,
  onSlashNav,
  onSlashPick,
  onModelClick,
  onView,
  pulseNow,
  slashOpen,
  termBackend,
  occluded,
  onScreen,
}: {
  session: UiSession;
  active: boolean;
  ptyRefs: MutableRefObject<Map<string, PtyHandle>>;
  composerRefs: MutableRefObject<Map<string, HTMLTextAreaElement>>;
  onActivate: () => void;
  onDraft: (v: string) => void;
  onFiles: (files: DraftFile[]) => void;
  onMode: (id: string) => void;
  onEffort: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
  onClose: () => void;
  onSlashNav: (dir: number) => void;
  onSlashPick: () => void;
  onModelClick: () => void;
  onView: (view: SessionView) => void;
  pulseNow: number;
  slashOpen: boolean;
  termBackend: TermBackend | null;
  occluded: boolean;
  onScreen: (text: string) => void;
}) {
  const status = chromeStatus(session, pulseNow);
  const native = termBackend !== "xterm";
  const showTerm = session.view === "cli" && !occluded;
  const booting =
    session.status === "running" && !session.lastBytesAt && !(session.ptyLog && session.ptyLog.length > 0);

  return (
    <section className={`session-pane ${active ? "active-pane" : ""}`} onClick={onActivate}>
      <div className="session-head">
        <span className="name">{session.name}</span>
        <span className="muted">{folderName(session.cwd)}</span>
        <span className="grow" />
        <div className="view-toggle" role="group" aria-label="Vista">
          <button
            type="button"
            className={session.view === "cli" ? "on" : ""}
            onClick={(e) => {
              e.stopPropagation();
              onView("cli");
            }}
          >
            CLI
          </button>
          <button
            type="button"
            className={session.view === "chrome" ? "on" : ""}
            onClick={(e) => {
              e.stopPropagation();
              onView("chrome");
            }}
          >
            Chrome
          </button>
        </div>
        <button
          type="button"
          className="tab-close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Fechar agente"
        >
          <UiIcon icon={X} size={14} />
        </button>
      </div>
      <div className="session-body">
        <TermView
          sessionId={session.id}
          className="pty-host"
          native={native}
          visible={showTerm}
          interactive={showTerm}
          onScreen={onScreen}
          ptyRef={(h) => {
            if (h) ptyRefs.current.set(session.id, h);
            else ptyRefs.current.delete(session.id);
          }}
        />
        {booting && showTerm && (
          <div className="skeleton-overlay">
            <Skeleton.Pane label="A iniciar o agente…" />
          </div>
        )}
        {session.view === "chrome" && (
          <div className="chrome-overlay">
            {booting && (
              <div className="skeleton-overlay">
                <Skeleton.Pane label="A iniciar o agente…" />
              </div>
            )}
            <ChatTranscript turns={session.turns} />
            <Composer
              sessionId={session.id}
              provider={session.provider}
              cwd={session.cwd}
              draft={session.draft}
              files={session.draftFiles ?? []}
              chatMode={session.chatMode ?? ""}
              effort={session.effort ?? ""}
              model={status.model}
              modelTitle={status.rawModel || undefined}
              tokensLabel={status.tokensLabel}
              contextLabel={status.contextLabel}
              contextPct={status.contextPct}
              contextTone={status.contextTone}
              fiveHour={status.fiveHour}
              weekly={status.weekly}
              statusWarn={status.statusWarn}
              liveTurn={status.liveTurn}
              slashOpen={slashOpen}
              composerRefs={composerRefs}
              onDraft={onDraft}
              onFiles={onFiles}
              onMode={onMode}
              onEffort={onEffort}
              onSend={onSend}
              onStop={onStop}
              onSlashNav={onSlashNav}
              onSlashPick={onSlashPick}
              onModelClick={onModelClick}
            />
          </div>
        )}
      </div>
    </section>
  );
}
