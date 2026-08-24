import { test } from "vitest";
import {
  applySkinObservers,
  interpretScreen,
  mergeScreenSession,
  observeScreen,
  ptyIsActive,
  settleTurnsIfIdle,
  snapshotViewport,
  stripAnsi,
  translatePty,
  appendPtyLog,
  turnHasOpenWork,
} from "./pty_translate/index.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}


test("ansi hygiene and pty activity", () => {
  assert(stripAnsi("hello") === "hello", "plain");
  assert(stripAnsi("\u001B[32mhi\u001B[0m") === "hi", "sgr");
  assert(stripAnsi("a\rb") === "b", "cr overwrites line");
  assert(stripAnsi("keep\r\nnext") === "keep\nnext", "crlf is newline");
  assert(stripAnsi("Progress\rProgress 50%") === "Progress 50%", "spinner");
  assert(
    stripAnsi("\u001B]8;;https://github.com/openai/codex/releases/latest\u0007label\u001B]8;;\u0007") === "label",
    "osc 8 hyperlink",
  );
  assert(translatePty("claude", "\u001B[1mok\u001B[0m") === "ok", "claude");
  assert(translatePty("codex", "\u001B[31mx\u001B[0m") === "x", "codex");
  assert(appendPtyLog("ab", "cd", 3) === "bcd", "cap");
  assert(ptyIsActive(1000, 1200, 500) === true, "active");
  assert(ptyIsActive(1000, 2000, 500) === false, "idle");
  assert(ptyIsActive(undefined, 1) === false, "missing");
});


test("claude screen: model and weekly quota", () => {
  const claude = interpretScreen(
    "claude",
    "Claude Code v2.1.239  Sonnet 3.5 with high effort\nYou've used 88% of your weekly limit - resets Aug 25",
  );
  assert(claude.model === "Sonnet 3.5", `claude model ${claude.model}`);
  assert(claude.quota === "88% semana", `claude quota ${claude.quota}`);
  assert(claude.warn === false, "claude not warn");
});


test("cursor screen drops tips and hints", () => {
  const cursor = interpretScreen(
    "cursor",
    "Tip: Use /skills to give Cursor specialized knowledge for tasks.\nCursor Agent v2026.08.11\n──────────────\n~/Workplace/Projects main\nTip: Type `?` in the prompt bar to show in-app hints.",
  );
  assert(!/Tip:/i.test(cursor.display), "cursor drops tips");
  assert(!/Type `\?`/.test(cursor.display), "cursor drops hint");
  assert(cursor.display.includes("Cursor Agent"), "cursor keeps title");
});


test("collapses consecutive duplicate lines", () => {
  const dups = interpretScreen("claude", "hello\nhello\nworld");
  assert(dups.display === "hello\nworld", "collapse consecutive dup lines");
});


test("codex screen flags a failed MCP handshake", () => {
  const codex = interpretScreen(
    "codex",
    "⚠️ MCP client for 'hiveterm' failed to start: MCP startup failed: handshaking with MCP server failed",
  );
  assert(codex.warn === true, "codex mcp warn");
  assert(interpretScreen("codex", "OpenAI Codex (v0.145.0)").warn === false, "codex idle no warn");
});


test("cursor screen carries the context percentage", () => {
  const cursorPct = interpretScreen(
    "cursor",
    "Cursor Agent v2026.08.11\nAuto · 8.2%\n~/Workplace/Projects",
  );
  assert(cursorPct.pct === 8.2, `cursor pct ${cursorPct.pct}`);
});


test("unchanged screen keeps object identity", () => {
  const sess = { ptyLog: "hello", warned: false as boolean | undefined };
  const same = mergeScreenSession(sess, "hello", "fixture", 10, interpretScreen);
  assert(same === sess, "unchanged screen keeps identity");
  const next = mergeScreenSession(sess, "hello\nworld", "fixture", 10, interpretScreen);
  assert(next !== sess && next.ptyLog.includes("world"), "changed screen is a new object");
});


test("viewport snapshot is only the visible rows", () => {
  const view = snapshotViewport({
    rows: 2,
    viewportY: 1,
    getLine: (y) => {
      const rows = ["hidden", "vis-a", "vis-b", "below"];
      const t = rows[y];
      return t ? { isWrapped: false, translateToString: () => t } : undefined;
    },
  });
  assert(view === "vis-a\nvis-b", `viewport only, got ${JSON.stringify(view)}`);
});


test("observers pick assistant text and tools", () => {
  const observed = observeScreen(
    "cursor",
    "Tip: hello\n~/Workplace/Projects",
    "Tip: hello\n~/Workplace/Projects\nA resposta do agente.\nRead src/App.tsx",
    "Teste de funcionamento",
  );
  assert(observed.assistant.includes("A resposta do agente"), `assistant ${observed.assistant}`);
  assert(observed.tools.some((t) => t.name === "Read"), "tool Read");
});


test("observers fill the open turn and idle settles it", () => {
  const openTurn = {
    ptyLog: "A resposta do agente.",
    provider: "cursor",
    lastBytesAt: undefined as number | undefined,
    turns: [
      {
        id: "t1",
        origin: "user" as const,
        user: "Teste de funcionamento",
        thinking: "",
        tools: [] as { id: string; name: string; detail: string; status: "running" | "done" }[],
        assistant: "",
        usage: null,
        startedAt: 1,
        endedAt: null as number | null,
      },
    ],
  };
  const skinned = applySkinObservers(openTurn, "Tip: x", 10);
  assert(skinned.turns[0]?.assistant.includes("A resposta do agente"), "observer fills assistant");
  assert(skinned.lastBytesAt === 10, "observer stamps activity time");
  const idle = settleTurnsIfIdle({ ...skinned, lastBytesAt: 1 }, 5000, 1500);
  assert(idle.turns[0]?.endedAt === 1, "idle settles turn");
});

test("orb ignores typing and only tracks open turns", () => {
  const sess = { ptyLog: "> ", lastBytesAt: 5 };
  const typed = mergeScreenSession(sess, "> hello", "fixture", 99, interpretScreen);
  assert(typed.lastBytesAt === 5, "typing must not stamp lastBytesAt");
  assert(turnHasOpenWork([]) === false, "no turn");
  assert(
    turnHasOpenWork([
      {
        id: "t",
        origin: "user",
        user: "hi",
        thinking: "",
        tools: [],
        assistant: "",
        usage: null,
        startedAt: 1,
        endedAt: null,
      },
    ]),
    "open user turn is live",
  );
  assert(
    turnHasOpenWork([
      {
        id: "t",
        origin: "user",
        user: "hi",
        thinking: "",
        tools: [],
        assistant: "done",
        usage: null,
        startedAt: 1,
        endedAt: 20,
      },
    ]) === false,
    "settled turn is not live",
  );
});
