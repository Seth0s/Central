// Path and id helpers shared by the chrome. Pure: no React, no IPC.

export function folderName(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd || "workspace";
}

export function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/$/, "");
}

export function sameCwd(a: string, b: string): boolean {
  return normPath(a) === normPath(b);
}

export function parentDir(path: string): string {
  const n = normPath(path);
  const i = n.lastIndexOf("/");
  return i <= 0 ? n : n.slice(0, i);
}

export type FileCrumb = { label: string; dir?: string; file?: boolean };

export function fileCrumbs(ws: string, dir?: string, file?: string): FileCrumb[] {
  const crumbs: FileCrumb[] = [{ label: folderName(ws) || "workspace" }];
  if (dir && ws) {
    const base = normPath(ws);
    const cur = normPath(dir);
    const rel = cur.startsWith(base) ? cur.slice(base.length).replace(/^\//, "") : "";
    let acc = base;
    for (const part of rel.split("/").filter(Boolean)) {
      acc = `${acc}/${part}`;
      crumbs.push({ label: part, dir: acc });
    }
  }
  if (file) crumbs.push({ label: file, file: true });
  return crumbs;
}

/** Every line written to a PTY ends in a newline — the TUI submits on it. */
export function ptyLine(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function newSid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
