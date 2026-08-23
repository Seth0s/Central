export type ScreenView = {
  display: string;
  model?: string;
  quota?: string;
  pct?: number;
  warn: boolean;
};

export function trimTrailingEmpty(text: string): string {
  return text.replace(/(?:\s*\n)*\s*$/, "");
}

export function collapseDuplicateLines(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (out.length && out[out.length - 1] === line && line.trim() !== "") continue;
    out.push(line);
  }
  return out.join("\n");
}

export function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

export function normalizeSnapshot(text: string): string {
  return collapseBlankRuns(collapseDuplicateLines(trimTrailingEmpty(text.replace(/\u00a0/g, " "))));
}

const BOX_ONLY = /^[\s\u2500-\u257F\u2580-\u259F─━│┃═\-]+$/;

export function isBoxDrawingLine(line: string): boolean {
  const t = line.trim();
  return t.length > 3 && BOX_ONLY.test(t);
}

export type ScreenSession = {
  ptyLog: string;
  streamModel?: string;
  screenQuota?: string;
  screenPct?: number;
  warned?: boolean;
  lastBytesAt?: number;
};

/** Same object if the interpreted frame did not change. Callers must keep that identity to skip React updates. */
export function mergeScreenSession<T extends ScreenSession>(
  session: T,
  snapshot: string,
  provider: string,
  now: number,
  interpret: (provider: string, snapshot: string) => ScreenView,
): T {
  const meta = interpret(provider, snapshot);
  const displayChanged = session.ptyLog !== meta.display;
  const nextModel = meta.model ?? session.streamModel;
  const nextQuota = meta.quota ?? session.screenQuota;
  const nextPct = meta.pct ?? session.screenPct;
  if (
    !displayChanged &&
    session.streamModel === nextModel &&
    session.screenQuota === nextQuota &&
    session.screenPct === nextPct &&
    Boolean(session.warned) === meta.warn
  ) {
    return session;
  }
  return {
    ...session,
    ptyLog: meta.display,
    lastBytesAt: displayChanged ? now : session.lastBytesAt,
    streamModel: nextModel,
    screenQuota: nextQuota,
    screenPct: nextPct,
    warned: meta.warn,
  };
}

type BufferLine = { isWrapped: boolean; translateToString: (trimRight?: boolean) => string };

/** Visible rows only. Full scrollback is too large to snapshot on every frame (Claude + split). */
export function snapshotViewport(opts: {
  rows: number;
  viewportY: number;
  getLine: (y: number) => BufferLine | undefined;
}): string {
  const lines: string[] = [];
  for (let y = 0; y < opts.rows; y++) {
    const line = opts.getLine(opts.viewportY + y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length) {
      lines[lines.length - 1] = `${lines[lines.length - 1] ?? ""}${text}`;
    } else {
      lines.push(text);
    }
  }
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.join("\n");
}
