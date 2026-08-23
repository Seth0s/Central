// Slash palette over the composer. The commands are the vendor's; the skin only
// classifies them (lib/slash.ts) and writes the chosen line into the PTY.

import type { Ref } from "react";
import type { SlashCmd } from "../lib/slash";

export default function SlashMenu({
  menuRef,
  pos,
  caption,
  items,
  index,
  onPick,
}: {
  menuRef: Ref<HTMLDivElement>;
  pos: { bottom: number; left: number };
  caption: string;
  items: SlashCmd[];
  index: number;
  onPick: (item: SlashCmd) => void;
}) {
  return (
    <div ref={menuRef} className="slash" style={{ bottom: pos.bottom, left: pos.left }}>
      <div className="cap">{caption}</div>
      {items.map((c, i) => (
        <div
          key={c.cmd}
          className={`item ${i === index ? "on" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(c);
          }}
        >
          <kbd>{c.cmd}</kbd>
          <span>{c.desc}</span>
        </div>
      ))}
    </div>
  );
}
