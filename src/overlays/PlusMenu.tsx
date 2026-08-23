// The `+` popover of the right bar: one entry per tool kind.

import { TOOL_ICON, UiIcon } from "../icons";
import { TOOL_LABEL, type ToolKind } from "../lib/tool-model";

const ORDER: ToolKind[] = ["files", "canvas", "terminal", "changes", "browser"];

export default function PlusMenu({
  pos,
  onPick,
}: {
  pos: { top: number; left: number };
  onPick: (kind: ToolKind) => void;
}) {
  return (
    <div className="plus-pop" style={{ top: pos.top, left: pos.left }} role="menu">
      {ORDER.map((kind) => (
        <button key={kind} type="button" className="plus-item" onClick={() => onPick(kind)}>
          <UiIcon icon={TOOL_ICON[kind]} size={20} />
          {TOOL_LABEL[kind]}
        </button>
      ))}
    </div>
  );
}
