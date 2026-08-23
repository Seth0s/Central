import { stripAnsi } from "./ansi.ts";
import { normalizeSnapshot, type ScreenView } from "./screen.ts";

export function translateCodex(chunk: string): string {
  return stripAnsi(chunk);
}

const MCP_FAIL_RE =
  /MCP (?:client for '[^']+' failed|startup (?:failed|incomplete)|startup failed)/i;

export function interpretCodexScreen(snapshot: string): ScreenView {
  const display = normalizeSnapshot(snapshot);
  return {
    display,
    warn: MCP_FAIL_RE.test(display) || /handshaking with MCP server failed/i.test(display),
  };
}
