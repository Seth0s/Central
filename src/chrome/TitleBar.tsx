// Window header: drag region, theme toggle, window controls. No panel toggles
// live here by design (docs/architecture.md § Chrome).

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Moon, Sun } from "lucide-react";
import { UiIcon } from "../icons";
import type { Theme } from "../lib/ui-model";
import WindowControls from "./WindowControls";

export default function TitleBar({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={() => void getCurrentWindow().toggleMaximize()}
    >
      <div className="titlebar-spacer" data-tauri-drag-region />
      <button type="button" className="ghost" onClick={() => onTheme(theme === "dark" ? "light" : "dark")}>
        <UiIcon icon={theme === "dark" ? Sun : Moon} size={14} />
        Tema
      </button>
      <WindowControls />
    </header>
  );
}
