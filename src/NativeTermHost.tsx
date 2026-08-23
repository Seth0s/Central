import { useEffect, useRef } from "react";
import { api } from "./lib/commands";
import PtyTerm, { type PtyHandle } from "./PtyTerm";

type Props = {
  sessionId: string;
  className?: string;
  visible: boolean;
  interactive: boolean;
};

function readPalette(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const bg =
    cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)"
      ? cs.backgroundColor
      : cs.getPropertyValue("--bg-canvas").trim() || "#1e1e1e";
  const fg = cs.getPropertyValue("--text-bright").trim() || cs.color || "#f3f3f3";
  return { bg, fg };
}

function holeRect(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, ready: r.width >= 8 && r.height >= 8 };
}

function payloadKey(
  sessionId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  visible: boolean,
  interactive: boolean,
  bg: string,
  fg: string,
) {
  return `${sessionId}|${x}|${y}|${w}|${h}|${visible}|${interactive}|${bg}|${fg}`;
}

/** Linux: VTE in the GTK hole. Other OS: xterm.js until a native widget exists. */
export function TermView({
  sessionId,
  className,
  visible,
  interactive,
  native,
  onScreen,
  ptyRef,
}: {
  sessionId: string;
  className?: string;
  visible: boolean;
  interactive: boolean;
  native: boolean;
  onScreen?: (text: string) => void;
  ptyRef?: (handle: PtyHandle | null) => void;
}) {
  if (native) {
    return (
      <NativeTermHost
        sessionId={sessionId}
        className={className}
        visible={visible}
        interactive={interactive}
      />
    );
  }
  return (
    <PtyTerm
      sessionId={sessionId}
      className={className}
      readOnly={!interactive}
      onScreen={onScreen}
      ref={ptyRef}
    />
  );
}

export default function NativeTermHost({ sessionId, className, visible, interactive }: Props) {
  const holeRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  const interactiveRef = useRef(interactive);
  const lastKey = useRef("");
  visibleRef.current = visible;
  interactiveRef.current = interactive;

  useEffect(() => {
    const el = holeRef.current;
    if (!el) return;
    let alive = true;
    let raf = 0;
    lastKey.current = "";

    function report() {
      if (!alive) return;
      const host = holeRef.current;
      if (!host) return;
      const r = holeRect(host);
      const { bg, fg } = readPalette(host);
      const on = visibleRef.current && r.ready;
      const next = {
        sessionId,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        visible: on,
        interactive: on && interactiveRef.current,
        bg,
        fg,
      };
      const key = payloadKey(
        next.sessionId,
        next.x,
        next.y,
        next.w,
        next.h,
        next.visible,
        next.interactive,
        next.bg,
        next.fg,
      );
      if (key === lastKey.current) return;
      lastKey.current = key;
      void api.termSetBounds(next).catch(() => undefined);
    }

    function reportSoon() {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        report();
      });
    }

    const ro = new ResizeObserver(() => reportSoon());
    ro.observe(el);
    const app = el.closest(".app");
    if (app) ro.observe(app);
    window.addEventListener("resize", reportSoon);
    const themeRoot = el.closest("[data-theme]") ?? document.documentElement;
    const mo = new MutationObserver(reportSoon);
    mo.observe(themeRoot, { attributes: true, attributeFilter: ["data-theme"] });
    report();
    return () => {
      alive = false;
      if (raf) window.cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", reportSoon);
      lastKey.current = "";
      const r = holeRect(el);
      const { bg, fg } = readPalette(el);
      void api
        .termSetBounds({
          sessionId,
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          visible: false,
          interactive: false,
          bg,
          fg,
        })
        .catch(() => undefined);
    };
  }, [sessionId]);

  useEffect(() => {
    const host = holeRef.current;
    if (!host) return;
    const r = holeRect(host);
    const { bg, fg } = readPalette(host);
    const on = visible && r.ready;
    const next = {
      sessionId,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      visible: on,
      interactive: on && interactive,
      bg,
      fg,
    };
    const key = payloadKey(
      next.sessionId,
      next.x,
      next.y,
      next.w,
      next.h,
      next.visible,
      next.interactive,
      next.bg,
      next.fg,
    );
    if (key === lastKey.current) return;
    lastKey.current = key;
    void api.termSetBounds(next).catch(() => undefined);
  }, [sessionId, visible, interactive]);

  return <div className={className ?? "pty-host"} ref={holeRef} />;
}
