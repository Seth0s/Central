import { test } from "vitest";
import {
  classifyOutgoing,
  composeOutgoing,
  parseSlashInput,
  providerModes,
  slashKindOf,
  slashItems,
  vendorAttachArgs,
} from "./slash.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}


test("slash kind per provider", () => {
  assert(slashKindOf("claude", "/effort") === "pick", "effort pick");
  assert(slashKindOf("claude", "/model") === "pick", "model pick");
  assert(slashKindOf("claude", "/autocompact") === "pick", "autocompact pick");
  assert(slashKindOf("claude", "/plan") === "control", "plan control");
  assert(slashKindOf("claude", "/cost") === "report", "cost report");
  assert(slashKindOf("claude", "/clear") === "chrome", "clear chrome");
  assert(slashKindOf("claude", "/resume") === "prompt", "resume goes to TUI");
  assert(slashKindOf("claude", "/continue") === "prompt", "continue goes to TUI");
  assert(classifyOutgoing("claude", "/resume") === null, "resume is not intercepted");
  assert(classifyOutgoing("claude", "/resume abc-1") === null, "resume with id is not intercepted");
  assert(vendorAttachArgs("claude", "sess-9")?.resumeId === "sess-9", "attach id");
  assert(vendorAttachArgs("claude", "")?.continueLast === true, "claude bare resume continues cwd");
  assert(vendorAttachArgs("cursor", "") === null, "cursor needs id");
  assert(vendorAttachArgs("cursor", "", true)?.continueLast === true, "continue cmd");
  assert(slashKindOf("cursor", "/ask") === "prompt", "cursor prompt");
});


test("classify outgoing", () => {
  const effortBare = classifyOutgoing("claude", "/effort");
  assert(effortBare?.kind === "pick" && effortBare.line === "/effort", "bare effort stays pick");
  const effortArg = classifyOutgoing("claude", "/effort medium");
  assert(effortArg?.kind === "control" && effortArg.line === "/effort medium", "effort with arg is control");
  const prose = classifyOutgoing("claude", "olá");
  assert(prose === null, "prose is not a slash");
  assert(classifyOutgoing("claude", "/unknown") === null, "unknown slash stays user");
  assert(parseSlashInput("/model sonnet")?.rest === "sonnet", "model rest");
});


test("compose and filter", () => {
  const withFile = composeOutgoing({
    draft: "olha",
    files: [{ path: "/tmp/a.png", name: "a.png" }],
  });
  assert(withFile.startsWith("olha"), "no plan prefix");
  assert(withFile.includes("- /tmp/a.png"), "attachment path");
  assert(composeOutgoing({ draft: "/plan already", files: [] }) === "/plan already", "draft unchanged");
  assert(providerModes("claude").some((m) => m.slash === "/plan"), "claude plan slash");
  assert(slashItems("claude", "/mo").some((c) => c.cmd === "/model"), "slash filter");
  assert(slashItems("claude", "/auto").some((c) => c.cmd === "/autocompact"), "slash filter autocompact");
});
