import { expect, test } from "vitest";
import {
  browseProtocolPrompt,
  mergeSeenUrls,
  observeBrowseRequests,
  MAX_SEEN_URLS,
  OPEN_MARKER,
} from "./pty_translate/index.ts";

/** The screen delta is `previous` -> `current`; only new lines are read. */
function observe(previous: string, current: string) {
  return observeBrowseRequests(previous, current);
}

test("the marker is a deliberate request", () => {
  const seen = observe("", "Vou mostrar a página.\n<<centralbyte:open https://x.dev/a>>");
  expect(seen.requests).toEqual(["https://x.dev/a"]);
  // A requested URL is not also offered in the passive list.
  expect(seen.urls).toEqual([]);
});

test("the marker is matched case-insensitively and tolerates spacing", () => {
  const seen = observe("", "<<CentralByte:open   https://x.dev/b   >>");
  expect(seen.requests).toEqual(["https://x.dev/b"]);
});

test("several markers keep the order the agent printed them", () => {
  const seen = observe("", "<<centralbyte:open https://a.dev>>\nmeio\n<<centralbyte:open https://b.dev>>");
  expect(seen.requests).toEqual(["https://a.dev", "https://b.dev"]);
});

test("a repeated marker in one delta is asked once", () => {
  const seen = observe("", "<<centralbyte:open https://a.dev>>\n<<centralbyte:open https://a.dev>>");
  expect(seen.requests).toEqual(["https://a.dev"]);
});

test("bare URLs are collected, never requested", () => {
  const seen = observe("", "erro: ver https://docs.rs/x e https://github.com/o/r");
  expect(seen.requests).toEqual([]);
  expect(seen.urls).toEqual(["https://docs.rs/x", "https://github.com/o/r"]);
});

test("trailing sentence punctuation is trimmed off a URL", () => {
  expect(observe("", "veja https://x.dev/a.").urls).toEqual(["https://x.dev/a"]);
  expect(observe("", "(https://x.dev/b),").urls).toEqual(["https://x.dev/b"]);
  expect(observe("", "isto: https://x.dev/c;").urls).toEqual(["https://x.dev/c"]);
});

test("a closing paren that belongs to the URL is kept", () => {
  expect(observe("", "https://en.wikipedia.org/wiki/Foo_(bar)").urls).toEqual([
    "https://en.wikipedia.org/wiki/Foo_(bar)",
  ]);
});

test("localhost counts, a bare scheme does not", () => {
  expect(observe("", "servidor em http://localhost:1420/").urls).toEqual(["http://localhost:1420/"]);
  expect(observe("", "https://").urls).toEqual([]);
  expect(observe("", "ftp://x.dev/a").urls).toEqual([]);
});

test("only the delta is read, so an unchanged screen asks nothing", () => {
  const screen = "<<centralbyte:open https://x.dev>>";
  expect(observe("", screen).requests).toEqual(["https://x.dev"]);
  expect(observe(screen, screen).requests).toEqual([]);
});

test("the seen list dedupes, keeps insertion order and caps", () => {
  expect(mergeSeenUrls(undefined, [])).toEqual([]);
  // Same array identity when nothing was found, so React state is not churned.
  const held = ["https://a.dev"];
  expect(mergeSeenUrls(held, [])).toBe(held);

  expect(mergeSeenUrls(["https://a.dev"], ["https://b.dev", "https://a.dev"])).toEqual([
    "https://a.dev",
    "https://b.dev",
  ]);

  const many = Array.from({ length: MAX_SEEN_URLS + 4 }, (_, i) => `https://x.dev/${i}`);
  const capped = mergeSeenUrls([], many);
  expect(capped.length).toBe(MAX_SEEN_URLS);
  // The oldest are dropped, the newest kept.
  expect(capped[capped.length - 1]).toBe(`https://x.dev/${MAX_SEEN_URLS + 3}`);
});

test("the injected protocol names the marker it teaches", () => {
  const prompt = browseProtocolPrompt();
  expect(prompt).toContain(OPEN_MARKER);
  // It must tell the agent not to block waiting for an answer.
  expect(prompt.toLowerCase()).toContain("never wait");
});
