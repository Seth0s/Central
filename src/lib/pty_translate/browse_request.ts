// An agent is a vendor TUI on a PTY: it has no IPC channel into the app, so the
// only thing it can do is print. This module reads the screen for two things.
//
//   1. The documented open marker. The skin teaches it to the agent in the
//      system prompt at spawn, so a match is a deliberate request and raises the
//      permission ask (docs/architecture.md § Ferramentas).
//   2. Any bare http(s) URL. Agents print these constantly — docs, errors, repos
//      — so these never interrupt. They are collected for the browser panel to
//      offer, which is the only path on providers that take no system prompt at
//      spawn (Codex, Cursor).
//
// Both read the screen delta, never the raw byte stream.

import { addedLines } from "./observe.ts";

export const OPEN_MARKER = "<<centralbyte:open";

/** Matches the marker the skin documents, e.g. `<<centralbyte:open https://x.dev>>`. */
const MARKER_RE = /<<centralbyte:open\s+(\S+?)\s*>>/gi;

/** A bare URL in prose. Trailing punctuation is trimmed by `tidyUrl`. */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/** How many harvested URLs a session keeps. Oldest are dropped. */
export const MAX_SEEN_URLS = 12;

/**
 * The protocol, injected into the system prompt at spawn. Only reaches providers
 * that accept one — the harvested-URL list is the fallback everywhere else.
 */
export function browseProtocolPrompt(): string {
  return [
    "This CLI runs inside CentralByte, a desktop skin with an embedded browser panel.",
    `To ask the user to open a page there, print a line containing ${OPEN_MARKER} <url>>>.`,
    "The user is asked for permission each time; you get no reply on the PTY, so never wait for one.",
    "Print it only when seeing the page in a browser is the point. For a link the user merely reads, write the URL as normal prose.",
  ].join("\n");
}

/** Drop punctuation a sentence left glued to the end of a URL. */
function tidyUrl(raw: string): string {
  let url = raw.trim();
  while (url && /[.,;:!?)\]}>'"`]$/.test(url)) {
    // Keep a closing paren that belongs to the URL, as in a wiki link.
    if (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) > (url.match(/\)/g)?.length ?? 0) - 1) break;
    url = url.slice(0, -1);
  }
  return url;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+\.[^\s]/i.test(url) || /^https?:\/\/localhost(?::\d+)?(?:\/|$)/i.test(url);
}

function dedupe(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) if (u && !out.includes(u)) out.push(u);
  return out;
}

export type BrowseObservation = {
  /** Deliberate requests, in the order the agent printed them. */
  requests: string[];
  /** Every http(s) URL seen in the delta, deduped. Never interrupts. */
  urls: string[];
};

/** Read one screen delta. Pure: same inputs, same result. */
export function observeBrowseRequests(previous: string, current: string): BrowseObservation {
  const delta = addedLines(previous, current);
  const requests: string[] = [];
  const urls: string[] = [];
  for (const line of delta) {
    for (const m of line.matchAll(MARKER_RE)) {
      const url = tidyUrl(m[1] ?? "");
      if (url) requests.push(url);
    }
    // Strip the markers before harvesting, so a requested URL is not also
    // offered in the passive list.
    for (const m of line.replace(MARKER_RE, " ").matchAll(URL_RE)) {
      const url = tidyUrl(m[0]);
      if (isHttpUrl(url)) urls.push(url);
    }
  }
  return { requests: dedupe(requests), urls: dedupe(urls) };
}

/** Append newly seen URLs to a session's list, newest last, capped. */
export function mergeSeenUrls(seen: string[] | undefined, found: string[]): string[] {
  if (!found.length) return seen ?? [];
  const merged = dedupe([...(seen ?? []), ...found]);
  return merged.length > MAX_SEEN_URLS ? merged.slice(merged.length - MAX_SEEN_URLS) : merged;
}
