import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { UiIcon, fileIcon } from "./icons";
import type { DirEntry } from "./lib/commands";

type Props = {
  entries: DirEntry[];
  kids: Record<string, DirEntry[]>;
  open: string[];
  selectedPath?: string;
  onToggle: (ent: DirEntry) => void;
  onOpen: (ent: DirEntry) => void;
};

function treeRows(
  entries: DirEntry[],
  kids: Record<string, DirEntry[]>,
  open: string[],
  selectedPath: string | undefined,
  depth: number,
  onToggle: (ent: DirEntry) => void,
  onOpen: (ent: DirEntry) => void,
): ReactNode[] {
  const rows: ReactNode[] = [];
  for (const ent of entries) {
    const expanded = Boolean(ent.is_dir && open.includes(ent.path));
    const Icon = fileIcon(ent.name, ent.is_dir, expanded);
    rows.push(
      <li key={ent.path} role="treeitem" aria-expanded={ent.is_dir ? expanded : undefined}>
        <button
          type="button"
          className={`file-tree-row${ent.path === selectedPath ? " on" : ""}${ent.is_dir ? " dir" : ""}`}
          style={{ ["--tree-indent" as string]: `${depth * 12}px` }}
          onClick={() => (ent.is_dir ? onToggle(ent) : onOpen(ent))}
        >
          <span className={`file-tree-chevron${expanded ? " open" : ""}`}>
            {ent.is_dir ? <UiIcon icon={ChevronRight} size={12} /> : null}
          </span>
          <span className="file-tree-icon">
            <UiIcon icon={Icon} size={14} />
          </span>
          <span className="file-tree-name">{ent.name}</span>
        </button>
      </li>,
    );
    const nested = kids[ent.path];
    if (expanded && nested?.length) {
      rows.push(...treeRows(nested, kids, open, selectedPath, depth + 1, onToggle, onOpen));
    }
  }
  return rows;
}

export default function FileTree({ entries, kids, open, selectedPath, onToggle, onOpen }: Props) {
  return (
    <ul className="file-tree" role="tree">
      {treeRows(entries, kids, open, selectedPath, 0, onToggle, onOpen)}
    </ul>
  );
}
