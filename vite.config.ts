import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function vendorChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("mermaid")) return "mermaid";
  if (id.includes("katex")) return "katex";
  if (id.includes("highlight.js")) return "hljs";
  if (id.includes("@xterm")) return "xterm";
  if (id.includes("lucide-react")) return "icons";
  if (id.includes("react-dom") || id.includes("/react/") || id.includes("\\react\\")) {
    return "react";
  }
  return undefined;
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    // Mermaid alone is ~3.4 MB minified and loads only via dynamic import()
    // when a diagram is present. Warn well above that so regressions in the
    // eager entry (index/react) still surface.
    chunkSizeWarningLimit: 3600,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Node by default: the lib suites are pure. UI tests opt into jsdom with a
  // `// @vitest-environment jsdom` docblock at the top of the file.
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
}));
