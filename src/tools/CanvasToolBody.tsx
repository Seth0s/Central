// Canvas tool: pick a workspace Markdown, then render it with the same
// pipeline as the chat (marked + highlight.js + KaTeX + Mermaid).

import { FileText } from "lucide-react";
import { UiIcon } from "../icons";
import CanvasPane from "../CanvasPane";
import type { DirEntry } from "../lib/commands";
import type { Theme } from "../lib/ui-model";
import type { CanvasTool } from "../lib/tool-model";

export default function CanvasToolBody({
  tab,
  cwd,
  theme,
  locked,
  mdFiles,
  onPick,
  onOpenFile,
  onClear,
}: {
  tab: CanvasTool;
  cwd: string;
  theme: Theme;
  locked: boolean;
  mdFiles: DirEntry[];
  onPick: () => void;
  onOpenFile: (path: string, name: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="tool-body">
      <div className="panel-head">
        Canvas
        <span className="muted canvas-file">{tab.title || "sem ficheiro"}</span>
        <span className="grow" />
        {!locked && (
          <button type="button" className="tiny" onClick={onPick}>
            Abrir .md
          </button>
        )}
        {tab.md && !locked && (
          <button type="button" className="tiny" onClick={onClear}>
            Lista
          </button>
        )}
      </div>
      {!tab.md && (
        <div className="md-picker">
          <p className="muted">
            {locked
              ? "Só o dono pode escolher o Markdown."
              : "Escolhe um Markdown do workspace ou abre um ficheiro."}
          </p>
          {!locked && mdFiles.length === 0 && (
            <button type="button" className="primary" onClick={onPick}>
              Abrir .md
            </button>
          )}
          {!locked && (
            <ul className="tree">
              {mdFiles.map((e) => (
                <li key={e.path} onClick={() => onOpenFile(e.path, e.name)}>
                  <UiIcon icon={FileText} size={16} />
                  {e.path.replace(cwd, "").replace(/^\//, "") || e.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {tab.md && <CanvasPane title={tab.title} markdown={tab.md} theme={theme} />}
    </div>
  );
}
