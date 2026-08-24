// The status line under the composer, per provider (docs/architecture.md § Status-line).
// Unknown fields stay null so the row omits them instead of rendering "ctx —".

import { formatModelLabel, formatRateWindow, formatTokens, turnTokenCount } from "./chat";
import { turnHasOpenWork } from "./pty_translate";
import { labelOf, type UiSession } from "./ui-model";

export type ChromeStatus = {
  model: string;
  rawModel: string;
  tokensLabel: string | null;
  contextLabel: string | null;
  contextPct: number | null;
  contextTone: string;
  fiveHour: string | null;
  weekly: string | null;
  statusWarn: string | null;
  liveTurn: boolean;
};

export function chromeStatus(session: UiSession, _pulseNow: number): ChromeStatus {
  const rawModel = session.streamModel || session.model || "";
  const model = rawModel ? formatModelLabel(rawModel) : labelOf(session.provider);
  const liveTurn = turnHasOpenWork(session.turns);
  const tok = turnTokenCount(session.usage);
  const tokensLabel = tok ? `${formatTokens(tok)} tok` : null;
  if (session.provider === "cursor") {
    const pct = session.screenPct ?? null;
    const tone = pct == null ? "" : pct >= 90 ? "hot" : pct >= 70 ? "warn" : "ok";
    return {
      model,
      rawModel,
      tokensLabel: null,
      contextLabel: null,
      contextPct: pct,
      contextTone: tone,
      fiveHour: null,
      weekly: null,
      statusWarn: null,
      liveTurn,
    };
  }
  if (session.provider === "claude") {
    const weekly = session.screenQuota || formatRateWindow(session.rateLimits?.sevenDay, "semana");
    return {
      model,
      rawModel,
      tokensLabel,
      contextLabel: null,
      contextPct: null,
      contextTone: "",
      fiveHour: null,
      weekly,
      statusWarn: null,
      liveTurn,
    };
  }
  if (session.provider === "codex") {
    return {
      model,
      rawModel,
      tokensLabel: null,
      contextLabel: null,
      contextPct: null,
      contextTone: "",
      fiveHour: null,
      weekly: null,
      statusWarn: session.warned ? "MCP" : null,
      liveTurn,
    };
  }
  return {
    model,
    rawModel,
    tokensLabel,
    contextLabel: null,
    contextPct: null,
    contextTone: "",
    fiveHour: null,
    weekly: session.screenQuota ?? null,
    statusWarn: null,
    liveTurn,
  };
}
