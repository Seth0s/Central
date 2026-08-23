import { useMemo } from "react";
import { renderCanvasMarkdown } from "./lib/markdown";
import MarkdownHtml from "./MarkdownHtml";

type Props = { title: string; markdown: string; theme: "dark" | "light" };

export default function CanvasPane({ title, markdown, theme }: Props) {
  const parsed = useMemo(() => renderCanvasMarkdown(markdown), [markdown]);

  if (!markdown.trim()) {
    return (
      <div className="canvas-body">
        <p className="muted">Abre um ficheiro Markdown para ver o preview.</p>
      </div>
    );
  }

  return (
    <div className="canvas-body">
      <div className="md">
        <p className="muted">{title}</p>
        <MarkdownHtml html={parsed.html} mermaid={parsed.mermaid} theme={theme} />
      </div>
    </div>
  );
}
