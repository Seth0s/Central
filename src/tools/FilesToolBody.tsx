// Files tool: breadcrumb + cascading tree + editor. Markdown opens in GFM
// preview, images render in place, everything else is the code editor.

import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronRight, Code2, Eye, Files } from "lucide-react";
import { UiIcon } from "../icons";
import { ResizeHandle } from "../layout";
import FileTree from "../FileTree";
import FileView from "../FileView";
import CanvasPane from "../CanvasPane";
import type { DirEntry } from "../lib/commands";
import { isMarkdownName } from "../lib/files";
import { fileCrumbs } from "../lib/paths";
import { FILES_EXPLORER_MAX, FILES_EXPLORER_MIN } from "../lib/ui-metrics";
import type { Theme } from "../lib/ui-model";
import type { FilesTool } from "../lib/tool-model";

export default function FilesToolBody({
  tab,
  cwd,
  theme,
  locked,
  explorerW,
  onExplorerW,
  onPatch,
  onReveal,
  onToggleDir,
  onOpenEntry,
  onNewFile,
  onSave,
}: {
  tab: FilesTool;
  cwd: string;
  theme: Theme;
  locked: boolean;
  explorerW: number;
  onExplorerW: (px: number) => void;
  onPatch: (patch: Partial<FilesTool>) => void;
  onReveal: (dir?: string) => void;
  onToggleDir: (ent: DirEntry) => void;
  onOpenEntry: (ent: DirEntry) => void;
  onNewFile: () => void;
  onSave: () => void;
}) {
  if (!cwd) {
    return (
      <div className="tool-body files-work">
        <p className="muted tool-empty">Abre uma pasta.</p>
      </div>
    );
  }

  const dirty = tab.content != null && tab.content !== tab.saved;

  return (
    <div className="tool-body files-work">
      <div className="files-head">
        <nav className="crumbs" aria-label="Caminho">
          {fileCrumbs(cwd, tab.dir, tab.file).map((c, i) => (
            <span key={`${c.label}-${i}`} className="crumb-wrap">
              {i > 0 && (
                <span className="crumb-sep">
                  <UiIcon icon={ChevronRight} size={12} />
                </span>
              )}
              <button
                type="button"
                className={`crumb${c.file ? " file" : ""}`}
                onClick={() => {
                  if (c.file) return;
                  onReveal(c.dir);
                }}
              >
                {c.label}
                {c.file && dirty && (
                  <span className="crumb-dirty" title="Por guardar">
                    •
                  </span>
                )}
              </button>
            </span>
          ))}
        </nav>
        <span className="grow" />
        <button
          type="button"
          className={`tiny ${tab.explorer ? "on" : ""}`}
          title={tab.explorer ? "Esconder explorador" : "Mostrar explorador"}
          aria-pressed={tab.explorer}
          onClick={() => onPatch({ explorer: !tab.explorer })}
        >
          <UiIcon icon={Files} size={14} />
        </button>
        {tab.file && isMarkdownName(tab.file) && (
          <button
            type="button"
            className="tiny"
            title={tab.view === "preview" ? "Ver código" : "Ver preview"}
            onClick={() => onPatch({ view: tab.view === "preview" ? "code" : "preview" })}
          >
            <UiIcon icon={tab.view === "preview" ? Code2 : Eye} size={14} />
          </button>
        )}
      </div>
      <div className="files-split">
        {tab.explorer && (
          <div className="files-explorer" style={{ width: explorerW }}>
            <div className="files-explorer-scroll">
              <FileTree
                entries={tab.entries}
                kids={tab.kids}
                open={tab.open}
                selectedPath={tab.filePath}
                onToggle={onToggleDir}
                onOpen={onOpenEntry}
              />
            </div>
            <ResizeHandle
              axis="x"
              value={explorerW}
              min={FILES_EXPLORER_MIN}
              max={FILES_EXPLORER_MAX}
              onChange={onExplorerW}
            />
          </div>
        )}
        <div className="files-editor">
          {!tab.file ? (
            <div className="files-empty">
              <p>Abre um ficheiro para começar</p>
              <button type="button" className="ghost" disabled={locked} onClick={onNewFile}>
                Novo ficheiro
              </button>
            </div>
          ) : tab.media === "image" && tab.filePath ? (
            <div className="file-image">
              <img src={convertFileSrc(tab.filePath)} alt={tab.file} />
            </div>
          ) : tab.view === "preview" && isMarkdownName(tab.file) && tab.content != null ? (
            <CanvasPane title={tab.file} markdown={tab.content} theme={theme} />
          ) : (
            <FileView
              text={tab.content ?? ""}
              readOnly={locked}
              onChange={(content) => onPatch({ content })}
              onSave={onSave}
            />
          )}
        </div>
      </div>
    </div>
  );
}
