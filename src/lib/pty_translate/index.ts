import { interpretClaudeScreen, translateClaude } from "./claude.ts";
import { interpretCodexScreen, translateCodex } from "./codex.ts";
import { interpretCursorScreen, translateCursor } from "./cursor.ts";
import { interpretFixtureScreen, translateFixture } from "./fixture.ts";
import { normalizeSnapshot, type ScreenView } from "./screen.ts";

export { appendPtyLog, ptyIsActive, PTY_ACTIVE_MS, stripAnsi } from "./ansi.ts";
export { mergeScreenSession, snapshotViewport } from "./screen.ts";
export type { ScreenView } from "./screen.ts";
export {
  addedLines,
  applySkinObservers,
  filterVendorChrome,
  observeScreen,
  settleTurnsIfIdle,
  turnHasOpenWork,
} from "./observe.ts";
export {
  browseProtocolPrompt,
  mergeSeenUrls,
  observeBrowseRequests,
  MAX_SEEN_URLS,
  OPEN_MARKER,
  type BrowseObservation,
} from "./browse_request.ts";

export function translatePty(provider: string, chunk: string): string {
  switch (provider) {
    case "codex":
      return translateCodex(chunk);
    case "cursor":
      return translateCursor(chunk);
    case "fixture":
      return translateFixture(chunk);
    default:
      return translateClaude(chunk);
  }
}

/** Interpret a rendered TUI frame (xterm buffer), not the raw byte stream. */
export function interpretScreen(provider: string, snapshot: string): ScreenView {
  switch (provider) {
    case "codex":
      return interpretCodexScreen(snapshot);
    case "cursor":
      return interpretCursorScreen(snapshot);
    case "fixture":
      return interpretFixtureScreen(snapshot);
    case "claude":
      return interpretClaudeScreen(snapshot);
    default:
      return { display: normalizeSnapshot(snapshot), warn: false };
  }
}
