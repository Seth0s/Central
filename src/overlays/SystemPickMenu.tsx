// Skin picker for /model, /effort and /autocompact. Choosing writes the vendor
// slash into the TUI — it never relaunches the process.

export default function SystemPickMenu({
  pos,
  title,
  options,
  current,
  onPick,
}: {
  pos: { bottom: number; left: number };
  title: string;
  options: { id: string; label: string }[];
  current?: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="slash" style={{ bottom: pos.bottom, left: pos.left }} role="listbox">
      <div className="cap">{title}</div>
      {options.map((opt) => {
        const on = current && (current === opt.id || current.toLowerCase().includes(opt.id));
        return (
          <div
            key={opt.id}
            className={`item ${on ? "on" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(opt.id);
            }}
          >
            <kbd>{opt.label}</kbd>
            <span>{opt.id}</span>
          </div>
        );
      })}
    </div>
  );
}
