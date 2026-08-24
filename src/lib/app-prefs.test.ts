// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  clampTermFontSize,
  readTermFontSize,
  TERM_FONT_DEFAULT,
  writeTermFontSize,
} from "./app-prefs";

describe("app-prefs term font", () => {
  it("clamps and persists", () => {
    localStorage.clear();
    expect(readTermFontSize()).toBe(TERM_FONT_DEFAULT);
    expect(clampTermFontSize(3)).toBe(9);
    expect(clampTermFontSize(99)).toBe(18);
    expect(writeTermFontSize(14)).toBe(14);
    expect(readTermFontSize()).toBe(14);
  });
});
