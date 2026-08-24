// Edge/corner grips for undecorated windows. Wayland/GTK do not expose
// compositor resize unless we call startResizeDragging (capability required).

import { getCurrentWindow } from "@tauri-apps/api/window";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const EDGES: { dir: ResizeDirection; className: string }[] = [
  { dir: "North", className: "win-edge n" },
  { dir: "South", className: "win-edge s" },
  { dir: "West", className: "win-edge w" },
  { dir: "East", className: "win-edge e" },
  { dir: "NorthWest", className: "win-edge nw" },
  { dir: "NorthEast", className: "win-edge ne" },
  { dir: "SouthWest", className: "win-edge sw" },
  { dir: "SouthEast", className: "win-edge se" },
];

export default function WindowResizeEdges() {
  return (
    <div className="win-edges" aria-hidden>
      {EDGES.map(({ dir, className }) => (
        <div
          key={dir}
          className={className}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void getCurrentWindow().startResizeDragging(dir);
          }}
        />
      ))}
    </div>
  );
}
