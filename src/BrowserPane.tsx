import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  type BrowserBookmark,
  type BrowserCurrent,
  type BrowserPushKind,
  type BrowserUiEvent,
} from "./lib/commands";
import { UiIcon } from "./icons";
import {
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  MousePointer2,
  RotateCw,
  SquareTerminal,
  Star,
  X,
} from "lucide-react";

type DrawerTab = "console" | "network" | "scripts";

const PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: "fluid", label: "Fluido", w: 0, h: 0 },
  { id: "phone", label: "Telemóvel", w: 390, h: 844 },
  { id: "tablet", label: "Tablet", w: 768, h: 1024 },
];

export default function BrowserPane({
  sessionId,
  occluded,
  onToast,
  readOnly = false,
  agentUrls = [],
}: {
  sessionId: string | null;
  occluded: boolean;
  onToast: (msg: string) => void;
  readOnly?: boolean;
  /** URLs the focused agent printed. Offered, never opened on its own — this is
   *  the only path on providers that take no system prompt at spawn. */
  agentUrls?: string[];
}) {
  const holeRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(sessionId);
  const pickBusy = useRef(false);
  const seenPick = useRef<string | null>(null);
  sessionRef.current = sessionId;

  const [bar, setBar] = useState("about:blank");
  const [title, setTitle] = useState("");
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [consoleLines, setConsoleLines] = useState<BrowserCurrent["console"]>([]);
  const [network, setNetwork] = useState<BrowserCurrent["network"]>([]);
  const [scripts, setScripts] = useState<string[]>([]);
  const [design, setDesign] = useState(false);
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>([]);
  const [bookmarkBar, setBookmarkBar] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<DrawerTab>("console");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);

  function apply(cur: BrowserCurrent, fromPoll = false) {
    if (!fromPoll || document.activeElement !== urlRef.current) {
      setBar(cur.url);
    }
    setTitle(cur.title);
    setViewport({ w: cur.viewport_w, h: cur.viewport_h });
    setConsoleLines(cur.console);
    setNetwork(cur.network);
    setScripts(cur.scripts ?? []);
    setDesign(cur.design);
    setBookmarks(cur.bookmarks ?? []);
    setBookmarkBar(cur.bookmark_bar);
    if (cur.pick) {
      void takePick(cur.pick.selector, cur.pick.html);
    } else {
      seenPick.current = null;
    }
  }

  async function takePick(selector: string, html: string) {
    const key = `${selector}\n${html.slice(0, 80)}`;
    if (seenPick.current === key || pickBusy.current) return;
    seenPick.current = key;
    pickBusy.current = true;
    try {
      const sid = sessionRef.current;
      if (!sid) {
        onToast("Abre uma sessão para enviar o componente.");
        await api.browserAckPick().catch(() => undefined);
        return;
      }
      await api.browserPushToSession(sid, "design");
      onToast("Componente enviado ao chat.");
    } catch (e) {
      onToast(String(e));
      await api.browserAckPick().catch(() => undefined);
    } finally {
      pickBusy.current = false;
    }
  }

  function reportBounds() {
    const el = holeRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void api.browserSetBounds(r.x, r.y, r.width, r.height).catch(() => undefined);
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      unlisten = await listen<BrowserUiEvent>("browser-event", (ev) => {
        const p = ev.payload;
        if (p.type === "navigated") {
          if (document.activeElement !== urlRef.current) setBar(p.url);
          setTitle(p.title);
        }
      });
      try {
        await api.browserEnsure();
        const cur = await api.browserCurrent();
        if (!cancelled) apply(cur);
        reportBounds();
      } catch (e) {
        if (!cancelled) onToast(String(e));
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      void api.browserSetVisible(false).catch(() => undefined);
    };
  }, [onToast]);

  useEffect(() => {
    void api.browserSetVisible(!occluded).catch(() => undefined);
    if (!occluded) reportBounds();
  }, [occluded]);

  useEffect(() => {
    const el = holeRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => reportBounds());
    ro.observe(el);
    window.addEventListener("resize", reportBounds);
    const poll = window.setInterval(() => {
      void api.browserCurrent().then((cur) => apply(cur, true)).catch(() => undefined);
    }, design ? 350 : 900);
    reportBounds();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", reportBounds);
      window.clearInterval(poll);
    };
  }, [design]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        void toggleDesign();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [design]);

  useEffect(() => {
    if (!menu) return;
    function onClick() {
      setMenu(false);
    }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [menu]);

  async function go(raw?: string) {
    const url = (raw ?? bar).trim();
    if (!url) return;
    setBusy(true);
    try {
      apply(await api.browserNavigate(url));
      reportBounds();
    } catch (e) {
      onToast(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    try {
      apply(await api.browserReload());
    } catch (e) {
      onToast(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function historyGo(back: boolean) {
    try {
      apply(await api.browserHistoryGo(back));
    } catch (e) {
      onToast(String(e));
    }
  }

  async function toggleDesign() {
    try {
      apply(await api.browserSetDesign(!design));
    } catch (e) {
      onToast(String(e));
    }
  }

  async function toggleStar() {
    try {
      apply(await api.browserToggleBookmark());
    } catch (e) {
      onToast(String(e));
    }
  }

  async function setVp(w: number, h: number) {
    try {
      apply(await api.browserSetViewport(w, h));
      reportBounds();
      setMenu(false);
    } catch (e) {
      onToast(String(e));
    }
  }

  async function push(kind: BrowserPushKind) {
    if (!sessionId) {
      onToast("Abre uma sessão primeiro.");
      return;
    }
    try {
      await api.browserPushToSession(sessionId, kind);
      onToast("Enviado à sessão.");
    } catch (e) {
      onToast(String(e));
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(bar);
      onToast("URL copiado.");
    } catch (e) {
      onToast(String(e));
    }
    setMenu(false);
  }

  async function inspect() {
    try {
      await api.browserOpenDevtools();
    } catch (e) {
      onToast(String(e));
    }
    setMenu(false);
  }

  async function clearData() {
    try {
      await api.browserClearData();
      onToast("Dados do navegador limpos.");
    } catch (e) {
      onToast(String(e));
    }
    setMenu(false);
  }

  async function toggleBookmarkBar() {
    try {
      apply(await api.browserSetBookmarkBar(!bookmarkBar));
    } catch (e) {
      onToast(String(e));
    }
    setMenu(false);
  }

  const starred = bookmarks.some((b) => b.url === bar);
  const presetOn = PRESETS.find((p) => p.w === viewport.w && p.h === viewport.h)?.id ?? "fluid";
  const errors = consoleLines.filter((l) => l.level.includes("error")).length;
  const warns = consoleLines.filter((l) => l.level.includes("warn")).length;
  const locked = busy || readOnly;

  return (
    <div className="tool-body browser-work" aria-label={title || "Navegador"}>
      <div className="browser-chrome">
        <button type="button" className="browser-icon" disabled={locked} title="Anterior" onClick={() => void historyGo(true)}>
          <UiIcon icon={ChevronLeft} size={16} />
        </button>
        <button type="button" className="browser-icon" disabled={locked} title="Seguinte" onClick={() => void historyGo(false)}>
          <UiIcon icon={ChevronRight} size={16} />
        </button>
        <button type="button" className="browser-icon" disabled={locked} title="Recarregar" onClick={() => void reload()}>
          <UiIcon icon={RotateCw} size={14} />
        </button>
        <input
          ref={urlRef}
          value={bar}
          spellCheck={false}
          disabled={locked}
          readOnly={readOnly}
          onChange={(e) => setBar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void go();
          }}
          aria-label="URL"
        />
        <button
          type="button"
          className={`browser-icon${starred ? " on" : ""}`}
          disabled={locked}
          title={starred ? "Remover favorito" : "Adicionar favorito"}
          onClick={() => void toggleStar()}
        >
          <UiIcon icon={Star} size={14} fill={starred ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          className={`browser-design${design ? " on" : ""}`}
          disabled={locked}
          title="Design Mode (Ctrl+Shift+D)"
          onClick={() => void toggleDesign()}
        >
          <UiIcon icon={MousePointer2} size={14} />
          Design
          {design && <UiIcon icon={X} size={12} />}
        </button>
        <button
          type="button"
          className={`browser-icon${drawer ? " on" : ""}`}
          title="Consola"
          onClick={() => setDrawer((v) => !v)}
        >
          <UiIcon icon={SquareTerminal} size={15} />
        </button>
        <div className="browser-menu-wrap">
          <button
            type="button"
            className={`browser-icon${menu ? " on" : ""}`}
            title="Opções"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((v) => !v);
            }}
          >
            <UiIcon icon={EllipsisVertical} size={15} />
          </button>
          {menu && (
            <div className="browser-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => void copyUrl()}>
                Copiar URL
              </button>
              <button type="button" disabled={readOnly} onClick={() => void inspect()}>
                Inspecionar (DevTools)
              </button>
              <button type="button" disabled={readOnly} onClick={() => void toggleBookmarkBar()}>
                {bookmarkBar ? "Ocultar favoritos" : "Mostrar favoritos"}
              </button>
              <div className="browser-menu-sep" />
              <span className="browser-menu-label">Viewport</span>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={readOnly}
                  className={presetOn === p.id ? "on" : ""}
                  onClick={() => void setVp(p.w, p.h)}
                >
                  {p.label}
                  {viewport.w && viewport.h && p.id !== "fluid" ? "" : p.id === "fluid" ? " (página)" : ""}
                </button>
              ))}
              <div className="browser-menu-sep" />
              <button type="button" disabled={readOnly} onClick={() => void push("url")}>
                Enviar URL ao chat
              </button>
              <button type="button" disabled={readOnly} onClick={() => void push("snapshot")}>
                Enviar snapshot ao chat
              </button>
              <div className="browser-menu-sep" />
              <button type="button" className="danger" disabled={readOnly} onClick={() => void clearData()}>
                Limpar cookies e cache
              </button>
            </div>
          )}
        </div>
      </div>
      {agentUrls.length > 0 && (
        <div className="browser-bookmarks agent-urls">
          <span className="muted">Do agente:</span>
          {agentUrls.map((url) => (
            <button
              key={url}
              type="button"
              className="tiny"
              title={url}
              disabled={readOnly}
              onClick={() => void go(url)}
            >
              {url.replace(/^https?:\/\//, "").slice(0, 44)}
            </button>
          ))}
        </div>
      )}
      {bookmarkBar && (
        <div className="browser-bookmarks">
          {bookmarks.length === 0 && <span className="muted">Sem favoritos — estrela na barra.</span>}
          {bookmarks.map((b) => (
            <button key={b.url} type="button" className="tiny" title={b.url} disabled={readOnly} onClick={() => void go(b.url)}>
              {b.title || b.url}
            </button>
          ))}
        </div>
      )}
      <div className="browser-stage">
        <div className="browser-hole" ref={holeRef} aria-hidden />
        {drawer && (
          <div className="browser-drawer">
            <div className="browser-panel-tabs">
              <button type="button" className={`tiny${tab === "console" ? " on" : ""}`} onClick={() => setTab("console")}>
                Consola
                {errors > 0 && <span className="browser-badge err">{errors}</span>}
                {warns > 0 && <span className="browser-badge warn">{warns}</span>}
              </button>
              <button type="button" className={`tiny${tab === "network" ? " on" : ""}`} onClick={() => setTab("network")}>
                Rede
              </button>
              <button type="button" className={`tiny${tab === "scripts" ? " on" : ""}`} onClick={() => setTab("scripts")}>
                Scripts
              </button>
              <span className="browser-drawer-grow" />
              {tab === "console" && (
                <button type="button" className="tiny" onClick={() => void push("console")}>
                  Enviar
                </button>
              )}
              {tab === "network" && (
                <button type="button" className="tiny" onClick={() => void push("network")}>
                  Enviar
                </button>
              )}
              {tab === "scripts" && (
                <button type="button" className="tiny" onClick={() => void push("scripts")}>
                  Enviar
                </button>
              )}
              <button type="button" className="browser-icon" title="Fechar" onClick={() => setDrawer(false)}>
                <UiIcon icon={X} size={14} />
              </button>
            </div>
            {tab === "console" && (
              <ul className="browser-log">
                {consoleLines.length === 0 && <li className="muted">Sem mensagens ainda.</li>}
                {consoleLines.map((line, i) => (
                  <li
                    key={`${i}-${line.text.slice(0, 24)}`}
                    className={line.level.includes("error") ? "err" : line.level.includes("warn") ? "warn" : ""}
                  >
                    <span className="browser-lvl">{line.level}</span> {line.text}
                  </li>
                ))}
              </ul>
            )}
            {tab === "network" && (
              <ul className="browser-log">
                {network.length === 0 && (
                  <li className="muted">Lista de URLs (PerformanceObserver). Sem headers nem waterfall.</li>
                )}
                {network.map((line, i) => (
                  <li key={`${i}-${line.url.slice(0, 32)}`}>
                    <span className="browser-lvl">
                      {line.kind === "request" ? line.method ?? "GET" : line.status ?? "—"}
                    </span>{" "}
                    {line.url}
                  </li>
                ))}
              </ul>
            )}
            {tab === "scripts" && (
              <ul className="browser-log">
                {scripts.length === 0 && (
                  <li className="muted">Scripts da página. Breakpoints: Inspecionar no menu.</li>
                )}
                {scripts.map((src, i) => (
                  <li key={`${i}-${src.slice(0, 40)}`}>{src}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
