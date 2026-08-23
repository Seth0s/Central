import { stripAnsi } from "./ansi.ts";
import { normalizeSnapshot, type ScreenView } from "./screen.ts";

export function translateFixture(chunk: string): string {
  return stripAnsi(chunk);
}

export function interpretFixtureScreen(snapshot: string): ScreenView {
  return { display: normalizeSnapshot(snapshot), warn: false };
}
