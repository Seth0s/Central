import { Marked, type Tokens } from "marked";
import hljs from "highlight.js/lib/common";
import katex from "katex";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Even count of line-starting fences — skip highlight while a block is still open. */
export function fencesClosed(src: string): boolean {
  const ticks = src.match(/^ {0,3}```/gm);
  return !ticks || ticks.length % 2 === 0;
}

export type RenderedMarkdown = { html: string; mermaid: string[] };

function highlightFence(text: string, lang?: string): string {
  const name = (lang ?? "").trim().split(/\s+/)[0]?.replace(/[^a-zA-Z0-9+-]/g, "").toLowerCase();
  try {
    if (name && hljs.getLanguage(name)) {
      return hljs.highlight(text, { language: name }).value;
    }
    return hljs.highlightAuto(text).value;
  } catch {
    return escapeHtml(text);
  }
}

function codeRenderer(highlight: boolean) {
  return ({ text, lang, escaped }: Tokens.Code): string => {
    const body = highlight ? highlightFence(text, lang) : escaped ? text : escapeHtml(text);
    const langName = (lang ?? "").trim().split(/\s+/)[0] ?? "";
    const cls = langName ? ` language-${escapeHtml(langName)}` : "";
    return `<pre><code class="hljs${cls}">${body}</code></pre>\n`;
  };
}

function stash(src: string, re: RegExp, kind: "f" | "i"): { text: string; slots: string[] } {
  const slots: string[] = [];
  const text = src.replace(re, (m) => {
    const i = slots.length;
    slots.push(m);
    return `\u0000${kind}${i}\u0000`;
  });
  return { text, slots };
}

function restore(text: string, slots: string[], kind: "f" | "i"): string {
  const re = new RegExp(`\\u0000${kind}(\\d+)\\u0000`, "g");
  return text.replace(re, (_, n: string) => slots[Number(n)] ?? "");
}

function renderTex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode: display,
      throwOnError: false,
      output: "html",
    });
  } catch {
    return display ? `<pre>${escapeHtml(tex)}</pre>` : `<code>${escapeHtml(tex)}</code>`;
  }
}

function renderMath(src: string): string {
  let text = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => renderTex(tex, true));
  text = text.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, tex: string) => renderTex(tex, false));
  return text;
}

function renderDefinitionLists(src: string): string {
  return src.replace(
    /(^|\n)([^\n:]+)\n((?::[ \t]+[^\n]+(?:\n|$))+)/g,
    (all, pre: string, term: string, defs: string) => {
      const t = term.trim();
      if (!t || /^[-*#>`]/.test(t) || /^\d+\.\s/.test(t) || t.startsWith("```")) return all;
      const dds = [...defs.matchAll(/:[ \t]+([^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean);
      if (!dds.length) return all;
      const body = `<dt>${escapeHtml(t)}</dt>${dds.map((d) => `<dd>${escapeHtml(d)}</dd>`).join("")}`;
      return `${pre}<dl>\n${body}\n</dl>\n`;
    },
  );
}

function extractMermaid(src: string): { text: string; mermaid: string[] } {
  const mermaid: string[] = [];
  const text = src.replace(/```mermaid[ \t]*\n([\s\S]*?)```/gi, (_, body: string) => {
    const idx = mermaid.length;
    mermaid.push(body.replace(/\n$/, ""));
    return `\n\n<div class="mermaid-mount" data-m="${idx}"></div>\n\n`;
  });
  return { text, mermaid };
}

function parseMd(src: string, opts: { breaks: boolean; highlight: boolean }): string {
  const marked = new Marked({
    gfm: true,
    breaks: opts.breaks,
    renderer: { code: codeRenderer(opts.highlight) },
  });
  return marked.parse(src, { async: false }) as string;
}

export function renderMarkdown(src: string, opts: { breaks: boolean; highlight: boolean }): RenderedMarkdown {
  const extracted = extractMermaid(src);
  const fenced = stash(extracted.text, /^ {0,3}```[\s\S]*?```/gm, "f");
  const inlined = stash(fenced.text, /`[^`\n]+`/g, "i");
  const withMath = renderMath(inlined.text);
  const withDl = renderDefinitionLists(withMath);
  const restored = restore(restore(withDl, inlined.slots, "i"), fenced.slots, "f");
  return { html: parseMd(restored, opts), mermaid: extracted.mermaid };
}

export function renderChatMarkdown(src: string, streaming = false): RenderedMarkdown {
  const highlight = !streaming || fencesClosed(src);
  return renderMarkdown(src, { breaks: true, highlight });
}

export function renderCanvasMarkdown(src: string): RenderedMarkdown {
  return renderMarkdown(src, { breaks: false, highlight: true });
}
