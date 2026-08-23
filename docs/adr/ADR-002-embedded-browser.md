# ADR-002 — Browser interno (webview WRY filho)

## Status

Aceite. Adenda 2026-08: a página vive **dentro** do tab Navegador, num webview filho da janela Tauri (`Window::add_child`). CEF e Chromium Playwright headed saem. Sem segundo motor no binário.

## Contexto

A pele precisa de um tab de navegação para o humano ver URLs e de um canal estreito para o agente ler a **mesma** sessão (URL, consola, rede, snapshot). A app é Tauri 2 / WRY: WebView2 no Windows, WKWebView no macOS, WebKitGTK no Linux. Inserir CEF duplicaria o motor. Uma janela Chromium à parte (Playwright headed) não é um navegador interno.

O MCP que conta no v1 é o do CLI (ADR-001). A app expõe um registry vazio; não compete com o vendor.

## Decisão

- A **pele** e o **site** são WRY. Um webview filho (label `browser`) na janela `main`, posicionado no buraco do tab. Chrome fino (URL, histórico, favorito, Design Mode, consola).
- Motor nativo: WebView2 (Chromium/Edge) no Windows; WKWebView no macOS; WebKitGTK no Linux. Sem paridade de motor entre OS.
- Humano e agente vêem a mesma página. O runtime Rust envia recortes com `session_write`. A UI não fala com o PTY.
- Um webview global, lazy; esconde-se quando o tab não está activo, o painel fecha ou um modal tapa a área; destroi-se quando não há tab Navegador.
- Só `http(s)` e `about:blank`. `javascript:`, `file:`, `data:` e `about:` (excepto blank) são rejeitados.
- Snapshot ao CLI: texto estruturado / `innerText`, tecto ~200 KiB. Consola/rede/scripts na pele são espelho via script injectado, não o Network/Sources do Chrome. Inspector nativo = DevTools do webview (`Inspecionar`). Design Mode captura selector/texto/HTML e envia com `session_write`.
- Host MCP da app continua slot. Sem CEF, sem Playwright headed, sem iframe (`X-Frame-Options`).

## Consequências

- Windows aproxima-se do Simple Browser (WebView2). Linux/macOS usam WebKit, como a pele.
- `add_child` está atrás da feature `unstable` do Tauri. No Linux 2.11 o posicionamento usa um `gtk::Fixed` overlay (pass-through) se o `GtkBox` ignorar bounds.
- Sites podem renderizar diferente no WebKit e no Chromium. Isso é o preço da pele fina (ADR-001).
