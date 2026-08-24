// @vitest-environment jsdom
//
// Smoke tests for the chrome's wiring: that the three hooks compose, that the
// window grid mounts, and that the overlays open and close. They deliberately do
// not assert on PTY behaviour — the terminal and the Markdown renderer are
// stubbed, because neither runs meaningfully in jsdom.
//
// Everything the app would ask the Rust side is answered by one fake `api`.

import { beforeEach, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const REPO = "/repo/central";

/** What the fake IPC returns, keyed by command. A function receives the call
 *  arguments; anything not listed resolves to null. */
const replies: Record<string, unknown> = {
  startSession: {
    id: "sess-1",
    name: "Fixture",
    provider: "fixture",
    mode: "interactive_pty",
    cwd: REPO,
    model: null,
  },
  historyUpsertSession: (group: unknown) => ({
    repositories: [{ name: "central", path: REPO }],
    sessions: [group],
  }),
  listProviders: [
    { id: "claude", detected: false, binary: null },
    { id: "fixture", detected: true, binary: "fixture" },
  ],
  termBackend: "xterm",
  historyGet: { repositories: [{ name: "central", path: REPO }], sessions: [] },
  workspaceCwd: REPO,
  listWorkspace: [],
  listMarkdown: [],
  browseDir: { path: REPO, parent: "/repo", entries: [] },
  gitStatus: { repo: false, branch: "", insertions: 0, deletions: 0, entries: [] },
};

const called: string[] = [];

vi.mock("./lib/commands", () => ({
  api: new Proxy(
    {},
    {
      get:
        (_t, name: string) =>
        async (...args: unknown[]) => {
          called.push(name);
          const reply = replies[name];
          return typeof reply === "function" ? reply(...args) : (reply ?? null);
        },
    },
  ),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
    startDragging: vi.fn(),
    startResizeDragging: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));

// The terminal host and the Markdown renderer are the two leaves that need a
// real browser; stub them so the rest of the tree can mount. The terminal stub
// also exposes its `onScreen` callback, which is how a PTY frame reaches the app.
const screenSinks: ((text: string) => void)[] = [];
vi.mock("./NativeTermHost", () => ({
  TermView: ({ onScreen }: { onScreen?: (text: string) => void }) => {
    if (onScreen && !screenSinks.includes(onScreen)) screenSinks.push(onScreen);
    return <div data-testid="term" />;
  },
}));
vi.mock("./CanvasPane", () => ({ default: () => <div data-testid="canvas" /> }));

const { default: App } = await import("./App");

beforeEach(() => {
  called.length = 0;
  screenSinks.length = 0;
  localStorage.clear();
});

/** Start the fixture agent and return once its pane is mounted. */
async function startFixtureAgent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Novo chat" }));
  await user.click(screen.getByRole("button", { name: "Iniciar" }));
  await screen.findByRole("button", { name: "Fechar agente" });
}

/** Feed one interpreted PTY frame to the newest pane. */
async function emitScreen(text: string) {
  const sink = screenSinks[screenSinks.length - 1]!;
  await act(async () => {
    sink(text);
  });
}

test("mounts with the catalog folder and no agent", async () => {
  render(<App />);

  expect(await screen.findByRole("button", { name: "central" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Sessão no centro" })).toBeTruthy();
  expect(screen.getByText("Sem sessões gravadas.")).toBeTruthy();
  // The footer names the folder and reports that nothing is focused.
  expect(document.querySelector("footer")?.textContent).toBe("central·sem agente");
});

test("Novo chat opens the agent modal listing only detected CLIs", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "central" });

  await user.click(screen.getByRole("button", { name: "Novo chat" }));

  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("Só CLIs detectados no PATH");
  // fixture is detected and enabled; claude is absent and disabled.
  const options = [...dialog.querySelectorAll<HTMLButtonElement>("button.opt")];
  const byLabel = Object.fromEntries(options.map((o) => [o.textContent, o.disabled]));
  expect(byLabel).toEqual({ "Claudeausente": true, "Fixturefixture": false });
  expect(screen.getByRole("button", { name: "Iniciar" })).toBeTruthy();
});

test("Escape closes the topmost overlay", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "central" });

  await user.click(screen.getByRole("button", { name: "Novo chat" }));
  expect(screen.queryByRole("dialog")).toBeTruthy();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the session modal carries the folder it was opened from", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "central" });

  await user.click(screen.getByRole("button", { name: `Nova sessão em central` }));

  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("Nova sessão");
  expect(dialog.querySelector<HTMLInputElement>("input.readonly")?.value).toBe(REPO);
});

test("opening a tool from the + menu shows that tool in the right bar", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "central" });

  // The right bar starts closed, docked as a toggle.
  await user.click(screen.getByRole("button", { name: "Abrir barra direita" }));
  // Both the header `+` and the empty state open the menu; use the header one.
  await user.click(document.querySelector<HTMLElement>("button.tab-add")!);
  await user.click(screen.getByRole("button", { name: "Alterações" }));

  expect(await screen.findByText("sem git")).toBeTruthy();
  expect(screen.getByText("Esta pasta não é um repositório git.")).toBeTruthy();
  expect(called).toContain("gitStatus");
});

test("the theme toggle in Settings flips the root attribute and persists", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "central" });

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  await user.click(screen.getByRole("button", { name: "Configurações" }));
  await user.click(screen.getByRole("button", { name: "Claro" }));
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(localStorage.getItem("cc-theme")).toBe("light");
});

test("the open marker raises the permission ask, naming the agent", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "central" });
  await startFixtureAgent(user);

  await emitScreen("Vou mostrar a página.\n<<centralbyte:open https://x.dev/a>>");

  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("Permissão do browser");
  expect(dialog.textContent).toContain("Fixture");
  expect(dialog.textContent).toContain("https://x.dev/a");

  // Allowing opens the webview and shows the browser tab.
  await user.click(screen.getByRole("button", { name: "Permitir" }));
  expect(called).toContain("browserEnsure");
  expect(called).toContain("browserNavigate");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a bare URL never raises the ask; it is offered in the browser panel", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "central" });
  await startFixtureAgent(user);

  await emitScreen("erro: ver https://docs.rs/x para detalhes");
  expect(screen.queryByRole("dialog")).toBeNull();

  // Open the browser tool; the harvested URL is offered, not opened.
  await user.click(screen.getByRole("button", { name: "Abrir barra direita" }));
  await user.click(document.querySelector<HTMLElement>("button.tab-add")!);
  await user.click(screen.getByRole("button", { name: "Navegador" }));

  expect(await screen.findByText("Do agente:")).toBeTruthy();
  expect(screen.getByRole("button", { name: "docs.rs/x" })).toBeTruthy();
  expect(called).not.toContain("browserNavigate");
});

test("a second frame does not replace an ask still on screen", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "central" });
  await startFixtureAgent(user);

  await emitScreen("<<centralbyte:open https://first.dev>>");
  expect((await screen.findByRole("dialog")).textContent).toContain("https://first.dev");

  await emitScreen("<<centralbyte:open https://second.dev>>");
  expect(screen.getByRole("dialog").textContent).toContain("https://first.dev");
});
