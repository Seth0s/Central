// In-app folder/file browser. GTK's native picker is avoided on purpose, so
// this walks the machine through `browse_dir`.

import { ArrowRight, FileText, Folder, FolderOpen, FolderUp } from "lucide-react";
import { UiIcon } from "../icons";
import type { DirEntry } from "../lib/commands";
import type { BrowseMode } from "../lib/ui-model";

export type BrowseState = {
  mode: BrowseMode;
  path: string;
  parent: string | null;
  entries: DirEntry[];
};

export default function BrowseModal({
  browse,
  onPath,
  onGo,
  onCancel,
  onPickFile,
  onConfirmDir,
}: {
  browse: BrowseState;
  onPath: (path: string) => void;
  onGo: (path: string) => void;
  onCancel: () => void;
  onPickFile: (entry: DirEntry) => void;
  onConfirmDir: () => void;
}) {
  const pickingMarkdown = browse.mode === "md";
  const visible = browse.entries.filter((e) =>
    pickingMarkdown ? e.is_dir || /\.(md|mmd|markdown|mdx)$/i.test(e.name) : e.is_dir,
  );

  return (
    <div className="modal-root browse">
      <div className="modal-backdrop" onClick={onCancel} />
      <div className="modal wide" role="dialog" aria-labelledby="browse-title">
        <h3 id="browse-title">
          <UiIcon icon={pickingMarkdown ? FileText : FolderOpen} size={20} />
          {pickingMarkdown ? "Abrir Markdown" : "Escolher pasta"}
        </h3>
        <p className="muted">Navega nas pastas da máquina e confirma. Sem o selector nativo do GTK.</p>
        <label className="field">
          <span className="field-label">
            <UiIcon icon={Folder} size={14} />
            Caminho
          </span>
          <div className="path-row">
            <input
              value={browse.path}
              onChange={(e) => onPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onGo(browse.path);
              }}
            />
            <button type="button" className="ghost" onClick={() => onGo(browse.path)}>
              <UiIcon icon={ArrowRight} size={14} />
              Ir
            </button>
          </div>
        </label>
        <div className="path-row" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="ghost"
            disabled={!browse.parent}
            onClick={() => browse.parent && onGo(browse.parent)}
          >
            <UiIcon icon={FolderUp} size={14} />
            Subir
          </button>
        </div>
        <ul className="browse-list">
          {visible.map((e) => (
            <li key={e.path}>
              <button
                type="button"
                onClick={() => {
                  if (e.is_dir) onGo(e.path);
                  else onPickFile(e);
                }}
              >
                <UiIcon icon={e.is_dir ? Folder : FileText} size={16} />
                {e.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancelar
          </button>
          {!pickingMarkdown && (
            <button type="button" className="primary" onClick={onConfirmDir}>
              Usar esta pasta
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
