# CentralByte

Pele Tauri 2 sobre CLIs reais. O harness (auth, tools, MCP do vendor) continua no binário (`claude`, `codex`, …). Esta app detecta, lança, mostra e devolve input.

```bash
npm install
cargo test --manifest-path crates/core/Cargo.toml
npm run build
npx tauri dev
```

Sem Claude/Codex no PATH, o provider `fixture` ecoa no PTY.

O tab Navegador é um **webview filho** na mesma janela (WebView2 / WKWebView / WebKitGTK). Não abre Chromium à parte. Chrome fino: URL, histórico, favorito, Design Mode (envia o elemento ao chat) e consola sob pedido. DevTools nativos no menu Inspecionar. No Windows o runtime WebView2 Evergreen costuma já estar instalado.

Não consome o gateway TEAM (`CONTROL_PLANE.md`). Workspace = `cwd` do processo. Registry MCP da app continua vazio.
