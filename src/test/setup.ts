// Test environment shims and per-test cleanup.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom has no layout engine, so it implements neither of these. The app calls
// them to keep the tab strip and the slash menu in view; no-ops are correct here.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// The browser panel measures its hole with a ResizeObserver to send bounds to
// the child webview. jsdom has no layout, so an inert stub is the right shim.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
});
