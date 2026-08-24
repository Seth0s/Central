import { describe, expect, it } from "vitest";
import { cssHexToken } from "./term-palette";

describe("cssHexToken", () => {
  it("keeps #rrggbb theme tokens", () => {
    expect(cssHexToken("  #1e1e1e ", "#000000")).toBe("#1e1e1e");
    expect(cssHexToken("#f3f3f3", "#000000")).toBe("#f3f3f3");
  });

  it("rejects computed rgb/oklch that gdk_rgba_parse misses", () => {
    expect(cssHexToken("rgb(30, 30, 30)", "#1e1e1e")).toBe("#1e1e1e");
    expect(cssHexToken("rgb(30 30 30)", "#1e1e1e")).toBe("#1e1e1e");
    expect(cssHexToken("oklch(0.4 0.02 250)", "#1e1e1e")).toBe("#1e1e1e");
    expect(cssHexToken("", "#1e1e1e")).toBe("#1e1e1e");
  });
});
