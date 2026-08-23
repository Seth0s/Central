// Window footer: folder, focused agent, model, context, turn count. The tetris
// pulse only shows while the agent is running or warned.

import { contextUsed, formatModelLabel } from "../lib/chat";
import { contentTurnCount } from "../lib/slash";
import { folderName } from "../lib/paths";
import { labelOf, type UiSession } from "../lib/ui-model";

export default function StatusBar({
  cwd,
  active,
  pulse,
}: {
  cwd: string;
  active: UiSession | null;
  pulse: string | undefined;
}) {
  const model = active ? active.streamModel || active.model : null;
  const contextPct = active
    ? contextUsed(active.usage, active.usage?.contextWindow ?? active.contextWindow)
    : null;

  return (
    <footer className="statusbar">
      <span>{cwd ? folderName(cwd) : "sem pasta"}</span>
      <span className="sep">·</span>
      <span>{active?.name ?? "sem agente"}</span>
      {active && (
        <>
          <span className="sep">·</span>
          <span>{model ? formatModelLabel(model) : labelOf(active.provider)}</span>
          <span className="sep">·</span>
          <span>{contextPct == null ? "ctx —" : `ctx ${contextPct}%`}</span>
          <span className="sep">·</span>
          <span>turno {contentTurnCount(active.turns)}</span>
          {(pulse === "run" || pulse === "warn") && (
            <span className="tetris" aria-hidden>
              {Array.from({ length: 4 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          )}
        </>
      )}
    </footer>
  );
}
