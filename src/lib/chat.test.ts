import { test } from "vitest";
import {
  agentPulse,
  canResumeProcess,
  replaceLiveAgent,
  applyNestedAgent,
  applyNestedFromEffect,
  applyTurnEffect,
  applyTurns,
  currentTaskLabel,
  emptyTurn,
  finishOpenWork,
  hydrateTurns,
  interpretJsonLine,
  nestedToolKind,
  groupToolRuns,
  toolGroupLabel,
  sessionBelongsToAgent,
  sessionContext,
  siblingStamp,
  turnTokenCount,
  formatModelLabel,
  formatRateWindow,
  type NestedAgent,
} from "./chat.ts";
import { composeOutgoing, contentTurnCount, defaultChatMode, providerModes } from "./slash.ts";
import { fencesClosed, renderChatMarkdown } from "./markdown.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}


test("chat parsers: json lines, turns, pulse and markdown", () => {
  assert(nestedToolKind("Task") === "Task", "Task");
  assert(nestedToolKind("Explore") === "Explore", "Explore");
  assert(nestedToolKind("Bash") === null, "Bash not nested");

  const started = interpretJsonLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Task",
            input: { description: "Explore auth" },
          },
        ],
      },
    }),
  );
  assert(started?.nested?.id === "toolu_1", "nested id");
  assert(started?.nested?.title === "Explore auth", "nested title");
  assert(started?.nested?.status === "running", "nested running");
  assert(started?.tool === "Task", "tool name");
  assert(started?.assistantText === undefined, "tool is not assistant text");

  const block = interpretJsonLine(
    JSON.stringify({
      type: "content_block_start",
      content_block: {
        type: "tool_use",
        id: "toolu_2",
        name: "Explore",
        input: { description: "Find login" },
      },
    }),
  );
  assert(block?.nested?.kind === "Explore", "content_block Explore");

  const done = interpretJsonLine(
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
    }),
  );
  assert(done?.nested?.id === "toolu_1", "result id");
  assert(done?.nested?.status === "done", "result done");
  assert(done?.toolDone === "toolu_1", "toolDone");

  const list = applyNestedAgent([], started!.nested!);
  const after = applyNestedAgent(list, done!.nested!);
  assert(after.length === 1 && after[0]!.status === "done", "merge done");
  assert(currentTaskLabel(after, []) === "Explore auth", "label keeps title");

  const thinkStart = interpretJsonLine(
    JSON.stringify({
      type: "content_block_start",
      content_block: { type: "thinking", thinking: "" },
    }),
  );
  assert(thinkStart === null, "empty thinking start is not invented");

  const thinkDelta = interpretJsonLine(
    JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "look at auth" },
    }),
  );
  assert(thinkDelta?.thinking === "look at auth", "thinking delta");

  const textDelta = interpretJsonLine(
    JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "hello" },
    }),
  );
  assert(textDelta?.assistantText === "hello", "text delta");

  const readTool = interpretJsonLine(
    JSON.stringify({
      type: "tool_use",
      id: "r1",
      name: "Read",
      input: { file_path: "src/x.ts" },
    }),
  );
  assert(readTool?.tool === "Read", "Read tool");
  assert(readTool?.file === "src/x.ts", "Read path");

  const multi = interpretJsonLine(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "r1", name: "Read", input: { file_path: "a.ts" } },
          { type: "tool_use", id: "r2", name: "Read", input: { file_path: "b.ts" } },
        ],
      },
    }),
  );
  assert(multi?.tool === "Read" && multi?.toolId === "r1", "first of many");
  assert(multi?.file === "a.ts", "first path");
  assert(multi?.moreTools?.length === 1 && multi.moreTools[0]?.toolId === "r2", "second tool kept");
  assert(multi?.moreTools?.[0]?.file === "b.ts", "second path");

  const childRead = interpretJsonLine(
    JSON.stringify({
      type: "tool_use",
      id: "r3",
      name: "Read",
      parent_tool_use_id: "toolu_1",
      input: { file_path: "c.ts" },
    }),
  );
  assert(childRead?.parentId === "toolu_1", "parent_tool_use_id");

  const grouped = groupToolRuns([
    { id: "t1", name: "Task", detail: "Explore auth", status: "running" },
    { id: "r1", name: "Read", detail: "a.ts", status: "done", parentId: "t1" },
    { id: "r2", name: "Read", detail: "b.ts", status: "done", parentId: "t1" },
    { id: "b1", name: "Bash", detail: "ls", status: "done" },
    { id: "b2", name: "Bash", detail: "pwd", status: "running" },
  ]);
  assert(grouped.length === 2, "nested card + bash batch");
  assert(grouped[0]?.kind === "nested" && grouped[0].id === "t1", "nested first");
  if (grouped[0]?.kind === "nested") {
    assert(grouped[0].children.length === 2, "reads live under nested");
    assert(grouped[0].title === "Explore auth", "nested title from detail");
  }
  assert(grouped[1]?.kind === "batch" && grouped[1].tools.length === 2, "bash batch");
  assert(toolGroupLabel("Read", 27) === "Leu 27 ficheiros", "read label");
  assert(toolGroupLabel("Bash", 8) === "Bash ×8", "bash label");

  const consecutive = groupToolRuns([
    { id: "a", name: "Read", detail: "1", status: "done" },
    { id: "b", name: "Read", detail: "2", status: "done" },
    { id: "c", name: "Grep", detail: "x", status: "done" },
  ]);
  assert(consecutive.length === 2, "consecutive reads then grep");
  assert(consecutive[0]?.kind === "batch" && consecutive[0].tools.length === 2, "two reads");
  assert(consecutive[1]?.kind === "batch" && consecutive[1].tools.length === 1, "one grep");

  const applied = applyTurns([], multi!, 1, () => "turn-1");
  assert(applied[0]?.tools.length === 2, "applyTurns keeps both reads");
  assert(applied[0]?.tools[1]?.id === "r2", "second read id");

  const usageDelta = interpretJsonLine(
    JSON.stringify({
      type: "message_delta",
      delta: { usage: { input_tokens: 120, output_tokens: 40 } },
    }),
  );
  assert(usageDelta?.turnUsage?.inputTokens === 120, "turn input");
  assert(usageDelta?.turnUsage?.outputTokens === 40, "turn output");

  const result = interpretJsonLine(
    JSON.stringify({
      type: "result",
      usage: { input_tokens: 200, output_tokens: 80 },
      model: "fixture",
    }),
  );
  assert(result?.turnDone === true, "result ends turn");
  assert(result?.turnUsage?.outputTokens === 80, "result turn usage");
  assert(turnTokenCount(result?.turnUsage) === 280, "turn tokens");

  let seq = 0;
  const nid = () => `t${++seq}`;
  let turns = [emptyTurn("t0", "fix login", 1_000)];
  turns = applyTurns(turns, thinkDelta!, 1_100, nid);
  turns = applyTurns(turns, readTool!, 1_200, nid);
  turns = applyTurns(turns, { toolDone: "r1" }, 1_300, nid);
  turns = applyTurns(turns, textDelta!, 1_400, nid);
  turns = applyTurns(turns, result!, 1_800, nid);
  const turn = turns[0]!;
  assert(turn.thinking === "look at auth", "turn thinking");
  assert(turn.tools[0]?.name === "Read" && turn.tools[0]?.status === "done", "tool done");
  assert(turn.assistant === "hello", "turn assistant");
  assert(turn.endedAt === 1_800, "turn ended");
  assert(turn.usage?.inputTokens === 200, "turn usage from result");

  const afterMeta = applyTurns(turns, { turnUsage: { inputTokens: 1, outputTokens: 1 } }, 1_900, nid);
  assert(afterMeta.length === 1, "usage after result does not open a ghost turn");
  assert(afterMeta[0]!.endedAt === 1_800, "closed turn stays closed");

  const nestedLive = applyNestedFromEffect(
    [{ id: "toolu_1", title: "Explore auth", kind: "Task", status: "running" }],
    { turnDone: true },
  );
  assert(nestedLive[0]?.status === "done", "result closes nested pulse");

  const finished = finishOpenWork(
    {
      turns: [emptyTurn("open", "hi", 1)],
      // Annotated on purpose: finishOpenWork returns `T`, so a narrowed literal
      // would make the "done" assertion below unreachable to the type checker
      // even though the function widens the status at runtime.
      nested: [{ id: "n1", title: "x", kind: "Task", status: "running" }] as NestedAgent[],
    },
    50,
  );
  assert(finished.turns[0]!.endedAt === 50, "exit ends open turn");
  assert(finished.nested[0]!.status === "done", "exit ends nested");
  assert(sessionBelongsToAgent({ id: "proc", catalogId: "cat" }, "cat"), "match catalog");
  assert(sessionBelongsToAgent({ id: "proc", catalogId: "cat" }, "proc"), "match live id");
  assert(!sessionBelongsToAgent({ id: "proc", catalogId: "cat" }, "other"), "no false match");

  const live = applyTurnEffect(emptyTurn("x", "", 0), { thinking: "a" }, 1);
  assert(live.endedAt === null, "open turn");

  assert(
    siblingStamp("claude", "g1", "a1", "Claude", new Date("2026-08-22T03:00:00.000Z")) ===
      "|claude|g1|a1|Claude|2026-08-22T03:00:00.000Z|",
    "stamp",
  );

  const streamed = interpretJsonLine(
    JSON.stringify({
      type: "stream_event",
      session_id: "sess-live",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hi" },
      },
    }),
  );
  assert(streamed?.assistantText === "Hi", "unwrap stream_event text");
  assert(streamed?.sessionId === "sess-live", "unwrap keeps session_id");
  assert(streamed?.replaceAssistant === false, "delta appends");

  const thinkWrapped = interpretJsonLine(
    JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "plan" },
      },
    }),
  );
  assert(thinkWrapped?.thinking === "plan", "unwrap stream_event thinking");

  const thread = interpretJsonLine(JSON.stringify({ type: "thread.started", thread_id: "thr-9" }));
  assert(thread?.sessionId === "thr-9", "codex thread id");

  const item = interpretJsonLine(
    JSON.stringify({
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: "pong" },
    }),
  );
  assert(item?.assistantText === "pong", "codex agent_message");
  assert(item?.replaceAssistant === true, "codex snapshot replaces");

  const cmd = interpretJsonLine(
    JSON.stringify({
      type: "item.started",
      item: { id: "item_1", type: "command_execution", command: "ls" },
    }),
  );
  assert(cmd?.tool === "ls", "codex command");
  assert(cmd?.toolId === "item_1", "codex tool id");

  const turnDone = interpretJsonLine(
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 3, cached_input_tokens: 4 },
    }),
  );
  assert(turnDone?.turnDone === true, "codex turn done");
  assert(turnDone?.turnUsage?.inputTokens === 10, "codex input");
  assert(turnDone?.turnUsage?.cacheRead === 4, "codex cache read");

  assert(canResumeProcess("claude", "sess-1") === true, "resume with vendor id");
  assert(canResumeProcess("claude", null) === true, "reopen spawns TUI in cwd without resume id");
  assert(canResumeProcess("fixture", null) === true, "fixture relaunches without resume id");

  const replaced = replaceLiveAgent(
    [{ id: "proc-old", catalogId: "cat-1" }, { id: "other", catalogId: "cat-2" }],
    { id: "proc-new", catalogId: "cat-1" },
  );
  assert(replaced.length === 2, "replace keeps pane count");
  assert(replaced[0]?.id === "proc-new" && replaced[0]?.catalogId === "cat-1", "replace keeps position");
  assert(replaceLiveAgent([], { id: "n", catalogId: "c" }).length === 1, "replace appends when missing");
  assert(
    replaceLiveAgent([{ id: "g1a", catalogId: "ga" }], { id: "g2b", catalogId: "gb" }).length === 2,
    "spawn in another group does not drop the first pane",
  );

  assert(agentPulse({ status: "running", liveTurn: true }) === "run", "pulse run");
  assert(agentPulse({ status: "running", pendingAsk: true, liveTurn: true }) === "warn", "pulse warn beats run");
  assert(agentPulse({ status: "exit", exitCode: 1 }) === "error", "pulse error");
  assert(agentPulse({ status: "exit", exitCode: 0 }) === "idle", "pulse idle exit 0");
  assert(agentPulse({ status: "running" }) === "idle", "pulse idle live");
  assert(agentPulse({ status: "exit", exitCode: 0, liveTurn: true }) === "idle", "exited process is not running");
  assert(agentPulse({ status: "exit", nestedRunning: true }) === "idle", "exited nested is not running");
  assert(agentPulse({ status: "running", nestedRunning: true }) === "run", "nested pulse while process lives");

  assert(sessionContext("Fix login", "Be brief") === "Session goal: Fix login\n\nBe brief", "session context");
  assert(sessionContext("  ", "") === "", "empty session context");

  assert(providerModes("claude")[0]?.id === "agent", "claude default agent");
  assert(defaultChatMode("claude") === "agent", "default chat mode");
  assert(providerModes("claude").some((m) => m.slash === "/plan"), "claude plan slash");
  assert(providerModes("codex").length === 0, "codex has no mode pills");

  const init = interpretJsonLine(
    JSON.stringify({
      type: "system",
      subtype: "init",
      model: "claude-sonnet-4-5-20250929",
      session_id: "sess-1",
    }),
  );
  assert(init?.model === "claude-sonnet-4-5-20250929", "system init model");
  assert(formatModelLabel(init?.model ?? "") === "Sonnet 4.5", "short model label");

  const fiveh = interpretJsonLine(
    JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", rateLimitType: "five_hour" },
    }),
  );
  assert(fiveh?.rateLimits?.fiveHour?.status === "allowed", "five hour status");
  assert(formatRateWindow(fiveh?.rateLimits?.fiveHour, "5h") === "5h ok", "five hour label");

  const quotas = interpretJsonLine(
    JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 23.4 },
        seven_day: { used_percentage: 41 },
      },
    }),
  );
  assert(quotas?.rateLimits?.fiveHour?.usedPct === 23.4, "five hour pct");
  assert(formatRateWindow(quotas?.rateLimits?.sevenDay, "semana") === "semana 41%", "weekly label");

  const withFile = composeOutgoing({
    draft: "olha",
    files: [{ path: "/tmp/a.png", name: "a.png" }],
  });
  assert(withFile.startsWith("olha"), "no plan prefix on send");
  assert(withFile.includes("- /tmp/a.png"), "attachment path");

  assert(composeOutgoing({ draft: "/plan already", files: [] }) === "/plan already", "draft slash unchanged");
  assert(contentTurnCount([{ user: "a", assistant: "" }, { user: "", assistant: "" }]) === 1, "content turns");

  assert(fencesClosed("```js\nconst x = 1\n```") === true, "closed fence");
  assert(fencesClosed("```js\nconst x = 1\n") === false, "open fence");

  const hi = renderChatMarkdown("```js\nconst x = 1\n```", false);
  assert(hi.html.includes("hljs"), "highlight class");
  assert(hi.html.includes("hljs-keyword") || hi.html.includes("const"), "js highlight or source");

  const stream = renderChatMarkdown("```js\nconst x = 1\n", true);
  assert(!stream.html.includes("hljs-keyword"), "no highlight on open stream fence");

  const mmd = renderChatMarkdown("```mermaid\ngraph TD\nA-->B\n```", false);
  assert(mmd.mermaid.length === 1, "mermaid extracted");
  assert(mmd.html.includes("mermaid-mount"), "mermaid mount");
  assert(!mmd.html.includes("graph TD"), "mermaid not left as code");

  const math = renderChatMarkdown("Inline: $E = mc^2$", false);
  assert(math.html.includes("katex"), "inline katex");

  const blockMath = renderChatMarkdown("$$\\sum_{i=1}^{n} i$$", false);
  assert(blockMath.html.includes("katex"), "block katex");

  const dl = renderChatMarkdown("Termo 1\n: Definição do termo 1\n", false);
  assert(dl.html.includes("<dl>"), "definition list");
  assert(dl.html.includes("<dt>"), "definition term");

  const hydrated = hydrateTurns([
    {
      id: "t1",
      user: "hi",
      assistant: "hello",
      startedAt: 10,
      endedAt: 20,
      tools: [{ id: "r1", name: "Read", detail: "a.ts", status: "done" }],
    },
    { id: "", user: "skip" },
    "nope",
    { id: "t2", user: "again" },
  ]);
  assert(hydrated.length === 2, "hydrate keeps valid turns");
  assert(hydrated[0]!.thinking === "", "hydrate thinking default");
  assert(hydrated[0]!.tools[0]!.name === "Read", "hydrate tools");
  assert(hydrated[1]!.assistant === "", "hydrate assistant default");
  assert(hydrated[1]!.tools.length === 0, "hydrate missing tools");
  assert(hydrateTurns(null).length === 0, "hydrate null");
});
