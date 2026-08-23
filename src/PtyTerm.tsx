import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { api } from "./lib/commands";
import { snapshotViewport } from "./lib/pty_translate";

/** Resolved once per window; the Rust side owns the flag. */
let statsOn: boolean | null = null;
void api
  .statsEnabled()
  .then((on) => {
    statsOn = on;
  })
  .catch(() => {
    statsOn = false;
  });

/** Mirrors the native arm's NDJSON, so one file describes both. */
function stat(event: string, fields: string) {
  if (!statsOn) return;
  void api.statsLog(event, fields).catch(() => undefined);
}

export type PtyHandle = { write: (chunk: string) => void };

/** Matches SNAPSHOT_DEBOUNCE_MS in src-tauri/src/term.rs; keep the two equal. */
const SNAPSHOT_THROTTLE_MS = 80;

type Props = {
  sessionId: string;
  className?: string;
  readOnly?: boolean;
  onScreen?: (text: string) => void;
};

function readTermTheme(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return {
    background: cs.backgroundColor,
    foreground: cs.getPropertyValue("--text-bright").trim() || "#f3f3f3",
  };
}

function snapshotTerm(term: Terminal): string {
  const buf = term.buffer.active;
  return snapshotViewport({
    rows: term.rows,
    viewportY: buf.viewportY,
    getLine: (y) => buf.getLine(y),
  });
}

const PtyTerm = forwardRef<PtyHandle, Props>(function PtyTerm(
  { sessionId, className, readOnly = false, onScreen },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const readOnlyRef = useRef(readOnly);
  const onScreenRef = useRef(onScreen);
  const pendingRef = useRef<string[]>([]);
  const snapTimer = useRef<number>(0);
  const snapDirty = useRef(false);
  const resizeTimer = useRef<number>(0);
  const lastSnap = useRef("");
  const lastSize = useRef({ cols: 0, rows: 0 });
  const rendererRef = useRef<"webgl" | "dom">("dom");
  const alive = useRef(true);
  readOnlyRef.current = readOnly;
  onScreenRef.current = onScreen;

  const emitSnapshot = (term: Terminal) => {
    if (!alive.current || !termRef.current) return;
    let text = "";
    const t0 = performance.now();
    try {
      text = snapshotTerm(term);
    } catch {
      return;
    }
    const changed = text !== lastSnap.current;
    stat(
      "xterm_snapshot",
      `"session":"${sessionId}","chars":${text.length},"snapshot_us":${Math.round((performance.now() - t0) * 1000)},"changed":${changed}`,
    );
    if (!changed) return;
    lastSnap.current = text;
    onScreenRef.current?.(text);
  };

  // A throttle, not a trailing debounce: the timer is armed by the first write
  // of a burst and never pushed back by later ones. A trailing debounce would
  // starve the chat view for as long as output kept arriving, which is exactly
  // when it matters — and it is the same SnapshotClock rule the native arm
  // follows (src-tauri/src/term.rs), so the two are comparable.
  const scheduleSnapshot = (term: Terminal) => {
    snapDirty.current = true;
    if (snapTimer.current) return;
    snapTimer.current = window.setTimeout(() => {
      snapTimer.current = 0;
      if (!snapDirty.current) return;
      snapDirty.current = false;
      emitSnapshot(term);
    }, SNAPSHOT_THROTTLE_MS);
  };

  const writeToTerm = (term: Terminal, chunk: string) => {
    // xterm calls back once the chunk is parsed and rendered, so this brackets
    // the real cost of the renderer — the number to compare with vte_feed.
    const t0 = performance.now();
    term.write(chunk, () => {
      stat(
        "xterm_feed",
        `"session":"${sessionId}","bytes":${chunk.length},"feed_us":${Math.round((performance.now() - t0) * 1000)},"renderer":"${rendererRef.current}"`,
      );
      if (!alive.current) return;
      scheduleSnapshot(term);
    });
  };

  useImperativeHandle(ref, () => ({
    write(chunk: string) {
      const term = termRef.current;
      if (!term) {
        pendingRef.current.push(chunk);
        return;
      }
      writeToTerm(term, chunk);
    },
  }));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    alive.current = true;
    lastSnap.current = "";
    lastSize.current = { cols: 0, rows: 0 };
    el.replaceChildren();
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 2000,
      theme: readTermTheme(el),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // The DOM renderer drops rows under a firehose and in full-screen TUIs. WebGL
    // must be loaded after open(), and it throws where WebGL2 is unavailable or
    // when the context is lost — fall back to the DOM renderer instead of dying.
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl?.dispose();
        webgl = null;
        rendererRef.current = "dom";
      });
      term.loadAddon(webgl);
      rendererRef.current = "webgl";
    } catch {
      webgl?.dispose();
      webgl = null;
      rendererRef.current = "dom";
    }
    term.onData((data) => {
      if (readOnlyRef.current) return;
      stat("key", `"session":"${sessionId}","arm":"xterm","chars":${data.length}`);
      void api.sessionWrite(sessionId, data);
    });

    const applySize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width < 8 || height < 8) return;
      term.options.theme = readTermTheme(el);
      fit.fit();
      const cols = term.cols;
      const rows = term.rows;
      if (cols === lastSize.current.cols && rows === lastSize.current.rows) return;
      lastSize.current = { cols, rows };
      void api.sessionResize(sessionId, cols, rows);
    };

    const onResize = () => {
      if (resizeTimer.current) window.cancelAnimationFrame(resizeTimer.current);
      resizeTimer.current = window.requestAnimationFrame(applySize);
    };

    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    const themeRoot = el.closest("[data-theme]") ?? document.documentElement;
    const mo = new MutationObserver(onResize);
    mo.observe(themeRoot, { attributes: true, attributeFilter: ["data-theme"] });
    applySize();

    termRef.current = term;
    const queued = pendingRef.current.splice(0);
    for (const chunk of queued) writeToTerm(term, chunk);
    return () => {
      alive.current = false;
      if (snapTimer.current) window.clearTimeout(snapTimer.current);
      if (resizeTimer.current) window.cancelAnimationFrame(resizeTimer.current);
      ro.disconnect();
      mo.disconnect();
      // Dispose the addon before the terminal: it holds the GL context.
      webgl?.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.disableStdin = readOnly;
  }, [readOnly]);

  return <div className={className ?? "pty-host"} ref={host} />;
});

export default PtyTerm;
