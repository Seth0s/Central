import { Moon, Settings, Sun } from "lucide-react";
import { UiIcon } from "../icons";
import { TERM_FONT_MAX, TERM_FONT_MIN } from "../lib/app-prefs";
import type { Theme } from "../lib/ui-model";

export default function SettingsModal({
  theme,
  onTheme,
  termFontSize,
  onTermFontSize,
  onClose,
}: {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  termFontSize: number;
  onTermFontSize: (px: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal settings-modal">
        <h3 id="settings-title">
          <UiIcon icon={Settings} size={18} />
          Configurações
        </h3>
        <p className="muted">Tema da interface</p>
        <div className="settings-theme" role="group" aria-label="Tema">
          <button type="button" className={theme === "dark" ? "on" : ""} onClick={() => onTheme("dark")}>
            <UiIcon icon={Moon} size={16} />
            Escuro
          </button>
          <button type="button" className={theme === "light" ? "on" : ""} onClick={() => onTheme("light")}>
            <UiIcon icon={Sun} size={16} />
            Claro
          </button>
        </div>
        <label className="field settings-font">
          <span className="field-label">Tamanho da fonte do terminal ({termFontSize}px)</span>
          <input
            type="range"
            min={TERM_FONT_MIN}
            max={TERM_FONT_MAX}
            step={1}
            value={termFontSize}
            onChange={(e) => onTermFontSize(Number(e.target.value))}
            aria-label="Tamanho da fonte do terminal"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
