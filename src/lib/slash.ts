export type SlashKind = "control" | "pick" | "report" | "chrome" | "prompt";

export type SlashCmd = { cmd: string; desc: string; kind: SlashKind };

export const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  fixture: "Fixture",
  shell: "Terminal",
};

export type PickCmd = "/model" | "/effort" | "/autocompact";

export const SLASH_COMMANDS: Record<string, SlashCmd[]> = {
  claude: [
    { cmd: "/help", desc: "Mostrar ajuda do Claude Code", kind: "report" },
    { cmd: "/clear", desc: "Limpar a conversa", kind: "chrome" },
    { cmd: "/compact", desc: "Compactar o contexto", kind: "report" },
    { cmd: "/autocompact", desc: "Janela do auto-compact (auto|200k|500k|1M)", kind: "pick" },
    { cmd: "/context", desc: "Uso do contexto", kind: "report" },
    { cmd: "/config", desc: "Definições do CLI", kind: "report" },
    { cmd: "/model", desc: "Trocar o modelo", kind: "pick" },
    { cmd: "/permissions", desc: "Permissões de ferramentas", kind: "report" },
    { cmd: "/mcp", desc: "Servidores MCP do vendor", kind: "report" },
    { cmd: "/memory", desc: "Editar memória", kind: "report" },
    { cmd: "/usage", desc: "Custo e utilização da sessão", kind: "report" },
    { cmd: "/cost", desc: "Custo da sessão", kind: "report" },
    { cmd: "/doctor", desc: "Diagnosticar o CLI", kind: "report" },
    { cmd: "/review", desc: "Revisar alterações", kind: "report" },
    { cmd: "/diff", desc: "Ver alterações", kind: "report" },
    { cmd: "/init", desc: "Inicializar CLAUDE.md", kind: "report" },
    { cmd: "/vim", desc: "Modo vim", kind: "control" },
    { cmd: "/plan", desc: "Entrar em modo plano", kind: "control" },
    { cmd: "/effort", desc: "Nível de esforço (low|medium|high|xhigh)", kind: "pick" },
    { cmd: "/resume", desc: "Abrir sessão vendor no TUI", kind: "prompt" },
    { cmd: "/continue", desc: "Continuar a última conversa nesta pasta (TUI)", kind: "prompt" },
  ],
  codex: [
    { cmd: "/status", desc: "Estado da sessão Codex", kind: "report" },
    { cmd: "/model", desc: "Escolher modelo", kind: "pick" },
    { cmd: "/effort", desc: "Esforço de raciocínio", kind: "pick" },
    { cmd: "/approvals", desc: "Política de aprovação", kind: "report" },
    { cmd: "/review", desc: "Revisar o diff", kind: "report" },
    { cmd: "/compact", desc: "Compactar contexto", kind: "report" },
    { cmd: "/diff", desc: "Mostrar diff", kind: "report" },
    { cmd: "/new", desc: "Nova conversa", kind: "chrome" },
    { cmd: "/undo", desc: "Desfazer último passo", kind: "control" },
    { cmd: "/exit", desc: "Encerrar o CLI", kind: "chrome" },
  ],
  cursor: [
    { cmd: "/edit", desc: "Editar o ficheiro focado", kind: "prompt" },
    { cmd: "/ask", desc: "Perguntar sem editar", kind: "prompt" },
    { cmd: "/fix", desc: "Corrigir o problema", kind: "prompt" },
    { cmd: "/explain", desc: "Explicar o código", kind: "prompt" },
    { cmd: "/tests", desc: "Gerar ou correr testes", kind: "prompt" },
    { cmd: "/doc", desc: "Documentar a seleção", kind: "prompt" },
    { cmd: "/commit", desc: "Mensagem de commit", kind: "prompt" },
    { cmd: "/review", desc: "Rever o diff local", kind: "prompt" },
    { cmd: "/generate", desc: "Gerar a partir do contexto", kind: "prompt" },
    { cmd: "/resume", desc: "Abrir sessão vendor no TUI", kind: "prompt" },
  ],
  fixture: [
    { cmd: "/echo", desc: "Ecoar o stdin (harness)", kind: "report" },
    { cmd: "/help", desc: "Ajuda do fixture", kind: "report" },
    { cmd: "/clear", desc: "Limpar buffer", kind: "chrome" },
    { cmd: "/json", desc: "Emitir linha JSON", kind: "report" },
    { cmd: "/pty", desc: "Simular frame PTY", kind: "chrome" },
  ],
};

export function slashItems(provider: string, filter: string): SlashCmd[] {
  const all = SLASH_COMMANDS[provider] ?? [];
  const q = filter.trim().toLowerCase();
  if (!q || q === "/") return all;
  return all.filter((c) => c.cmd.startsWith(q) || c.cmd.includes(q.slice(1)));
}

export type ProviderMode = { id: string; label: string; slash: string };
export type EffortLevel = { id: string; label: string };
export type ModelAlias = { id: string; label: string };
export type DraftFile = { path: string; name: string };

export type ClassifiedSlash = {
  cmd: string;
  rest: string;
  kind: SlashKind;
  line: string;
};

/** Documented mid-session modes only. Agent is Claude default (no prefix); Plan is `/plan`. */
export const PROVIDER_MODES: Record<string, ProviderMode[]> = {
  claude: [
    { id: "agent", label: "Agent", slash: "" },
    { id: "plan", label: "Plan", slash: "/plan" },
  ],
};

export const PROVIDER_EFFORT: Record<string, EffortLevel[]> = {
  claude: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
    { id: "xhigh", label: "Max" },
  ],
  codex: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ],
};

/** Documented `/model` aliases. Not a live vendor inventory. */
export const PROVIDER_MODELS: Record<string, ModelAlias[]> = {
  claude: [
    { id: "sonnet", label: "Sonnet" },
    { id: "opus", label: "Opus" },
    { id: "haiku", label: "Haiku" },
  ],
  codex: [
    { id: "gpt-5", label: "GPT-5" },
    { id: "o3", label: "o3" },
    { id: "codex", label: "Codex" },
  ],
};

export function providerModes(provider: string): ProviderMode[] {
  return PROVIDER_MODES[provider] ?? [];
}

export function providerEffort(provider: string): EffortLevel[] {
  return PROVIDER_EFFORT[provider] ?? [];
}

export function providerModels(provider: string): ModelAlias[] {
  return PROVIDER_MODELS[provider] ?? [];
}

export const AUTOCOMPACT_WINDOWS: { id: string; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "200k", label: "200k" },
  { id: "500k", label: "500k" },
  { id: "1M", label: "1M" },
];

export function isPickCmd(cmd: string): cmd is PickCmd {
  return cmd === "/model" || cmd === "/effort" || cmd === "/autocompact";
}

export function pickOptions(provider: string, cmd: PickCmd): { id: string; label: string }[] {
  if (cmd === "/model") return providerModels(provider);
  if (cmd === "/effort") return providerEffort(provider);
  return AUTOCOMPACT_WINDOWS;
}

export function defaultChatMode(provider: string): string {
  return providerModes(provider)[0]?.id ?? "";
}

export function defaultEffort(provider: string): string {
  const levels = providerEffort(provider);
  return levels.find((e) => e.id === "medium")?.id ?? levels[0]?.id ?? "";
}

export function parseSlashInput(text: string): { cmd: string; rest: string } | null {
  const t = text.trim();
  const m = t.match(/^(\/[^\s]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { cmd: m[1]!.toLowerCase(), rest: (m[2] ?? "").trim() };
}

/** Map `/resume` / `/continue` to documented vendor argv. Null if the provider cannot attach. */
export function vendorAttachArgs(
  provider: string,
  resumeRaw: string,
  continueCmd = false,
): { resumeId?: string; continueLast: boolean } | null {
  const id = resumeRaw.trim();
  if (id) return { resumeId: id, continueLast: false };
  if (continueCmd || provider === "claude") return { continueLast: true };
  return null;
}

export function slashKindOf(provider: string, cmd: string): SlashKind | undefined {
  return (SLASH_COMMANDS[provider] ?? []).find((c) => c.cmd === cmd)?.kind;
}

export function classifyOutgoing(provider: string, text: string): ClassifiedSlash | null {
  const parsed = parseSlashInput(text);
  if (!parsed) return null;
  const kind = slashKindOf(provider, parsed.cmd);
  if (!kind || kind === "prompt") return null;
  if (kind === "pick" && parsed.rest) {
    return {
      cmd: parsed.cmd,
      rest: parsed.rest,
      kind: "control",
      line: `${parsed.cmd} ${parsed.rest}`,
    };
  }
  return {
    cmd: parsed.cmd,
    rest: parsed.rest,
    kind,
    line: parsed.rest ? `${parsed.cmd} ${parsed.rest}` : parsed.cmd,
  };
}

export function composeOutgoing(opts: { draft: string; files: DraftFile[] }): string {
  const raw = opts.draft.trim();
  const paths = opts.files.map((f) => f.path);
  if (!paths.length) return raw;
  const list = paths.map((p) => `- ${p}`).join("\n");
  return [raw, `Anexos:\n${list}`].filter(Boolean).join("\n\n");
}

export function contentTurnCount(turns: { user: string; assistant: string }[]): number {
  return turns.filter((t) => t.user || t.assistant).length;
}
