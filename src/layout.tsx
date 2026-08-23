import { useCallback, useState, type ReactNode, type Ref } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { UiIcon } from "./icons";

export type Side = "left" | "right";

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function useStoredPx(key: string, initial: number, min: number, max: number): [number, (n: number) => void] {
  const [value, setValue] = useState(() => {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? clamp(raw, min, max) : initial;
  });
  const set = useCallback(
    (n: number) => {
      const next = clamp(n, min, max);
      setValue(next);
      localStorage.setItem(key, String(next));
    },
    [key, min, max],
  );
  return [value, set];
}

export function useStoredOpen(key: string, initial: boolean): [boolean, (v: boolean | ((p: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(() => {
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return initial;
  });
  const set = useCallback(
    (v: boolean | ((p: boolean) => boolean)) => {
      setOpen((prev) => {
        const next = typeof v === "function" ? v(prev) : v;
        localStorage.setItem(key, next ? "1" : "0");
        return next;
      });
    },
    [key],
  );
  return [open, set];
}

export function ResizeHandle({
  axis,
  value,
  min,
  max,
  invert,
  onChange,
}: {
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div
      className={axis === "x" ? "split-x" : "split-y"}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      onPointerDown={(e) => {
        e.preventDefault();
        const start = axis === "x" ? e.clientX : e.clientY;
        const origin = value;
        document.body.classList.add(axis === "x" ? "resizing-x" : "resizing-y");
        const move = (ev: PointerEvent) => {
          const now = axis === "x" ? ev.clientX : ev.clientY;
          const delta = invert ? start - now : now - start;
          onChange(clamp(origin + delta, min, max));
        };
        const up = () => {
          document.body.classList.remove("resizing-x", "resizing-y");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}

export function SidebarToggle({
  side,
  open,
  onClick,
  className,
}: {
  side: Side;
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  const title =
    side === "left"
      ? open
        ? "Fechar barra esquerda"
        : "Abrir barra esquerda"
      : open
        ? "Fechar barra direita"
        : "Abrir barra direita";
  return (
    <button
      type="button"
      className={`side-toggle ${open ? "on" : ""} ${className ?? ""}`.trim()}
      title={title}
      aria-pressed={open}
      aria-label={title}
      onClick={onClick}
    >
      <UiIcon icon={side === "left" ? PanelLeft : PanelRight} size={14} />
    </button>
  );
}

/** Open pane only. Closed columns are 0px on the app grid — no rail. */
export function SidebarPanel({
  side,
  width,
  min,
  max,
  onResize,
  children,
  header,
  chromeRef,
  className,
  label,
}: {
  side: Side;
  width: number;
  min: number;
  max: number;
  onResize: (n: number) => void;
  children: ReactNode;
  header?: ReactNode;
  chromeRef?: Ref<HTMLDivElement>;
  className?: string;
  label: string;
}) {
  return (
    <aside className={`side-panel side-${side} ${className ?? ""}`} aria-label={label}>
      {header ? (
        <div className="side-chrome" ref={chromeRef}>
          {header}
        </div>
      ) : null}
      <div className="side-body">{children}</div>
      <ResizeHandle
        axis="x"
        value={width}
        min={min}
        max={max}
        invert={side === "right"}
        onChange={onResize}
      />
    </aside>
  );
}
