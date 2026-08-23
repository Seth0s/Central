import type { LucideIcon, LucideProps } from "lucide-react";
import {
  Bot,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileType,
  Files,
  FlaskConical,
  Folder,
  FolderOpen,
  GitCompare,
  Globe,
  MousePointer2,
  Presentation,
  Sparkles,
  SquareCode,
  Terminal,
} from "lucide-react";

/** Shared stroke for every Lucide glyph. Lucide React still draws inline <svg>. */
export const ICON_STROKE = 1.75;

export function UiIcon({
  icon: Glyph,
  size = 16,
  strokeWidth = ICON_STROKE,
  className,
  style,
  ...rest
}: { icon: LucideIcon } & LucideProps) {
  return (
    <Glyph
      {...rest}
      size={size}
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={["ui-icon", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, flexShrink: 0, display: "block", ...style }}
      aria-hidden="true"
    />
  );
}

export const TOOL_ICON = {
  files: Files,
  canvas: Presentation,
  terminal: Terminal,
  changes: GitCompare,
  browser: Globe,
} as const;

export const PROVIDER_ICON: Record<string, LucideIcon> = {
  claude: Sparkles,
  codex: SquareCode,
  cursor: MousePointer2,
  fixture: FlaskConical,
  shell: Terminal,
};

export function providerIcon(id: string): LucideIcon {
  return PROVIDER_ICON[id] ?? Bot;
}

const FILE_EXT_ICON: Record<string, LucideIcon> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  mjs: FileCode,
  cjs: FileCode,
  py: FileCode,
  rs: FileCode,
  go: FileCode,
  java: FileCode,
  kt: FileCode,
  json: FileJson,
  yml: FileJson,
  yaml: FileJson,
  toml: FileJson,
  md: FileText,
  mdx: FileText,
  markdown: FileText,
  mmd: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  svg: FileImage,
  bmp: FileImage,
  ico: FileImage,
  css: FileType,
  scss: FileType,
  less: FileType,
};

export function fileIcon(name: string, isDir: boolean, open: boolean): LucideIcon {
  if (isDir) return open ? FolderOpen : Folder;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return FILE_EXT_ICON[ext] ?? File;
}
