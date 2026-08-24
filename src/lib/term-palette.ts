/** VTE / gdk_rgba_parse accept #rgb / #rrggbb, not computed `rgb()` / `oklch()`. */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function cssHexToken(
  value: string,
  fallback: string,
): string {
  const raw = value.trim();
  return HEX.test(raw) ? raw : fallback;
}

/** Tokens from the theme, never `getComputedStyle(...).backgroundColor`. */
export function readPalette(el: HTMLElement): { bg: string; fg: string } {
  const cs = getComputedStyle(el);
  return {
    bg: cssHexToken(cs.getPropertyValue("--bg-canvas"), "#1e1e1e"),
    fg: cssHexToken(cs.getPropertyValue("--text-bright"), "#f3f3f3"),
  };
}
