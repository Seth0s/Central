// Window header: drag region and window controls. Theme lives in Settings.
// Drag + double-click maximize are handled in JS (not data-tauri-drag-region)
// so GTK/Wayland does not start a drag on the second click and snap the window back.

import { getCurrentWindow } from "@tauri-apps/api/window";
import WindowControls from "./WindowControls";

function isChromeControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(".win-controls, button, a, input"));
}

export default function TitleBar() {
  return (
    <header
      className="titlebar"
      onPointerDown={(e) => {
        if (e.button !== 0 || isChromeControl(e.target)) return;
        const win = getCurrentWindow();
        if (e.detail >= 2) {
          e.preventDefault();
          e.stopPropagation();
          void win.toggleMaximize();
          return;
        }
        void win.startDragging();
      }}
    >
      <div className="app-title">
        <img src="/brand/logo-mark.png" alt="" />
        <span>CentralByte</span>
      </div>
      <div className="titlebar-spacer" />
      <WindowControls />
    </header>
  );
}
