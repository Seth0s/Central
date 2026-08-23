// Minimise / maximise / close for the undecorated window.

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { UiIcon } from "../icons";

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then((v) => {
      if (!cancelled) setMaximized(v);
    });
    void win.onResized(() => {
      void win.isMaximized().then((v) => {
        if (!cancelled) setMaximized(v);
      });
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="win-controls">
      <button type="button" className="win-btn" title="Minimizar" onClick={() => void getCurrentWindow().minimize()}>
        <UiIcon icon={Minus} size={14} />
      </button>
      <button
        type="button"
        className="win-btn"
        title={maximized ? "Restaurar" : "Maximizar"}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        <UiIcon icon={maximized ? Copy : Square} size={13} />
      </button>
      <button type="button" className="win-btn close" title="Fechar" onClick={() => void getCurrentWindow().close()}>
        <UiIcon icon={X} size={14} />
      </button>
    </div>
  );
}
