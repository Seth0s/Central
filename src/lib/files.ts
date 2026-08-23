export function isMarkdownName(name: string): boolean {
  return /\.(md|mmd|markdown|mdx)$/i.test(name);
}

export function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name);
}

export function nextUntitledName(taken: string[]): string {
  const set = new Set(taken);
  if (!set.has("sem-titulo.md")) return "sem-titulo.md";
  for (let i = 2; i < 100; i += 1) {
    const name = `sem-titulo-${i}.md`;
    if (!set.has(name)) return name;
  }
  return `sem-titulo-${Date.now()}.md`;
}
