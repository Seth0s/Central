// Window footer: folder, focused agent, model, context, turn count.
// Activity pulse lives on the agent orb in the tree — not a tetris spinner here.

import { contextUsed, formatModelLabel } from "../lib/chat";
import { contentTurnCount } from "../lib/slash";
import { folderName } from "../lib/paths";
import { labelOf, type UiSession } from "../lib/ui-model";

export default function StatusBar({
  cwd,
  active,
}: {
  cwd: string;
  active: UiSession | null;
  /** @deprecated Kept for call-site compat; orb owns the run/warn pulse. */
  pulse?: string;
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
        </>
      )}
    </footer>
  );
}
