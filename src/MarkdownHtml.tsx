import { useEffect, useId, useRef, useState } from "react";
import { escapeHtml } from "./lib/markdown";
import "katex/dist/katex.min.css";

type Props = { html: string; mermaid: string[]; className?: string; theme?: "dark" | "light" };

function useDocTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
  );
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setTheme(el.getAttribute("data-theme") === "light" ? "light" : "dark");
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

export default function MarkdownHtml({ html, mermaid, className, theme: themeProp }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");
  const docTheme = useDocTheme();
  const theme = themeProp ?? docTheme;

  useEffect(() => {
    if (!mermaid.length) return;
    let cancelled = false;
    void import("mermaid")
      .then(async (mod) => {
        const mermaidApi = mod.default;
        mermaidApi.initialize({
          startOnLoad: false,
          theme: theme === "light" ? "default" : "dark",
        });
        await Promise.all(
          mermaid.map(async (code, i) => {
            const id = `mmd-${uid}-${i}`;
            const { svg } = await mermaidApi.render(id, code);
            if (cancelled) return;
            const el = host.current?.querySelector(`[data-m="${i}"]`);
            if (el) el.innerHTML = svg;
          }),
        );
      })
      .catch(() => {
        mermaid.forEach((code, i) => {
          const el = host.current?.querySelector(`[data-m="${i}"]`);
          if (el) el.innerHTML = `<pre>${escapeHtml(code)}</pre>`;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [html, mermaid, theme, uid]);

  return <div ref={host} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
