/** OSC (hyperlinks, titles): ESC ] … BEL or ST. Must run before the 2-byte ESC matcher. */
const OSC_RE = /\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g;
/** CSI and other 7-bit ESC sequences. */
const CSI_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(input: string): string {
  const withoutEsc = input.replace(OSC_RE, "").replace(CSI_RE, "");
  return applyCarriageReturns(withoutEsc);
}

/** `\r\n` is a newline; a lone `\r` overwrites the current line (spinners, progress). */
export function applyCarriageReturns(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const parts = line.split("\r");
      return parts[parts.length - 1] ?? "";
    })
    .join("\n");
}

export const PTY_LOG_CAP = 80_000;
export const PTY_ACTIVE_MS = 1500;

export function appendPtyLog(prev: string, chunk: string, cap = PTY_LOG_CAP): string {
  const next = prev + chunk;
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function ptyIsActive(lastBytesAt: number | undefined, now: number, windowMs = PTY_ACTIVE_MS): boolean {
  return typeof lastBytesAt === "number" && now - lastBytesAt < windowMs;
}
