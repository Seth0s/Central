import { useRef } from "react";

type Props = {
  text: string;
  onChange: (next: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
};

function indentStops(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 2;
    else break;
  }
  return Math.floor(n / 2);
}

export default function FileView({ text, onChange, onSave, readOnly = false }: Props) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const guidesRef = useRef<HTMLDivElement>(null);
  const lines = text.length === 0 ? [""] : text.split("\n");

  function syncScroll(top: number) {
    if (gutterRef.current) gutterRef.current.scrollTop = top;
    if (guidesRef.current) guidesRef.current.scrollTop = top;
  }

  return (
    <div className="code-view">
      <div className="code-gutter" ref={gutterRef} aria-hidden="true">
        {lines.map((_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <div className="code-edit">
        <div className="code-guides" ref={guidesRef} aria-hidden="true">
          {lines.map((line, i) => (
            <div key={i} className="code-line">
              <span className="code-indents">
                {Array.from({ length: indentStops(line) }, (_, k) => (
                  <i key={k} />
                ))}
              </span>
            </div>
          ))}
        </div>
        <textarea
          className="code-editor"
          value={text}
          spellCheck={false}
          wrap="off"
          readOnly={readOnly}
          aria-label="Editor"
          onScroll={(e) => syncScroll(e.currentTarget.scrollTop)}
          onChange={(e) => {
            if (readOnly) return;
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (readOnly) return;
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              onSave?.();
              return;
            }
            if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            const el = e.currentTarget;
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const next = `${text.slice(0, start)}  ${text.slice(end)}`;
            onChange(next);
            requestAnimationFrame(() => {
              el.selectionStart = el.selectionEnd = start + 2;
            });
          }}
        />
      </div>
    </div>
  );
}
