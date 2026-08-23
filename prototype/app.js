/* Design prototype only — no Tauri invoke, no real CLI, no ControlPlane. */

const WORKSPACE = "~/Workplace/Projects/CentralByte/vhosts/CentralByte";
const MAX_SESSIONS = 3;

const PROVIDERS = [
  {
    id: "claude",
    name: "Claude",
    binary: "claude",
    detected: true,
    statusLine: { model: "Sonnet 4.6", window: 200000, base: 42000, perMsg: 2200, kind: "claude" },
    commands: [
      { cmd: "/help", desc: "Mostrar ajuda do Claude Code" },
      { cmd: "/clear", desc: "Limpar a conversa" },
      { cmd: "/compact", desc: "Compactar o contexto" },
      { cmd: "/model", desc: "Trocar o modelo" },
      { cmd: "/permissions", desc: "Permissões de ferramentas" },
      { cmd: "/mcp", desc: "Servidores MCP do vendor" },
      { cmd: "/memory", desc: "Editar memória" },
      { cmd: "/cost", desc: "Custo da sessão" },
      { cmd: "/doctor", desc: "Diagnosticar o CLI" },
      { cmd: "/review", desc: "Revisar alterações" },
      { cmd: "/init", desc: "Inicializar CLAUDE.md" },
      { cmd: "/vim", desc: "Modo vim" },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    binary: "codex",
    detected: true,
    statusLine: { model: "gpt-5", window: 272000, base: 28000, perMsg: 1900, kind: "codex" },
    commands: [
      { cmd: "/status", desc: "Estado da sessão Codex" },
      { cmd: "/model", desc: "Escolher modelo" },
      { cmd: "/approvals", desc: "Política de aprovação" },
      { cmd: "/review", desc: "Revisar o diff" },
      { cmd: "/compact", desc: "Compactar contexto" },
      { cmd: "/diff", desc: "Mostrar diff" },
      { cmd: "/new", desc: "Nova conversa" },
      { cmd: "/undo", desc: "Desfazer último passo" },
      { cmd: "/exit", desc: "Encerrar o CLI" },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    binary: "cursor",
    detected: true,
    statusLine: { model: "Auto", window: 200000, base: 31000, perMsg: 1600, kind: "cursor" },
    commands: [
      { cmd: "/edit", desc: "Editar o ficheiro focado" },
      { cmd: "/ask", desc: "Perguntar sem editar" },
      { cmd: "/fix", desc: "Corrigir o problema" },
      { cmd: "/explain", desc: "Explicar o código" },
      { cmd: "/tests", desc: "Gerar ou correr testes" },
      { cmd: "/doc", desc: "Documentar a seleção" },
      { cmd: "/commit", desc: "Mensagem de commit" },
      { cmd: "/review", desc: "Rever o diff local" },
      { cmd: "/generate", desc: "Gerar a partir do contexto" },
    ],
  },
  {
    id: "fixture",
    name: "Fixture",
    binary: "fixture",
    detected: true,
    statusLine: { model: "fixture", window: 32000, base: 1200, perMsg: 400, kind: "fixture" },
    commands: [
      { cmd: "/echo", desc: "Ecoar o stdin (harness)" },
      { cmd: "/help", desc: "Ajuda do fixture" },
      { cmd: "/clear", desc: "Limpar buffer" },
      { cmd: "/json", desc: "Emitir linha JSON" },
      { cmd: "/pty", desc: "Simular frame PTY" },
    ],
  },
];

const ICONS = {
  agents: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 2.5-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.2"/><path d="M21 19c0-2.2-1.6-3.8-4-4.2"/></svg>',
  sessions: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h12v8H8l-3 3V6Z"/><path d="M9 4h11v9"/></svg>',
  files: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h6l2 2h8v10H4V7Z"/></svg>',
  mcp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10v4M16 10v4M7 8h3v8H7l-2-4 2-4Zm10 0h-3v8h3l2-4-2-4Z"/></svg>',
  canvas: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M10 10v9"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1"/><path d="m8 10 3 2-3 2M13 14h4"/></svg>',
  browser: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a12 12 0 0 1 0 16 12 12 0 0 1 0-16"/></svg>',
};

const ACTIVITY_CORE = [
  { id: "agents", kind: "rail", rail: "agents", label: "Agents" },
  { id: "sessions", kind: "rail", rail: "sessions", label: "Sessões", badge: true },
];

const SIDEBAR_TOOLS = [
  { id: "files", kind: "rail", rail: "files", label: "Arquivos" },
  { id: "mcp", kind: "rail", rail: "mcp", label: "MCP" },
];

const PLUS_ONLY_TOOLS = [
  { id: "browser", kind: "tool", tool: "browser", label: "Navegador" },
  { id: "canvas", kind: "tool", tool: "canvas", label: "Canvas" },
  { id: "terminal", kind: "tool", tool: "terminal", label: "Terminal" },
];

function findTool(id) {
  return SIDEBAR_TOOLS.find((t) => t.id === id) || PLUS_ONLY_TOOLS.find((t) => t.id === id);
}

function loadPins() {
  try {
    const raw = JSON.parse(localStorage.getItem("cc-proto-pins") || "null");
    if (Array.isArray(raw)) {
      const next = raw.filter((id) => SIDEBAR_TOOLS.some((t) => t.id === id));
      if (next.length) return next;
    }
  } catch (_) { /* ignore */ }
  return SIDEBAR_TOOLS.map((t) => t.id);
}

const FILE_TREE = [
  { name: "src", dir: true, children: [
    { name: "App.tsx" },
    { name: "App.css" },
    { name: "PtyTerm.tsx" },
    { name: "lib/commands.ts" },
  ]},
  { name: "docs", dir: true, children: [
    { name: "architecture.md", canvas: "arch" },
    { name: "adr/ADR-001-pty-skin.md", canvas: "adr" },
  ]},
  { name: "prototype", dir: true, children: [
    { name: "index.html" },
  ]},
  { name: "AGENTS.md" },
  { name: "README.md", canvas: "readme" },
];

const CANVAS_DOCS = {
  arch: {
    title: "architecture.md",
    html: `<h1>Arquitetura</h1>
      <p>React (chrome) → comandos Tauri → runtime Rust → Provider → processo do vendor.</p>
      <p>A sessão é o centro. Arquivos, canvas, terminal e browser são ferramentas.</p>`,
  },
  adr: {
    title: "ADR-001 — Pele sobre o CLI verdadeiro",
    html: `<h1>ADR-001</h1>
      <p>A app é uma pele: detecta o binário, lança-o no cwd do workspace, mostra stdout e devolve input.</p>
      <p>JsonStream vira bolhas; InteractivePty é o TUI real. Sem backend TEAM.</p>`,
  },
  readme: {
    title: "README.md",
    html: `<h1>CentralByte</h1>
      <p>Pele Tauri 2 sobre CLIs reais. Sem o binário do vendor, use o provider <code>fixture</code>.</p>`,
  },
};

const PAGES = {
  "http://localhost:5173": {
    title: "Vite · centralbyte",
    body: `<div class="card"><strong>Shell React</strong><p class="muted">Prévia localhost do app Tauri (stub). Rail Agents / Sessions / Files.</p></div>`,
  },
  "http://localhost:5173/docs": {
    title: "Docs do desktop",
    body: `<div class="card"><strong>architecture.md</strong><p>Camadas: chrome → IPC → runtime → CLI.</p></div>
           <div class="card"><strong>ADR-001</strong><p>Pele sobre o CLI verdadeiro.</p></div>`,
  },
  "https://docs.local/architecture": {
    title: "docs.local / architecture",
    body: `<div class="card"><p>Documento estático servido como prévia. Sem fetch real.</p></div>`,
  },
};

const state = {
  theme: localStorage.getItem("cc-proto-theme") || "dark",
  rail: "agents",
  rightTool: null,
  bottomOpen: false,
  sessions: [],
  activeId: null,
  slash: { open: false, filter: "", index: 0, sessionId: null },
  browser: {
    url: "http://localhost:5173",
    steps: [],
    pendingUrl: null,
    pendingSessionId: null,
  },
  canvas: "arch",
  mcp: [],
  termLines: ["lucas@desktop:" + WORKSPACE + "$ ls", "src  src-tauri  docs  prototype  AGENTS.md  README.md"],
  termDraft: "",
  toast: null,
  agentForm: {
    open: false,
    providerId: "claude",
    name: "Claude",
    cwd: WORKSPACE,
    model: "",
    systemPrompt: "",
  },
  pins: loadPins(),
  plusOpen: false,
};

let uid = 0;
function nextId(prefix) {
  uid += 1;
  return prefix + uid;
}

function providerById(id) {
  return PROVIDERS.find((p) => p.id === id);
}

function sessionById(id) {
  return state.sessions.find((s) => s.id === id);
}

function activeSession() {
  return sessionById(state.activeId) || state.sessions[0] || null;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nowClock() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function contextUsage(session) {
  const p = providerById(session.providerId);
  const spec = p?.statusLine || { model: p?.name || "?", window: 200000, base: 8000, perMsg: 1200, kind: "generic" };
  const msgs = session.messages?.length || 0;
  const promptExtra = session.systemPrompt ? 900 : 0;
  const used = Math.min(spec.window, spec.base + promptExtra + msgs * spec.perMsg);
  const pct = Math.round((used / spec.window) * 100);
  const model = session.model || spec.model;
  const filled = Math.round((pct / 100) * 10);
  const bar = "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, 10 - filled));
  const tone = pct >= 80 ? "hot" : pct >= 60 ? "warn" : "ok";
  const cost = ((used / 1000) * 0.003).toFixed(2);
  return { spec, used, pct, model, bar, tone, window: spec.window, cost };
}

function renderStatusLine(session) {
  const u = contextUsage(session);
  const kind = u.spec.kind;
  let detail = `${fmtTokens(u.used)}/${fmtTokens(u.window)}`;
  if (kind === "claude") detail += `  ·  $${u.cost}`;
  if (kind === "codex") detail += "  ·  /status";
  if (kind === "cursor") detail += "  ·  Composer";
  if (kind === "fixture") detail += "  ·  json+pty";
  return `<div class="status-line" title="Stub: no produto isto vem da status-line do CLI ${esc(session.name)}">
    <span class="sl-model">${esc(u.model)}</span>
    <span class="sl-bar ${u.tone}" aria-hidden="true">${u.bar}</span>
    <span class="sl-pct ${u.tone}">${u.pct}%</span>
    <span class="sl-detail">${detail}</span>
  </div>`;
}
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ptyWelcome(p, cwd) {
  const folder = (cwd || WORKSPACE).split("/").pop();
  const path = cwd || WORKSPACE;
  if (p.id === "claude") {
    return `<span class="dim">╭──────────────────────────────────────╮</span>
<span class="ok">│  Claude Code</span>  ·  ${esc(folder)}     <span class="dim">│</span>
<span class="dim">╰──────────────────────────────────────╯</span>

<span class="dim">cwd</span>  ${esc(path)}

<span class="cyan">❯</span> `;
  }
  if (p.id === "codex") {
    return `<span class="ok">codex</span>  ●  gpt-5
<span class="dim">workdir</span>  ${esc(path)}

<span class="cyan">›</span> `;
  }
  if (p.id === "cursor") {
    return `<span class="ok">Cursor Agent</span>  ·  Agent
<span class="dim">/ para comandos deste provider</span>

<span class="cyan">></span> `;
  }
  return `<span class="ok">fixture</span>  json+pty harness
<span class="dim">session ready · ${esc(path)}</span>

<span class="cyan">$</span> `;
}

function openAgentForm() {
  const p = providerById(state.agentForm.providerId) || PROVIDERS.find((x) => x.detected) || PROVIDERS[0];
  state.agentForm.open = true;
  state.agentForm.providerId = p.id;
  state.agentForm.name = p.name;
  if (!state.agentForm.cwd) state.agentForm.cwd = WORKSPACE;
  state.agentForm.model = "";
  state.agentForm.systemPrompt = "";
  render();
}

function closeAgentForm() {
  state.agentForm.open = false;
  render();
}

function startSession(opts) {
  if (state.sessions.length >= MAX_SESSIONS) {
    showToast("Máximo de 3 sessões lado a lado neste protótipo.");
    return;
  }
  const providerId = typeof opts === "string" ? opts : opts?.providerId;
  const p = providerById(providerId);
  if (!p) return;
  if (!p.detected) {
    showToast(`${p.name} não está detectado neste protótipo.`);
    return;
  }
  const name = (typeof opts === "object" && opts.name?.trim()) || p.name;
  const cwd = (typeof opts === "object" && opts.cwd?.trim()) || WORKSPACE;
  const systemPrompt = (typeof opts === "object" && opts.systemPrompt?.trim()) || "";
  const model = (typeof opts === "object" && opts.model?.trim()) || "";
  const id = nextId("s");
  const session = {
    id,
    providerId: p.id,
    name,
    cwd,
    model,
    systemPrompt,
    status: "running",
    view: "bubbles",
    showTrace: false,
    draft: "",
    messages: [
      {
        role: "assistant",
        text: `${name} (${p.binary}) em ${cwd}. A sessão é o centro — arquivos, canvas, terminal e browser ficam nas ferramentas.`,
      },
      ...(systemPrompt
        ? [{ role: "tool", text: `System prompt: ${systemPrompt}` }]
        : []),
      {
        role: "tool",
        kind: "browser-offer",
        text: "Posso abrir o browser para pré-visualizar o app em localhost ou a documentação.",
      },
    ],
    pty: ptyWelcome(p, cwd),
    trace: `[json] {"type":"system","subtype":"init","provider":"${p.id}","session_id":"${id}","cwd":"${cwd}"}\n[stdout] spawn ${p.binary} cwd=${cwd}\n`,
  };
  state.sessions.push(session);
  state.activeId = id;
  state.agentForm.open = false;
  render();
}

function closeSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  if (state.activeId === id) {
    state.activeId = state.sessions[0]?.id || null;
  }
  render();
}

function appendTrace(session, line) {
  session.trace += line + "\n";
}

function sendMessage(session, text) {
  const raw = text.trim();
  if (!raw) return;
  session.draft = "";
  session.messages.push({ role: "user", text: raw });
  session.pty += `${esc(raw)}\n`;
  appendTrace(session, `[stdin] ${raw}`);

  if (raw.startsWith("/")) {
    handleSlash(session, raw);
  } else if (/browser|localhost|docs|abrir|abra|preview/i.test(raw)) {
    session.messages.push({
      role: "assistant",
      text: "Vou pedir permissão para abrir o browser na URL pedida.",
    });
    requestBrowserPermission(session, guessUrl(raw));
  } else {
    session.messages.push({
      role: "assistant",
      text: fakeReply(session, raw),
    });
    appendTrace(session, `[json] {"type":"assistant","text":"…"}`);
    session.pty += `<span class="cyan">${esc(fakeReply(session, raw))}</span>\n<span class="cyan">❯</span> `;
  }
  render();
}

function guessUrl(text) {
  const m = text.match(/https?:\/\/\S+/);
  if (m) return m[0];
  if (/docs/i.test(text)) return "http://localhost:5173/docs";
  return "http://localhost:5173";
}

function fakeReply(session, raw) {
  return `Recebi: “${raw}”. Neste protótipo a resposta é simulada — o produto real intercepta stdin/stdout do CLI ${session.name}.`;
}

function handleSlash(session, raw) {
  const token = raw.split(/\s+/)[0];
  const p = providerById(session.providerId);
  const known = p.commands.some((c) => c.cmd === token);
  const text = known
    ? `Comando ${token} do ${p.name} (vocabulário deste provider). Stub: o CLI real executaria isto.`
    : `${token} não faz parte da paleta de ${p.name}. Digite / para ver os comandos deste agente.`;
  session.messages.push({ role: "assistant", text });
  appendTrace(session, `[json] {"type":"slash","cmd":"${token}","provider":"${p.id}"}`);
  session.pty += `<span class="dim">${esc(text)}</span>\n<span class="cyan">❯</span> `;
}

function requestBrowserPermission(session, url) {
  state.browser.pendingUrl = url;
  state.browser.pendingSessionId = session.id;
  render();
}

function allowBrowser() {
  const url = state.browser.pendingUrl || "http://localhost:5173";
  const sid = state.browser.pendingSessionId;
  state.browser.pendingUrl = null;
  state.browser.pendingSessionId = null;
  state.rightTool = "browser";
  state.browser.url = url;
  const session = sessionById(sid);
  if (session) {
    session.messages.push({ role: "tool", text: `Permissão concedida · ${url}` });
    appendTrace(session, `[tool] browser.navigate ${url} allowed`);
  }
  playAiSteps(url);
  render();
}

function denyBrowser() {
  const sid = state.browser.pendingSessionId;
  state.browser.pendingUrl = null;
  state.browser.pendingSessionId = null;
  const session = sessionById(sid);
  if (session) {
    session.messages.push({ role: "tool", text: "Permissão negada — o browser não abriu." });
    appendTrace(session, `[tool] browser.navigate denied`);
  }
  render();
}

function playAiSteps(url) {
  const seq = [
    `abrindo ${url}`,
    "aguardando localhost (stub)",
    "página carregada",
    url.includes("docs") ? "clicando em Arquitetura" : "inspecionando o shell",
    url.includes("docs") ? "lendo ADR-001" : "lendo App.tsx na prévia",
  ];
  state.browser.steps = [];
  seq.forEach((label, i) => {
    window.setTimeout(() => {
      state.browser.steps.push({ t: nowClock(), label, live: i === seq.length - 1 });
      if (i > 0) state.browser.steps[i - 1].live = false;
      renderTool();
      renderStatus();
    }, 450 * (i + 1));
  });
}

function isPinned(id) {
  return state.pins.includes(id);
}

function savePins() {
  localStorage.setItem("cc-proto-pins", JSON.stringify(state.pins));
}

function unpinTool(id) {
  state.pins = state.pins.filter((x) => x !== id);
  savePins();
  const spec = findTool(id);
  if (spec?.kind === "rail" && state.rail === spec.rail) state.rail = "agents";
  if (spec?.kind === "tool" && spec.tool === "terminal") state.bottomOpen = false;
  if (spec?.kind === "tool" && state.rightTool === spec.tool) state.rightTool = null;
}

function pinTool(id) {
  if (!isPinned(id)) state.pins.push(id);
  savePins();
}

function openFromPlus(id) {
  if (id === "agent") {
    state.plusOpen = false;
    openAgentForm();
    return;
  }
  const spec = findTool(id);
  if (!spec) return;
  if (spec.kind === "rail") state.rail = spec.rail;
  else if (spec.tool === "terminal") state.bottomOpen = true;
  else state.rightTool = spec.tool;
  state.plusOpen = false;
  render();
}

function actButton(item) {
  const onRail = item.kind === "rail" && state.rail === item.rail;
  const onTool = item.kind === "tool" && (item.tool === "terminal" ? state.bottomOpen : state.rightTool === item.tool);
  const cls = `act${onRail || onTool ? " active" : ""}${onTool ? " tool-on" : ""}${item.id === "mcp" ? " dim" : ""}`;
  const act = item.kind === "rail"
    ? `data-act="rail" data-rail="${item.rail}"`
    : `data-act="tool" data-tool="${item.tool}"`;
  const badge = item.badge
    ? `<span class="badge" id="session-badge" ${state.sessions.length ? "" : "hidden"}>${state.sessions.length}</span>`
    : "";
  return `<button type="button" class="${cls}" ${act} title="${esc(item.label)}">${ICONS[item.id]}${badge}</button>`;
}
function showToast(msg) {
  state.toast = msg;
  renderToast();
  window.setTimeout(() => {
    if (state.toast === msg) {
      state.toast = null;
      renderToast();
    }
  }, 2400);
}

function filteredCommands(session) {
  if (!session) return [];
  const p = providerById(session.providerId);
  const q = state.slash.filter.toLowerCase();
  return p.commands.filter((c) => c.cmd.includes(q) || c.desc.toLowerCase().includes(q.replace(/^\//, "")));
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  document.body.dataset.theme = state.theme;
  document.getElementById("app").dataset.theme = state.theme;
  document.getElementById("title-cwd").textContent = WORKSPACE;
  document.getElementById("title-workspace").textContent = WORKSPACE.split("/").pop();
  document.getElementById("theme-btn").textContent = state.theme === "dark" ? "Tema claro" : "Tema escuro";
  document.querySelector(".workspace").classList.toggle("no-tool", !state.rightTool);

  renderActivity();
  renderSidebar();
  renderSessionTabs();
  renderSessions();
  renderBottom();
  renderTool();
  renderStatus();
  renderSlash();
  renderPlusMenu();
  renderPermission();
  renderAgentModal();
  renderToast();
}

function renderActivity() {
  const pinned = SIDEBAR_TOOLS.filter((t) => isPinned(t.id));
  const rails = pinned.filter((t) => t.kind === "rail");
  const tools = pinned.filter((t) => t.kind === "tool");
  document.getElementById("activity").innerHTML = [
    ...ACTIVITY_CORE.map(actButton),
    ...rails.map(actButton),
    tools.length ? '<div class="act-sep"></div>' : "",
    ...tools.map(actButton),
  ].join("");
}

function renderSessionTabs() {
  const el = document.getElementById("session-tabs");
  const tabs = state.sessions.map((s) => `
    <div class="tab ${s.id === state.activeId ? "on" : ""}" role="tab" aria-selected="${s.id === state.activeId}">
      <button type="button" class="tab-hit" data-act="focus-session" data-id="${s.id}">
        <span class="tab-agent">${esc(s.name)}</span>
        <span class="tab-ws">${esc(s.cwd.split("/").pop())}</span>
      </button>
      <button type="button" class="tab-close" data-act="close-session" data-id="${s.id}" title="Fechar sessão">×</button>
    </div>
  `).join("");
  el.innerHTML = `${tabs}
    <button type="button" class="tab-add" id="tab-add" data-act="toggle-plus" title="Ferramentas e agente">+</button>`;
}

function renderPlusMenu(anchor) {
  const box = document.getElementById("plus-menu");
  if (!state.plusOpen) {
    box.hidden = true;
    return;
  }
  const openItems = [
    { id: "files", label: "Arquivos" },
    { id: "browser", label: "Navegador" },
    { id: "canvas", label: "Canvas" },
    { id: "terminal", label: "Terminal" },
    { id: "agent", label: "Adicionar agente" },
  ];
  box.hidden = false;
  box.innerHTML = openItems.map((it) => `
      <button type="button" class="plus-item" data-act="plus-open" data-id="${it.id}">
        ${ICONS[it.id] || ""}<span>${esc(it.label)}</span>
      </button>
    `).join("");
  const el = anchor || document.getElementById("tab-add");
  if (el) {
    const r = el.getBoundingClientRect();
    const width = 280;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + width > window.innerWidth - 12) left = Math.max(12, r.right - width);
    box.style.left = left + "px";
    box.style.top = top + "px";
  }
}

function renderSidebar() {
  const el = document.getElementById("sidebar");
  if (state.rail === "agents") {
    el.innerHTML = `
      <h2>Agents</h2>
      <p class="muted">Adicione um CLI ao workspace. Os que já estão a correr ficam abaixo.</p>
      <button type="button" class="primary add-agent" data-act="open-agent-form">Adicionar agente</button>
      <h3>Em execução</h3>
      ${state.sessions.length === 0
        ? `<p class="muted">Nenhum agente a correr. Use Adicionar agente — a sessão abre ao centro.</p>`
        : state.sessions.map((s) => `
          <button type="button" class="running" data-act="focus-session" data-id="${s.id}" style="width:100%;text-align:left;background:transparent;border:0;color:inherit;">
            <div class="row">
              <strong><span class="dot"></span>${esc(s.name)}</strong>
              <span class="meta">${s.status}</span>
            </div>
            <div class="meta">${esc(s.cwd)}</div>
          </button>
        `).join("")}
    `;
    return;
  }
  if (state.rail === "sessions") {
    el.innerHTML = `
      <h2>Sessões</h2>
      <p class="muted">Várias sessões no mesmo workspace, lado a lado no centro.</p>
      ${state.sessions.length === 0
        ? `<p class="muted">Nenhuma sessão. Use Agents → Adicionar agente.</p>`
        : state.sessions.map((s) => `
          <div class="session-row ${s.id === state.activeId ? "provider" : ""}">
            <div class="row">
              <strong>${esc(s.name)}</strong>
              <button type="button" class="tiny" data-act="close-session" data-id="${s.id}">Fechar</button>
            </div>
            <div class="meta">${s.view === "bubbles" ? "bolhas" : "PTY"} · ${esc(s.id)}</div>
          </div>
        `).join("")}
      <button type="button" class="ghost" data-act="open-agent-form" ${state.sessions.length >= MAX_SESSIONS ? "disabled" : ""}>
        + Sessão
      </button>
    `;
    return;
  }
  if (state.rail === "files") {
    el.innerHTML = `
      <h2>Arquivos</h2>
      <p class="muted">Ferramenta — a sessão continua no centro. Clique num .md para o canvas.</p>
      <div class="meta" style="margin-bottom:8px;">${esc(WORKSPACE)}</div>
      <ul class="tree">${renderTree(FILE_TREE)}</ul>
    `;
    return;
  }
  el.innerHTML = `
    <h2>MCP</h2>
    <p class="muted">Registry básico. Sem inspector de tools/resources nesta fase. O harness que conta é o do CLI.</p>
    ${state.mcp.length === 0
      ? `<p>0 servidores conectados.</p>`
      : state.mcp.map((m) => `
        <div class="mcp-row provider">
          <div class="row">
            <strong>${esc(m.name)}</strong>
            <span class="meta">${m.connected ? "conectado (stub)" : "desconectado"}</span>
          </div>
        </div>
      `).join("")}
    <button type="button" class="ghost" data-act="mcp-connect">Conectar servidor (stub)</button>
  `;
}

function renderTree(nodes) {
  return nodes.map((n) => {
    if (n.dir) {
      return `<li class="dir">▸ ${esc(n.name)}</li><li class="nested"><ul class="tree">${renderTree(n.children)}</ul></li>`;
    }
    const act = n.canvas ? `data-act="open-canvas" data-doc="${n.canvas}"` : "";
    return `<li ${act}> ${esc(n.name)}</li>`;
  }).join("");
}

function renderSessions() {
  const el = document.getElementById("sessions");
  if (state.sessions.length === 0) {
    el.innerHTML = `
      <div class="empty">
        <h1>Abrir uma sessão neste workspace</h1>
        <p>O workspace é <strong>centralbyte</strong>. Cada sessão (Claude, Codex, Cursor) vive numa tab, no centro — como no Cursor e no Claude Desktop.</p>
        <ol>
          <li>Em <strong>Agents</strong>, use <strong>Adicionar agente</strong> (CLI, pasta, nome, prompt).</li>
          <li>A sessão abre aqui em <strong>chat</strong>. Alterne para CLI no cabeçalho, sem recarregar.</li>
          <li>Inicie outro agente para ver duas sessões lado a lado.</li>
          <li>No compositor, digite <code>/</code> — a paleta é a deste provider.</li>
        </ol>
      </div>
    `;
    return;
  }

  const keep = document.activeElement;
  const keepId = keep?.dataset?.sessionId;
  const keepStart = keep?.selectionStart;

  el.innerHTML = state.sessions.map((s) => {
    const active = s.id === state.activeId ? "active-pane" : "";
    const bubbles = s.view === "bubbles";
    return `
      <section class="session-pane ${active}" data-session-pane="${s.id}">
        <header class="session-head" data-act="focus-session" data-id="${s.id}">
          <span class="name">${esc(s.name)}</span>
          <span class="muted">${esc(WORKSPACE.split("/").pop())}</span>
          <div class="toggle" role="group" aria-label="Modo da sessão">
            <button type="button" class="${bubbles ? "on" : ""}" data-act="view" data-id="${s.id}" data-view="bubbles">Chat</button>
            <button type="button" class="${!bubbles ? "on" : ""}" data-act="view" data-id="${s.id}" data-view="pty">CLI</button>
          </div>
          <button type="button" class="tiny ${s.showTrace ? "on" : ""}" data-act="trace" data-id="${s.id}" title="Stdout / JSON bruto">trace</button>
          <span class="grow"></span>
        </header>
        ${bubbles ? renderBubbles(s) : `<pre class="pty">${s.pty}</pre>`}
        ${s.showTrace ? `<pre class="trace">${esc(s.trace)}</pre>` : ""}
        <div class="composer">
          <div class="composer-box">
            <input class="composer-input" data-session-id="${s.id}"
              placeholder="Mensagem para ${esc(s.name)} · / comandos deste provider"
              value="${esc(s.draft)}" autocomplete="off" />
            <button type="button" class="primary" data-act="send" data-id="${s.id}">Enviar</button>
          </div>
          ${renderStatusLine(s)}
        </div>
      </section>
    `;
  }).join("");

  el.querySelectorAll(".composer-input").forEach((input) => {
    input.addEventListener("input", onComposerInput);
    input.addEventListener("keydown", onComposerKey);
    input.addEventListener("focus", () => {
      state.activeId = input.dataset.sessionId;
      el.querySelectorAll(".session-pane").forEach((p) => {
        p.classList.toggle("active-pane", p.dataset.sessionPane === state.activeId);
      });
    });
  });
  el.querySelectorAll(".chat, .pty").forEach((node) => {
    node.scrollTop = node.scrollHeight;
  });

  if (keepId) {
    const next = el.querySelector(`.composer-input[data-session-id="${keepId}"]`);
    if (next) {
      next.focus();
      try { next.setSelectionRange(keepStart, keepStart); } catch (_) { /* ignore */ }
    }
  }
}

function renderBubbles(s) {
  const html = s.messages.map((m) => {
    if (m.kind === "browser-offer") {
      return `<div class="msg tool"><span class="who">browser</span>${esc(m.text)}
        <div class="msg-actions">
          <button type="button" class="tiny" data-act="ask-browser" data-id="${s.id}" data-url="http://localhost:5173">Abrir localhost:5173</button>
          <button type="button" class="tiny" data-act="ask-browser" data-id="${s.id}" data-url="http://localhost:5173/docs">Abrir /docs</button>
        </div>
      </div>`;
    }
    const who = m.role === "user" ? "você" : m.role === "tool" ? "ferramenta" : s.name;
    return `<div class="msg ${m.role}"><span class="who">${who}</span>${esc(m.text)}</div>`;
  }).join("");
  return `<div class="chat"><div class="chat-col">${html}</div></div>`;
}

function renderBottom() {
  const el = document.getElementById("bottom-panel");
  el.hidden = !state.bottomOpen;
  if (!state.bottomOpen) return;
  el.innerHTML = `
    <div class="panel-head">
      <span>Terminal</span>
      <span class="muted">stub · sem PTY real</span>
      <span style="flex:1"></span>
      <button type="button" class="tiny" data-act="tool" data-tool="terminal">Fechar</button>
    </div>
    <pre class="term-out">${esc(state.termLines.join("\n"))}\n</pre>
    <div class="term-in">
      <span>$</span>
      <input id="term-input" value="${esc(state.termDraft)}" autocomplete="off" />
    </div>
  `;
  const input = document.getElementById("term-input");
  input?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const cmd = e.target.value.trim();
    state.termDraft = "";
    state.termLines.push("$ " + (cmd || ""));
    state.termLines.push(cmd ? fakeTerm(cmd) : "");
    renderBottom();
    document.getElementById("term-input")?.focus();
  });
  input?.addEventListener("input", (e) => { state.termDraft = e.target.value; });
}

function fakeTerm(cmd) {
  if (cmd === "ls") return "src  src-tauri  docs  prototype  AGENTS.md  README.md";
  if (cmd.startsWith("cat ")) return "(conteúdo stub)";
  return `comando stub: ${cmd}`;
}

function renderTool() {
  const el = document.getElementById("tool-pane");
  el.hidden = !state.rightTool;
  if (!state.rightTool) return;
  if (state.rightTool === "canvas") {
    const doc = CANVAS_DOCS[state.canvas] || CANVAS_DOCS.arch;
    el.innerHTML = `
      <div class="panel-head">
        <span>Canvas</span>
        <span class="muted">${esc(doc.title)}</span>
        <span style="flex:1"></span>
        <button type="button" class="tiny" data-act="tool" data-tool="canvas">Fechar</button>
      </div>
      <div class="canvas-body">
        <div class="md">${doc.html}</div>
        <div class="mermaid-stub">
          <div class="hint">Prévia Mermaid (stub — sem engine)</div>
          <div class="m-node">Composer</div>
          <div class="m-arrow">↓</div>
          <div>
            <span class="m-node">Bolhas JSON</span>
            <span class="m-node">PTY / xterm</span>
          </div>
          <div class="m-arrow">↓</div>
          <div class="m-node">CLI vendor</div>
        </div>
      </div>
    `;
    return;
  }
  const page = PAGES[state.browser.url] || {
    title: "Prévia (stub)",
    body: `<div class="card"><p>URL editável. Sem navegação real — página genérica para <code>${esc(state.browser.url)}</code>.</p></div>`,
  };
  el.innerHTML = `
    <div class="panel-head">
      <span>Browser</span>
      <span class="muted">projetos localhost e docs</span>
      <span style="flex:1"></span>
      <button type="button" class="tiny" data-act="tool" data-tool="browser">Fechar</button>
    </div>
    <div class="browser-chrome">
      <input id="url-bar" value="${esc(state.browser.url)}" spellcheck="false" />
      <button type="button" class="ghost" data-act="go-url">Ir</button>
    </div>
    <div class="preview-wrap">
      <div class="fake-page">
        <h1>${esc(page.title)}</h1>
        ${page.body}
      </div>
      <aside class="steps">
        <h4>Passos da IA</h4>
        ${state.browser.steps.length === 0
          ? `<p class="muted">O tracker aparece quando o agente navega (após Permitir).</p>`
          : state.browser.steps.map((s) => `
            <div class="step ${s.live ? "live" : ""}">
              <div class="t">${esc(s.t)}</div>
              ${esc(s.label)}
            </div>
          `).join("")}
      </aside>
    </div>
  `;
  const urlBar = document.getElementById("url-bar");
  urlBar?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goUrl(e.target.value);
  });
}

function goUrl(raw) {
  let url = (raw || document.getElementById("url-bar")?.value || "").trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url) && url !== "about:blank") {
    if (url.startsWith("localhost") || url.startsWith("127.")) url = "http://" + url;
    else if (url.startsWith("/")) url = "http://localhost:5173" + url;
    else url = "https://" + url;
  }
  state.browser.url = url;
  state.browser.steps.push({ t: nowClock(), label: "utilizador navegou para " + url, live: false });
  renderTool();
}

function renderStatus() {
  const n = state.sessions.length;
  const names = state.sessions.map((s) => s.name).join(", ") || "—";
  const sessionLabel = n === 0 ? "sem sessão" : n === 1 ? "1 sessão" : n + " sessões";
  document.getElementById("statusbar").innerHTML = `
    <span>centralbyte</span>
    <span class="sep">·</span>
    <span>${sessionLabel}</span>
    <span class="sep">·</span>
    <span>${esc(names)}</span>
    <span class="sep">·</span>
    <span>${state.theme === "dark" ? "escuro" : "claro"}</span>
    <span class="sep">·</span>
    <span>protótipo · sem CLI real</span>
  `;
}

function renderSlash() {
  const box = document.getElementById("slash");
  const session = sessionById(state.slash.sessionId) || activeSession();
  if (!state.slash.open || !session) {
    box.hidden = true;
    return;
  }
  const items = filteredCommands(session);
  const p = providerById(session.providerId);
  if (state.slash.index >= items.length) state.slash.index = 0;
  box.hidden = false;
  box.innerHTML = `
    <div class="cap">Comandos de ${esc(p.name)} — vocabulário deste CLI</div>
    ${items.length === 0
      ? `<div class="item"><span>Nenhum comando</span></div>`
      : items.map((c, i) => `
        <div class="item ${i === state.slash.index ? "on" : ""}" data-act="pick-slash" data-cmd="${esc(c.cmd)}">
          <kbd>${esc(c.cmd)}</kbd><span>${esc(c.desc)}</span>
        </div>
      `).join("")}
  `;
  const input = document.querySelector(`.composer-input[data-session-id="${session.id}"]`);
  if (input) {
    const r = input.getBoundingClientRect();
    box.style.left = Math.max(8, r.left) + "px";
    box.style.bottom = (window.innerHeight - r.top + 6) + "px";
    box.style.top = "auto";
  }
}

function renderPermission() {
  const root = document.getElementById("permission");
  const pending = state.browser.pendingUrl;
  root.hidden = !pending;
  if (pending) {
    document.getElementById("perm-body").textContent =
      `O agente quer abrir o browser em ${pending}`;
  }
}

function renderAgentModal() {
  const root = document.getElementById("agent-modal");
  root.hidden = !state.agentForm.open;
  if (!state.agentForm.open) return;
  const f = state.agentForm;
  const selected = providerById(f.providerId);
  root.innerHTML = `
    <div class="modal-backdrop" data-act="close-agent-form"></div>
    <div class="modal wide" role="dialog" aria-labelledby="agent-title">
      <h3 id="agent-title">Adicionar agente</h3>
      <p class="muted">Só CLIs detectados nesta máquina. 1 CLI = 1 agente. A pasta é o cwd da sessão.</p>
      <div class="provider-pick">
        ${PROVIDERS.map((p) => `
          <button type="button" class="opt ${p.id === f.providerId ? "on" : ""} ${p.detected ? "" : "off"}"
            data-act="pick-provider" data-provider="${p.id}" ${p.detected ? "" : "disabled"}>
            <strong>${esc(p.name)}</strong>
            <span>${esc(p.binary)} · ${p.detected ? "detectado" : "não encontrado"}</span>
          </button>
        `).join("")}
      </div>
      <label class="field">
        <span>Nome</span>
        <input name="name" value="${esc(f.name)}" placeholder="${esc(selected?.name || "Agente")}" autocomplete="off" />
      </label>
      <label class="field">
        <span>Caminho (cwd / pwd)</span>
        <div class="path-row">
          <input name="cwd" id="agent-cwd" value="${esc(f.cwd)}" placeholder="${esc(WORKSPACE)}" spellcheck="false" />
          <button type="button" class="ghost" data-act="pick-folder">Pasta</button>
        </div>
      </label>
      <label class="field">
        <span>Modelo (opcional)</span>
        <input name="model" value="${esc(f.model)}" placeholder="por defeito do CLI" autocomplete="off" />
      </label>
      <label class="field">
        <span>System prompt</span>
        <textarea name="systemPrompt" rows="4" placeholder="Instruções extra enviadas ao CLI nesta sessão (stub).">${esc(f.systemPrompt)}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="ghost" data-act="close-agent-form">Cancelar</button>
        <button type="button" class="primary" data-act="submit-agent">Abrir sessão</button>
      </div>
    </div>
  `;
}

function renderToast() {
  const el = document.getElementById("toast");
  el.hidden = !state.toast;
  el.textContent = state.toast || "";
}

function onComposerInput(e) {
  const session = sessionById(e.target.dataset.sessionId);
  if (!session) return;
  session.draft = e.target.value;
  state.activeId = session.id;
  if (session.draft.startsWith("/")) {
    state.slash.open = true;
    state.slash.filter = session.draft.split(/\s/)[0].toLowerCase();
    state.slash.sessionId = session.id;
    state.slash.index = 0;
  } else {
    state.slash.open = false;
  }
  renderSlash();
}

function onComposerKey(e) {
  const session = sessionById(e.target.dataset.sessionId);
  if (!session) return;
  if (state.slash.open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    const n = filteredCommands(session).length;
    if (!n) return;
    state.slash.index = (state.slash.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    renderSlash();
    return;
  }
  if (e.key === "Escape") {
    state.slash.open = false;
    renderSlash();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (state.slash.open) {
      const items = filteredCommands(session);
      const pick = items[state.slash.index];
      if (pick) {
        session.draft = pick.cmd + " ";
        e.target.value = session.draft;
        state.slash.open = false;
        renderSlash();
        return;
      }
    }
    sendMessage(session, e.target.value);
  }
}

document.addEventListener("click", (e) => {
  if (state.plusOpen && !e.target.closest("#plus-menu") && !e.target.closest("[data-act='toggle-plus']")) {
    state.plusOpen = false;
    renderPlusMenu();
  }
  const btn = e.target.closest("[data-act]");
  if (!btn) {
    if (!e.target.closest(".slash") && !e.target.closest(".composer-input")) {
      if (state.slash.open) {
        state.slash.open = false;
        renderSlash();
      }
    }
    return;
  }
  const act = btn.dataset.act;
  if (act === "toggle-plus") {
    state.plusOpen = !state.plusOpen;
    renderPlusMenu(btn);
    return;
  }
  if (act === "plus-open") {
    openFromPlus(btn.dataset.id);
    return;
  }
  if (act === "unpin") {
    unpinTool(btn.dataset.id);
    render();
    state.plusOpen = true;
    renderPlusMenu();
    return;
  }
  if (act === "pin") {
    pinTool(btn.dataset.id);
    render();
    state.plusOpen = true;
    renderPlusMenu();
    return;
  }
  if (act === "rail") {
    state.rail = btn.dataset.rail;
    render();
    return;
  }
  if (act === "tool") {
    const tool = btn.dataset.tool;
    if (tool === "terminal") state.bottomOpen = !state.bottomOpen;
    else state.rightTool = state.rightTool === tool ? null : tool;
    render();
    return;
  }
  if (act === "toggle-theme") {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("cc-proto-theme", state.theme);
    render();
    return;
  }
  if (act === "open-agent-form") {
    openAgentForm();
    return;
  }
  if (act === "close-agent-form") {
    closeAgentForm();
    return;
  }
  if (act === "pick-provider") {
    const p = providerById(btn.dataset.provider);
    if (!p || !p.detected) return;
    const prev = providerById(state.agentForm.providerId);
    if (!state.agentForm.name || state.agentForm.name === prev?.name) {
      state.agentForm.name = p.name;
    }
    state.agentForm.providerId = p.id;
    renderAgentModal();
    return;
  }
  if (act === "pick-folder") {
    document.getElementById("folder-pick").click();
    return;
  }
  if (act === "submit-agent") {
    startSession({
      providerId: state.agentForm.providerId,
      name: state.agentForm.name,
      cwd: state.agentForm.cwd,
      model: state.agentForm.model,
      systemPrompt: state.agentForm.systemPrompt,
    });
    return;
  }
  if (act === "start") {
    startSession(btn.dataset.provider);
    return;
  }
  if (act === "focus-session") {
    if (state.activeId !== btn.dataset.id) {
      state.activeId = btn.dataset.id;
      render();
    }
    return;
  }
  if (act === "close-session") {
    e.stopPropagation();
    closeSession(btn.dataset.id);
    return;
  }
  if (act === "view") {
    const s = sessionById(btn.dataset.id);
    if (s) s.view = btn.dataset.view;
    state.activeId = btn.dataset.id;
    render();
    return;
  }
  if (act === "trace") {
    const s = sessionById(btn.dataset.id);
    if (s) s.showTrace = !s.showTrace;
    render();
    return;
  }
  if (act === "send") {
    const s = sessionById(btn.dataset.id);
    const input = document.querySelector(`.composer-input[data-session-id="${btn.dataset.id}"]`);
    if (s && input) sendMessage(s, input.value);
    return;
  }
  if (act === "ask-browser") {
    const s = sessionById(btn.dataset.id);
    if (s) requestBrowserPermission(s, btn.dataset.url);
    return;
  }
  if (act === "allow-browser") {
    allowBrowser();
    return;
  }
  if (act === "deny-browser") {
    denyBrowser();
    return;
  }
  if (act === "go-url") {
    goUrl();
    return;
  }
  if (act === "open-canvas") {
    state.canvas = btn.dataset.doc;
    state.rightTool = "canvas";
    render();
    return;
  }
  if (act === "mcp-connect") {
    state.mcp.push({ name: "filesystem", connected: true });
    render();
    return;
  }
  if (act === "pick-slash") {
    const s = sessionById(state.slash.sessionId) || activeSession();
    if (!s) return;
    s.draft = btn.dataset.cmd + " ";
    state.slash.open = false;
    render();
    const input = document.querySelector(`.composer-input[data-session-id="${s.id}"]`);
    input?.focus();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (state.browser.pendingUrl) {
    denyBrowser();
    return;
  }
  if (state.agentForm.open) closeAgentForm();
  if (state.plusOpen) {
    state.plusOpen = false;
    renderPlusMenu();
  }
});

document.getElementById("agent-modal").addEventListener("input", (e) => {
  const t = e.target;
  if (t.name && Object.prototype.hasOwnProperty.call(state.agentForm, t.name)) {
    state.agentForm[t.name] = t.value;
  }
});

document.getElementById("folder-pick").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  const folder = (file.webkitRelativePath || "").split("/")[0];
  if (!folder) {
    showToast("O browser não expõe o caminho absoluto. Edite o cwd à mão.");
    return;
  }
  const parent = state.agentForm.cwd.replace(/\/[^/]+\/?$/, "") || WORKSPACE.replace(/\/[^/]+$/, "");
  state.agentForm.cwd = parent + "/" + folder;
  const input = document.getElementById("agent-cwd");
  if (input) input.value = state.agentForm.cwd;
  else renderAgentModal();
});

render();
