export type ChatRole = "user" | "assistant" | "tool";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  toolId?: string;
};

export type NestedAgent = {
  id: string;
  title: string;
  kind: string;
  status: "running" | "done";
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheRead?: number;
  cacheWrite?: number;
  contextWindow?: number;
  model?: string;
};

export type RateWindow = {
  usedPct?: number;
  resetsAt?: number;
  status?: string;
};

export type RateLimits = {
  fiveHour?: RateWindow;
  sevenDay?: RateWindow;
};

export type ToolRun = {
  id: string;
  name: string;
  detail: string;
  status: "running" | "done";
  parentId?: string;
};

export type ToolGroup =
  | {
      kind: "nested";
      id: string;
      name: string;
      title: string;
      status: "running" | "done";
      children: ToolRun[];
    }
  | { kind: "batch"; name: string; tools: ToolRun[] };

export type ChatTurn = {
  id: string;
  user: string;
  thinking: string;
  tools: ToolRun[];
  assistant: string;
  usage: Usage | null;
  startedAt: number;
  endedAt: number | null;
  origin?: "user" | "system";
};

export type JsonLineEffect = {
  assistantText?: string;
  replaceAssistant?: boolean;
  thinking?: string;
  tool?: string;
  toolId?: string;
  toolDone?: string;
  usage?: Usage;
  turnUsage?: Usage;
  turnDone?: boolean;
  url?: string;
  model?: string;
  file?: string;
  sessionId?: string;
  nested?: NestedAgent;
  rateLimits?: RateLimits;
  contextWindow?: number;
  parentId?: string;
  moreTools?: JsonLineEffect[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const p = asRecord(part);
      if (!p) return "";
      if (p.type === "thinking" || p.type === "reasoning") return "";
      if (typeof p.text === "string") return p.text;
      if (p.type === "tool_use" && typeof p.name === "string") return "";
      return "";
    })
    .join("");
}

function thinkingFromUnknown(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const o = asRecord(raw);
  if (!o) return "";
  if (typeof o.thinking === "string") return o.thinking;
  if (typeof o.reasoning === "string") return o.reasoning;
  if (o.type === "thinking" || o.type === "reasoning" || o.type === "thinking_delta") {
    if (typeof o.text === "string") return o.text;
  }
  return "";
}

function thinkingFromContent(content: unknown): string {
  if (!Array.isArray(content)) return thinkingFromUnknown(content);
  return content.map((part) => thinkingFromUnknown(part)).join("");
}

function fileFromUnknown(raw: unknown): string | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;
  for (const key of ["file_path", "path", "file", "filename", "target"]) {
    const v = o[key];
    if (typeof v === "string" && v.length > 1 && v.length < 400) return v;
  }
  return undefined;
}

export function nestedToolKind(name: string): string | null {
  const n = name.toLowerCase().replace(/[^a-z]/g, "");
  if (n === "task" || n === "tasktool" || n.endsWith("task")) return "Task";
  if (n === "explore" || n === "exploreagent") return "Explore";
  if (n === "agent" || n === "subagent") return "Agent";
  return null;
}

export function toolGroupLabel(name: string, count: number): string {
  const n = name.toLowerCase();
  if (n === "read") return count === 1 ? "Leu 1 ficheiro" : `Leu ${count} ficheiros`;
  if (count === 1) return name;
  return `${name} ×${count}`;
}

export function groupToolRuns(tools: ToolRun[]): ToolGroup[] {
  const nestedIds = new Set(tools.filter((t) => nestedToolKind(t.name)).map((t) => t.id));
  const childrenOf = new Map<string, ToolRun[]>();
  for (const t of tools) {
    if (!t.parentId || !nestedIds.has(t.parentId)) continue;
    const list = childrenOf.get(t.parentId) ?? [];
    list.push(t);
    childrenOf.set(t.parentId, list);
  }
  const childIds = new Set(Array.from(childrenOf.values()).flatMap((list) => list.map((t) => t.id)));
  const roots = tools.filter((t) => !childIds.has(t.id));
  const groups: ToolGroup[] = [];
  let i = 0;
  while (i < roots.length) {
    const t = roots[i]!;
    if (nestedToolKind(t.name)) {
      groups.push({
        kind: "nested",
        id: t.id,
        name: t.name,
        title: t.detail || nestedToolKind(t.name) || t.name,
        status: t.status,
        children: childrenOf.get(t.id) ?? [],
      });
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < roots.length && roots[j]!.name === t.name && !nestedToolKind(roots[j]!.name)) j += 1;
    groups.push({ kind: "batch", name: t.name, tools: roots.slice(i, j) });
    i = j;
  }
  return groups;
}

function parentIdFrom(raw: Record<string, unknown> | null | undefined): string | undefined {
  if (!raw) return undefined;
  for (const key of ["parent_tool_use_id", "parent_tool_id", "parentToolUseId", "parent_id"]) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function titleFromInput(input: Record<string, unknown> | null, fallback: string): string {
  if (!input) return fallback;
  for (const key of ["description", "prompt", "subagent_type", "name", "title"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) {
      const t = v.replace(/\s+/g, " ").trim();
      return t.length > 80 ? `${t.slice(0, 79)}…` : t;
    }
  }
  return fallback;
}

type ToolHit = {
  name: string;
  id?: string;
  url?: string;
  file?: string;
  parentId?: string;
  input: Record<string, unknown> | null;
};

function toolFromBlock(p: Record<string, unknown>): ToolHit | null {
  if (p.type !== "tool_use" || typeof p.name !== "string") return null;
  const input = asRecord(p.input);
  const url =
    (input && typeof input.url === "string" && input.url) ||
    (typeof p.url === "string" && p.url) ||
    undefined;
  const id = typeof p.id === "string" ? p.id : undefined;
  return {
    name: p.name,
    id,
    url,
    file: fileFromUnknown(input) ?? fileFromUnknown(p),
    parentId: parentIdFrom(p) ?? parentIdFrom(input),
    input,
  };
}

function toolsFromContent(content: unknown): ToolHit[] {
  if (!Array.isArray(content)) return [];
  const hits: ToolHit[] = [];
  for (const part of content) {
    const p = asRecord(part);
    if (!p) continue;
    const hit = toolFromBlock(p);
    if (hit) hits.push(hit);
  }
  return hits;
}

function nestedFromTool(hit: ToolHit): NestedAgent | undefined {
  const kind = nestedToolKind(hit.name);
  if (!kind) return undefined;
  const id = hit.id || hit.name;
  return {
    id,
    kind,
    title: titleFromInput(hit.input, kind),
    status: "running",
  };
}

function toolResultId(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    const p = asRecord(part);
    if (!p) continue;
    if (p.type === "tool_result" && typeof p.tool_use_id === "string") return p.tool_use_id;
  }
  return undefined;
}

function parseUsage(raw: unknown): Usage | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;
  const input =
    num(o.input_tokens) ??
    num(o.inputTokens) ??
    num(o.prompt_tokens) ??
    num(asRecord(o.usage)?.input_tokens);
  const output =
    num(o.output_tokens) ??
    num(o.outputTokens) ??
    num(o.completion_tokens) ??
    num(asRecord(o.usage)?.output_tokens);
  const nested = asRecord(o.usage);
  const nestedUsage = nested
    ? parseUsage({
        input_tokens: nested.input_tokens ?? nested.inputTokens,
        output_tokens: nested.output_tokens ?? nested.outputTokens,
        cache_read_input_tokens: nested.cache_read_input_tokens,
        cache_creation_input_tokens: nested.cache_creation_input_tokens,
      })
    : undefined;
  if (nestedUsage && input == null && output == null) return nestedUsage;
  if (input == null && output == null) return undefined;
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    cacheRead: num(o.cache_read_input_tokens) ?? num(o.cacheRead) ?? num(o.cached_input_tokens),
    cacheWrite:
      num(o.cache_creation_input_tokens) ?? num(o.cacheWrite) ?? num(o.cache_write_input_tokens),
    contextWindow:
      num(o.context_window) ??
      num(o.contextWindow) ??
      num(asRecord(o.context_window)?.context_window_size) ??
      num(asRecord(o.contextWindow)?.context_window_size) ??
      num(asRecord(o.context_window)?.size),
    model: typeof o.model === "string" ? o.model : undefined,
  };
}

function parseWindow(raw: unknown): RateWindow | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;
  const utilization = num(o.utilization);
  const usedPct =
    num(o.used_percentage) ??
    num(o.usedPercentage) ??
    (utilization == null ? undefined : utilization <= 1 ? utilization * 100 : utilization);
  const resetsAt = num(o.resets_at) ?? num(o.resetsAt);
  const status = typeof o.status === "string" ? o.status : undefined;
  if (usedPct == null && resetsAt == null && !status) return undefined;
  return { usedPct, resetsAt, status };
}

function windowKind(raw: string): keyof RateLimits | undefined {
  const k = raw.toLowerCase().replace(/-/g, "_");
  if (k.includes("five") || k === "5h" || k.includes("5_hour")) return "fiveHour";
  if (k.includes("seven") || k.includes("week") || k.includes("7_day")) return "sevenDay";
  return undefined;
}

export function parseRateLimits(raw: unknown): RateLimits | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;
  const out: RateLimits = {};
  const nested = asRecord(o.rate_limits) ?? asRecord(o.rateLimits);
  if (nested) {
    const five = parseWindow(nested.five_hour ?? nested.fiveHour);
    const week = parseWindow(nested.seven_day ?? nested.sevenDay ?? nested.weekly);
    if (five) out.fiveHour = five;
    if (week) out.sevenDay = week;
  }
  const info = asRecord(o.rate_limit_info) ?? asRecord(o.rateLimitInfo);
  if (info) {
    const kind = windowKind(String(info.rateLimitType ?? info.rate_limit_type ?? info.type ?? ""));
    const win = parseWindow(info);
    if (kind && win) out[kind] = { ...out[kind], ...win };
  }
  return out.fiveHour || out.sevenDay ? out : undefined;
}

export function mergeRateLimits(prev: RateLimits | undefined, next: RateLimits | undefined): RateLimits | undefined {
  if (!next) return prev;
  if (!prev) return next;
  return {
    fiveHour: next.fiveHour ? { ...prev.fiveHour, ...next.fiveHour } : prev.fiveHour,
    sevenDay: next.sevenDay ? { ...prev.sevenDay, ...next.sevenDay } : prev.sevenDay,
  };
}

export function formatRateWindow(w: RateWindow | undefined, label: string): string | null {
  if (!w) return null;
  if (w.usedPct != null && Number.isFinite(w.usedPct)) return `${label} ${Math.round(w.usedPct)}%`;
  if (w.status && w.status !== "allowed") return `${label} ${w.status}`;
  if (w.status === "allowed") return `${label} ok`;
  return null;
}

export function formatModelLabel(id: string): string {
  const raw = id.trim();
  if (!raw) return raw;
  const s = raw.replace(/^claude[-_]?/i, "");
  const m = s.match(/^(opus|sonnet|haiku)[-_]?(\d+)(?:[-_]?(\d+))?/i);
  const kind = m?.[1];
  const major = m?.[2];
  if (!kind || !major) return raw;
  const name = kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
  const minor = m?.[3];
  return minor ? `${name} ${major}.${minor}` : `${name} ${major}`;
}

export function contextTokens(usage: Usage | null | undefined): number {
  if (!usage) return 0;
  return usage.inputTokens + (usage.cacheRead ?? 0);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function effectFromMeta(o: Record<string, unknown>, sessionId?: string): JsonLineEffect | null {
  const model =
    (typeof o.model === "string" && o.model) ||
    (typeof asRecord(o.message)?.model === "string" && (asRecord(o.message)?.model as string)) ||
    undefined;
  const rateLimits = parseRateLimits(o);
  const cwObj = asRecord(o.context_window) ?? asRecord(o.contextWindow);
  const contextWindow =
    num(o.context_window) ??
    num(o.contextWindow) ??
    num(cwObj?.context_window_size) ??
    num(cwObj?.size);
  const usage = parseUsage(o);
  const effect: JsonLineEffect = {};
  if (model) effect.model = model;
  if (rateLimits) effect.rateLimits = rateLimits;
  if (contextWindow) effect.contextWindow = contextWindow;
  if (usage) {
    effect.usage = usage;
    effect.turnUsage = usage;
  }
  if (sessionId) effect.sessionId = sessionId;
  return Object.keys(effect).length ? effect : null;
}

function effectFromTool(hit: ToolHit, sessionId?: string): JsonLineEffect {
  const nested = nestedFromTool(hit);
  return {
    tool: hit.name,
    toolId: hit.id,
    file: hit.file,
    url: hit.url,
    parentId: hit.parentId,
    nested,
    sessionId,
  };
}

function assignTool(effect: JsonLineEffect, hit: ToolHit, sessionId?: string): void {
  const fromTool = effectFromTool(hit, sessionId);
  effect.tool = fromTool.tool;
  effect.toolId = fromTool.toolId;
  effect.url = fromTool.url;
  effect.file = fromTool.file;
  effect.parentId = fromTool.parentId;
  effect.nested = fromTool.nested;
}

function effectFromCodexItem(
  item: Record<string, unknown> | null,
  sessionId: string | undefined,
  completed: boolean,
): JsonLineEffect | null {
  if (!item) return sessionId ? { sessionId } : null;
  const kind = typeof item.type === "string" ? item.type : "";
  if (kind === "agent_message" || kind === "message") {
    const text = typeof item.text === "string" ? item.text : textFromContent(item.content);
    if (!text) return sessionId ? { sessionId } : null;
    return { assistantText: text, replaceAssistant: true, sessionId };
  }
  if (kind === "reasoning") {
    const think =
      (typeof item.text === "string" && item.text) || thinkingFromUnknown(item) || thinkingFromContent(item.summary);
    return think ? { thinking: think, sessionId } : sessionId ? { sessionId } : null;
  }
  if (
    kind === "command_execution" ||
    kind === "mcp_tool_call" ||
    kind === "file_change" ||
    kind === "web_search" ||
    kind === "todo_list"
  ) {
    const name =
      (typeof item.command === "string" && item.command) ||
      (typeof item.name === "string" && item.name) ||
      (typeof item.tool === "string" && item.tool) ||
      kind;
    const id = typeof item.id === "string" ? item.id : name;
    const file = fileFromUnknown(item) ?? (typeof item.path === "string" ? item.path : undefined);
    if (completed) {
      return { tool: name, toolId: id, toolDone: id, file, sessionId };
    }
    return { tool: name, toolId: id, file, sessionId };
  }
  return sessionId ? { sessionId } : null;
}

export function interpretJsonLine(line: string): JsonLineEffect | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const o = asRecord(parsed);
  if (!o) return null;
  return interpretJsonObject(o, 0);
}

function interpretJsonObject(o: Record<string, unknown>, depth: number): JsonLineEffect | null {
  const sessionId =
    (typeof o.session_id === "string" && o.session_id) ||
    (typeof o.thread_id === "string" && o.thread_id) ||
    (typeof asRecord(o.message)?.session_id === "string" && (asRecord(o.message)?.session_id as string)) ||
    undefined;

  const type = typeof o.type === "string" ? o.type : "";
  const message = asRecord(o.message);
  const delta = asRecord(o.delta);
  const block = asRecord(o.content_block);

  if (type === "stream_event" && depth < 4) {
    const ev = asRecord(o.event);
    if (ev) {
      if (typeof ev.session_id !== "string" && sessionId) ev.session_id = sessionId;
      const inner = interpretJsonObject(ev, depth + 1);
      if (inner) return inner;
    }
  }

  if (type === "system" || type === "rate_limit_event" || o.rate_limits || o.rate_limit_info) {
    return effectFromMeta(o, sessionId);
  }

  if (type === "thread.started") {
    return sessionId ? { sessionId } : null;
  }

  if (type === "item.started" || type === "item.updated" || type === "item.completed") {
    return effectFromCodexItem(asRecord(o.item), sessionId, type === "item.completed");
  }

  if (type === "turn.completed") {
    const usage = parseUsage(o.usage) ?? parseUsage(o);
    return { usage, turnUsage: usage, turnDone: true, sessionId };
  }

  if (type === "content_block_delta" && delta) {
    const think = thinkingFromUnknown(delta);
    if (think) return { thinking: think, sessionId };
    if (typeof delta.text === "string") {
      return { assistantText: delta.text, replaceAssistant: false, sessionId };
    }
  }

  if (type === "content_block_start" && block) {
    if (block.type === "thinking" || block.type === "reasoning") {
      const think = thinkingFromUnknown(block);
      if (think) return { thinking: think, sessionId };
      return sessionId ? { sessionId } : null;
    }
    const hit = toolFromBlock(block);
    if (hit) return effectFromTool(hit, sessionId);
  }

  if (type === "thinking" || type === "reasoning") {
    const think = thinkingFromUnknown(o) || (typeof o.text === "string" ? o.text : "");
    return think ? { thinking: think, sessionId } : sessionId ? { sessionId } : null;
  }

  if (type === "assistant" || type === "stream_event") {
    const content = message?.content ?? o.content;
    const fromBlocks = textFromContent(content);
    const text = typeof o.text === "string" ? o.text : fromBlocks;
    const think = thinkingFromContent(content);
    const hits = toolsFromContent(content);
    const effect: JsonLineEffect = {};
    if (think) effect.thinking = think;
    if (text) {
      effect.assistantText = text;
      effect.replaceAssistant = type === "assistant";
    }
    if (hits.length) {
      assignTool(effect, hits[0]!, sessionId);
      if (hits.length > 1) effect.moreTools = hits.slice(1).map((h) => effectFromTool(h, sessionId));
    }
    if (typeof o.model === "string") effect.model = o.model;
    if (sessionId) effect.sessionId = sessionId;
    return Object.keys(effect).length ? effect : null;
  }

  if (type === "tool_use" || type === "tool") {
    const name = typeof o.name === "string" ? o.name : "tool";
    const input = asRecord(o.input);
    return effectFromTool(
      {
        name,
        id: typeof o.id === "string" ? o.id : undefined,
        url: typeof o.url === "string" ? o.url : undefined,
        file: fileFromUnknown(input) ?? fileFromUnknown(o),
        parentId: parentIdFrom(o) ?? parentIdFrom(input),
        input,
      },
      sessionId,
    );
  }

  const resultId =
    (type === "tool_result" && typeof o.tool_use_id === "string" && o.tool_use_id) ||
    toolResultId(message?.content ?? o.content) ||
    (typeof o.tool_use_id === "string" ? o.tool_use_id : undefined);
  if (resultId && (type === "tool_result" || type === "user" || type === "message")) {
    return {
      sessionId,
      toolDone: resultId,
      nested: { id: resultId, title: "", kind: "Task", status: "done" },
    };
  }

  if (type === "message_delta") {
    const usage = parseUsage(delta) ?? parseUsage(o);
    if (!usage && !sessionId) return null;
    return { usage, turnUsage: usage, sessionId };
  }

  if (type === "result" || type === "usage" || o.usage) {
    const usage = parseUsage(o);
    const model = typeof o.model === "string" ? o.model : usage?.model;
    const rateLimits = parseRateLimits(o);
    const contextWindow = usage?.contextWindow;
    if (!usage && !model && !sessionId && !rateLimits && !contextWindow) return null;
    return {
      usage,
      turnUsage: usage,
      turnDone: type === "result",
      model,
      sessionId,
      rateLimits,
      contextWindow,
    };
  }

  if (typeof o.text === "string" && (type === "text" || type === "message")) {
    const role = o.role === "user" ? "user" : "assistant";
    if (role === "user") return sessionId ? { sessionId } : null;
    return { assistantText: o.text, replaceAssistant: true, sessionId };
  }

  return sessionId ? { sessionId } : null;
}

export function applyNestedAgent(list: NestedAgent[], ev: NestedAgent): NestedAgent[] {
  const i = list.findIndex((x) => x.id === ev.id);
  if (i >= 0) {
    const cur = list[i]!;
    const next = [...list];
    next[i] = {
      ...cur,
      status: ev.status,
      kind: ev.kind || cur.kind,
      title: ev.title || cur.title,
    };
    return next;
  }
  if (ev.status === "done") return list;
  return [...list, ev].slice(-20);
}

export function applyNestedFromEffect(list: NestedAgent[], effect: JsonLineEffect): NestedAgent[] {
  let next = list;
  if (effect.nested) next = applyNestedAgent(next, effect.nested);
  for (const extra of effect.moreTools ?? []) {
    if (extra.nested) next = applyNestedAgent(next, extra.nested);
  }
  if (effect.turnDone) {
    next = next.map((n) => (n.status === "running" ? { ...n, status: "done" } : n));
  }
  return next;
}

export function applyJsonEffect(
  messages: ChatMessage[],
  effect: JsonLineEffect,
  nextId: () => string,
): ChatMessage[] {
  let next = messages;
  for (const hit of toolHits(effect)) {
    next = [
      ...next,
      {
        id: hit.toolId || nextId(),
        role: "tool",
        text: hit.url ? `${hit.tool} ${hit.url}` : hit.file ? `${hit.tool} ${hit.file}` : hit.tool ?? "",
        toolId: hit.toolId,
      },
    ];
  }
  if (effect.assistantText) {
    const last = next[next.length - 1];
    if (!effect.replaceAssistant && last?.role === "assistant") {
      return next.map((m, i) =>
        i === next.length - 1 ? { ...m, text: m.text + effect.assistantText } : m,
      );
    }
    return [...next, { id: nextId(), role: "assistant", text: effect.assistantText }];
  }
  return next;
}

export function emptyTurn(id: string, user: string, startedAt: number): ChatTurn {
  return {
    id,
    user,
    thinking: "",
    tools: [],
    assistant: "",
    usage: null,
    startedAt,
    endedAt: null,
  };
}

export function newTurnId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function asToolRun(raw: unknown): ToolRun | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<ToolRun>;
  if (typeof t.id !== "string" || typeof t.name !== "string") return null;
  return {
    id: t.id,
    name: t.name,
    detail: typeof t.detail === "string" ? t.detail : "",
    status: t.status === "done" ? "done" : "running",
    parentId: typeof t.parentId === "string" ? t.parentId : undefined,
  };
}

/** Normalize turns loaded from SQLite so a missing `tools` array cannot break the transcript. */
export function hydrateTurns(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const t = row as Partial<ChatTurn>;
    if (typeof t.id !== "string" || !t.id) continue;
    const startedAt = typeof t.startedAt === "number" ? t.startedAt : 0;
    const origin = t.origin === "system" || t.origin === "user" ? t.origin : undefined;
    out.push({
      ...emptyTurn(t.id, typeof t.user === "string" ? t.user : "", startedAt),
      thinking: typeof t.thinking === "string" ? t.thinking : "",
      tools: Array.isArray(t.tools) ? t.tools.flatMap((x) => asToolRun(x) ?? []) : [],
      assistant: typeof t.assistant === "string" ? t.assistant : "",
      usage: t.usage ?? null,
      endedAt: typeof t.endedAt === "number" ? t.endedAt : t.endedAt === null ? null : startedAt,
      origin,
    });
  }
  return out;
}

function toolHits(effect: JsonLineEffect): JsonLineEffect[] {
  const rest = effect.moreTools ?? [];
  if (effect.tool) return [{ ...effect, moreTools: undefined }, ...rest];
  return rest;
}

function upsertTool(turn: ChatTurn, effect: JsonLineEffect): ChatTurn {
  if (!effect.tool) return turn;
  const id = effect.toolId || effect.tool;
  const i = turn.tools.findIndex((t) => t.id === id);
  const prev = i >= 0 ? turn.tools[i] : undefined;
  const detail = effect.file || effect.url || effect.nested?.title || prev?.detail || "";
  const row: ToolRun = {
    id,
    name: effect.tool,
    detail,
    status: "running",
    parentId: effect.parentId ?? prev?.parentId,
  };
  return {
    ...turn,
    tools: i >= 0 ? turn.tools.map((t, n) => (n === i ? { ...t, ...row } : t)) : [...turn.tools, row],
  };
}

export function applyTurnEffect(turn: ChatTurn, effect: JsonLineEffect, now: number): ChatTurn {
  let next: ChatTurn = { ...turn, tools: turn.tools };
  if (effect.thinking) next = { ...next, thinking: next.thinking + effect.thinking };
  for (const hit of toolHits(effect)) next = upsertTool(next, hit);
  if (effect.toolDone) {
    next = {
      ...next,
      tools: next.tools.map((t) => (t.id === effect.toolDone ? { ...t, status: "done" } : t)),
    };
  }
  if (effect.assistantText) {
    next = {
      ...next,
      assistant: effect.replaceAssistant ? effect.assistantText : next.assistant + effect.assistantText,
    };
  }
  if (effect.turnUsage) next = { ...next, usage: effect.turnUsage };
  if (effect.turnDone) {
    next = {
      ...next,
      endedAt: now,
      tools: next.tools.map((t) => (t.status === "running" ? { ...t, status: "done" } : t)),
    };
  }
  return next;
}

export function applyTurns(turns: ChatTurn[], effect: JsonLineEffect, now: number, nextId: () => string): ChatTurn[] {
  const last = turns[turns.length - 1];
  const content =
    Boolean(effect.thinking) ||
    Boolean(effect.tool) ||
    Boolean(effect.moreTools?.length) ||
    Boolean(effect.assistantText);
  const touches =
    content || Boolean(effect.toolDone) || Boolean(effect.turnUsage) || Boolean(effect.turnDone);
  if (!touches) return turns;
  if (!last || last.endedAt != null) {
    if (!content) return turns;
    return [...turns, applyTurnEffect(emptyTurn(nextId(), "", now), effect, now)];
  }
  return turns.map((t, i) => (i === turns.length - 1 ? applyTurnEffect(t, effect, now) : t));
}

export function finishOpenWork<T extends { turns: ChatTurn[]; nested: NestedAgent[] }>(session: T, now: number): T {
  return {
    ...session,
    nested: session.nested.map((n) => (n.status === "running" ? { ...n, status: "done" } : n)),
    turns: session.turns.map((t) =>
      t.endedAt == null
        ? {
            ...t,
            endedAt: now,
            tools: t.tools.map((tool) => (tool.status === "running" ? { ...tool, status: "done" } : tool)),
          }
        : t,
    ),
  };
}

export function sessionBelongsToAgent(
  session: { id: string; catalogId?: string },
  agentId: string,
): boolean {
  return session.id === agentId || session.catalogId === agentId;
}

export function lastText(messages: ChatMessage[], role: ChatRole): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === role && messages[i]!.text.trim()) return messages[i]!.text.trim();
  }
  return undefined;
}

export function currentTaskLabel(nested: NestedAgent[], messages: ChatMessage[]): string {
  const live = [...nested].reverse().find((n) => n.status === "running");
  if (live?.title) return live.title;
  const done = [...nested].reverse().find((n) => n.title);
  if (done?.title) return done.title;
  const user = lastText(messages, "user");
  if (!user) return "";
  const t = user.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

export function mergeFile(files: string[], path: string | undefined): string[] {
  if (!path) return files;
  const n = path.replace(/\\/g, "/");
  if (files.includes(n)) return files;
  return [...files, n].slice(-40);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

export function turnTokenCount(usage: Usage | null | undefined): number {
  if (!usage) return 0;
  return usage.inputTokens + usage.outputTokens + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = (ms % 60_000) / 1000;
  return `${m}m ${s.toFixed(1)}s`;
}

export function contextUsed(usage: Usage | null, window: number | undefined): number | null {
  if (!usage) return null;
  const used = usage.inputTokens + (usage.cacheRead ?? 0);
  if (window && window > 0) return Math.min(100, Math.round((used / window) * 100));
  return null;
}

/** A closed pane can always spawn the TUI again in that cwd. Vendor /resume lives in the CLI. */
export function canResumeProcess(_provider: string, _resumeId?: string | null): boolean {
  return true;
}

/** Swap a live pane in place so React does not unmount to the empty state. */
export function replaceLiveAgent<T extends { id: string; catalogId?: string }>(list: T[], next: T): T[] {
  const catalogId = next.catalogId || next.id;
  const idx = list.findIndex((s) => s.catalogId === catalogId || s.id === catalogId || s.id === next.id);
  if (idx === -1) return [...list, next];
  const copy = list.slice();
  copy[idx] = next;
  return copy;
}

export type AgentPulse = "idle" | "run" | "warn" | "error";

export function agentPulse(opts: {
  status: "running" | "exit";
  exitCode?: number;
  liveTurn?: boolean;
  nestedRunning?: boolean;
  pendingAsk?: boolean;
  warned?: boolean;
}): AgentPulse {
  if (opts.status === "exit" && (opts.exitCode ?? 0) !== 0) return "error";
  if (opts.status !== "running") return "idle";
  if (opts.pendingAsk || opts.warned) return "warn";
  if (opts.liveTurn || opts.nestedRunning) return "run";
  return "idle";
}

export function siblingStamp(
  provider: string,
  groupId: string,
  agentId: string,
  name: string,
  at = new Date(),
): string {
  return `|${provider}|${groupId}|${agentId}|${name}|${at.toISOString()}|`;
}

export function sessionContext(goal?: string | null, brief?: string | null): string {
  const parts: string[] = [];
  const g = goal?.trim();
  const b = brief?.trim();
  if (g) parts.push(`Session goal: ${g}`);
  if (b) parts.push(b);
  return parts.join("\n\n");
}

export function claudeSiblingRoster(agents: { id: string; name: string }[]): string {
  if (agents.length === 0) return "";
  const lines = agents.map((a) => `- id=${a.id} name=${a.name}`);
  return [
    "Sibling agents in this session group (you cannot message them; the user may forward text):",
    ...lines,
  ].join("\n");
}

export function exportTranscriptMd(
  title: string,
  cwd: string,
  agents: { name: string; provider: string; turns: ChatTurn[]; messages: ChatMessage[] }[],
): string {
  const parts = [`# ${title}`, "", `\`${cwd}\``, ""];
  for (const agent of agents) {
    parts.push(`## ${agent.name} (${agent.provider})`, "");
    if (agent.turns.length) {
      for (const turn of agent.turns) {
        if (turn.user) {
          parts.push("**user**", "", turn.user, "");
        }
        if (turn.thinking) {
          parts.push("**thinking**", "", turn.thinking, "");
        }
        for (const tool of turn.tools) {
          parts.push(`**tool** ${tool.name}${tool.detail ? ` ${tool.detail}` : ""}`, "");
        }
        if (turn.assistant) {
          parts.push("**assistant**", "", turn.assistant, "");
        }
      }
    } else {
      for (const m of agent.messages) {
        parts.push(`**${m.role}**`, "", m.text, "");
      }
    }
  }
  return parts.join("\n").trim() + "\n";
}
