# Arquitetura

Camadas: React (chrome) → comandos/eventos Tauri → runtime Rust → `Provider` → processo do vendor.

O domínio testável (providers, workspace, MCP, tipos de sessão) vive em `crates/core` **sem** GTK/WebKit, para `cargo test` correr nesta máquina. PTY e IPC ficam em `src-tauri`.

A UI em React copia o protótipo em `prototype/` (spec viva). O HTML **não** entra no bundle.

## Sessões

Uma tab de agente = um processo OS (TUI no PTY). Vários agentes podem partilhar uma sessão-grupo na barra esquerda (agrupamento visual, sem orquestrar). O runtime guarda um `HashMap` de sessões; eventos `session-event` trazem `session_id`. Fechar a tab chama `session_kill`.

A fonte de verdade da **sessão vendor** é o CLI. A pele não mantém um segundo histórico canónico. SQLite guarda só chrome da app: pasta, grupo, nome do painel, vista A/B.

Dois modos de **vista** do mesmo PTY — o utilizador troca no `session-head`, sem segundo processo:

- **CLI** — terminal nativo (VTE no Linux no buraco do painel; xterm.js fallback em macOS/Windows). Teclado no TUI. `/resume` e o resto dos slashes são os do vendor. No Linux o VTE é filho do overlay GTK: a janela GDK do overlay é só o bounding box dos buracos (não o rect desde `(0,0)` do GtkFixed); desmapeia quando o chrome HTML precisa do ponteiro (estado React, sem observer global nem restack).
- **Chrome** — compositor escreve texto + `\n` no PTY; status-line por provider; transcript = envios nossos + observers de assistente/tools. O VTE/xterm fica no sítio (tamanho real, input bloqueado) para o TUI não colapsar. Sem dump do ecrã.

Spawn sempre `interactive_pty`. Sem `claude -p` / `codex exec --json` como caminho de sessão.

Flags extra só as documentadas, e só no spawn: Claude `--model` / `--append-system-prompt` / `--resume` / `--continue`; Codex TUI `resume <id>` e `-m`; Cursor `--model` / `--resume`. Sem argv inventado. A meio da vida, o compositor (vista Chrome) ou o terminal nativo (vista CLI) escrevem no PTY.

| Provider | Processo | Resume |
|---|---|---|
| Claude | `claude` (TUI) | `/resume` no TUI; spawn `--resume <id>` ou `--continue` se o modal pedir |
| Codex | `codex` (TUI) | TUI `resume <id>` no spawn se o modal pedir |
| Cursor | `cursor-agent` (TUI) | spawn `--resume <id>` se o modal pedir |
| Fixture | eco interno em PTY | sem id |

Reabrir um agente na árvore spawna o TUI nesse `cwd`. Não exige `resume_id`. Sessões criadas fora da app: vista CLI e `/resume` no TUI, como no terminal.

Apagar agente/sessão mata o processo pelo id vivo (UUID do runtime) e tira o painel. O id do catálogo (`catalogId`) não é o id do processo.

O orbe: processo vivo **e** (ecrã a mudar ou tool aberta no observer) → `run`; processo saiu com código ≠ 0 → `error`; resto idle. Sem `endedAt` de turno JSON.

## Chrome

A janela é **uma grelha**:

```
header  header  header
left    main    right
footer  footer  footer
```

`--title` 28px, `--status` 24px. `--left` / `--right` são `0px` fechado e a largura persistida aberto. Sem coluna fantasma e sem linha extra: o `session-head` fica sempre colado ao header da janela.

- **Header da janela:** arraste, Tema, controlos. Sem toggles.
- **Barra fechada:** o ícone cola no canto do `main` (`session-head`), `position: absolute` — o chat não desce.
- **Esquerda aberta:** Novo chat e **Projects** (pasta → sessão-grupo → agentes, com traço de árvore). Pasta: `FolderPlus` abre workspace, `MessagesSquare` abre o modal da sessão (nome, objectivo, brief partilhado). O brief entra no system prompt dos CLIs que o aceitam no spawn. Sessão: ícone estático de sessão e `Bot` para novo agente. Agente: orbe de actividade PTY. Clicar num agente foca o painel já aberto; se estiver fechado, spawna o TUI no cwd. Arrastar agente só entre sessões do mesmo cwd. **Enviar ao agente…** carimba um recorte no compositor do irmão (vista Chrome) ou não escreve no TUI sem confirmação.
- **Direita aberta:** tabs Lucide + `+` + toggle. Conteúdo da ferramenta activa. Fecha no arranque e ao mudar para uma sessão sem tabs.
- **Barra aberta:** `border` de 1px contra o main. Resize na aresta interior.
- **Fechada:** track `0`, aside não monta.
- **Main:** até 3 `session-pane` em flex (split). `session-head` à mesma altura `--title`. Pill **CLI | Chrome**.
- **Footer:** statusbar da janela (cwd, agente focado, modelo se conhecido). Tetris só com pulso `run`/`warn`.
- Ícones: **Lucide** (`lucide-react`). Traço 1.75. Mapa em `src/icons.tsx`.

Histórico em `{app_data}/history.db` (SQLite, journal WAL). Na primeira abertura, se a DB estiver vazia e existir `{app_data}/history.json`, pastas/grupos/agentes são importados uma vez; o JSON deixa de ser escrito.

Tabelas: `repos`, `groups`, `agents`, `turns`. `turns` deixou de ser fonte de verdade da conversa vendor (o TUI guarda isso). A coluna `agents.mode` guarda a vista (`cli` / `chrome`).

## Ferramentas

Instâncias (canvas, browser, terminal, arquivos, alterações) pertencem à **sessão-grupo**, não à pasta. Qualquer agente da sessão vê as mesmas tabs; a label mostra o dono (`Canvas · Bugs fixer`, ou `tu` se a pele abriu). Quem comanda é o dono; os outros vêem read-only. O utilizador sem agente focado comanda sempre. Sem bus entre CLIs (ADR-001). Sem «globalizar» entre sessões neste corte.

O webview do browser é um só na app (ADR-002): mudar para uma sessão sem tab de navegador esconde-o; voltar à sessão dona mostra o mesmo webview. A barra direita só abre se o pool da sessão activa tiver tabs, ou se o utilizador abrir uma ferramenta (`+`).

- Arquivos: árvore em cascata à esquerda (coluna redimensionável, scroll se a profundidade crescer), editor com persistência; `.md` em preview GFM (tabelas, listas, código com highlight.js, Mermaid); imagens no sítio; estado vazio com novo ficheiro. Sem tabs, a barra direita fica fechada.
- Canvas: Markdown + Mermaid no React (mesmo renderer que o chat).
- Terminal extra: o mesmo emulador da vista CLI (VTE no Linux; xterm.js fallback). PTY de `$SHELL` / `/bin/sh` no cwd da sessão (ou do workspace). Fechar a tab mata o processo. Não-dono não escreve no PTY.
- Alterações: `git status` + `diff --numstat` no cwd da sessão activa.
- Navegador: webview WRY filho na mesma janela (Win WebView2 / macOS WKWebView / Linux WebKitGTK). A pele mede o buraco e envia bounds. O agente pede uma página imprimindo `<<centralbyte:open <url>>>` — marcador que a pele lhe ensina no system prompt do spawn; Permitir mostra o site no painel e marca o agente que pediu como dono. URLs simples no ecrã não interrompem: ficam numa lista que a barra do painel oferece, e é esse o único caminho onde o provider não aceita system prompt no spawn. Envio ao CLI via `browser_push_to_session` → `session_write` no PTY.

## Compositor

Só na vista **Chrome**. Na vista CLI o input é o terminal nativo (VTE) ou o xterm fallback.

Caixa `width: min(100%, var(--chat-col))`: chips de anexo, textarea, barra `+` / pill de modo / effort / microfone / enviar. Enviar escreve a linha no PTY (texto + `\n`), incluindo `/resume` e os outros slashes do vendor. Parar manda Ctrl+C (`session_interrupt` → `0x03` no PTY).

Pickers da pele (`/model`, `/effort`, `/autocompact`) escrevem o slash documentado no TUI (`/model sonnet`), não relançam o processo.

| Provider | Modos na pele | Effort | Envio |
|---|---|---|---|
| Claude | Agent / Plan (`/plan` no TUI) | pill → `/effort …` no PTY | texto + linhas `Anexos:` |
| Codex | — | pill → `/effort` no PTY | uma linha |
| Cursor | — | — | uma linha; o TUI também aceita teclas na vista CLI |

Voz: `SpeechRecognition` na pele a preencher o draft. Esconde-se se o webview não tiver a API.

## Status-line

Debaixo do compositor na vista Chrome, por provider. Campos desconhecidos omitem-se (sem `ctx —` nem `%` vazio).

- **Cursor** — modelo + percentagem do TUI (`Auto · 8.2%`). Sem effort.
- **Claude** — modelo + effort (pill) + quota semanal se o ecrã a mostrar.
- **Codex** — modelo + effort (pill) + aviso MCP se o observer detectar falha.

Clique no modelo escreve `/model` no TUI via picker.

## Markdown

Extractor único em `src/lib/markdown.ts` (`marked` + `highlight.js` + KaTeX). Canvas (e transcript legado) partilham o mesmo pipeline.

## Tradutores PTY

`src/lib/pty_translate/`: o Chrome **não** lê o fio ANSI. No Linux o VTE interpreta o ecrã e emite um snapshot (`session-event` `screen`); noutros SO o xterm faz o mesmo via `onScreen`. A pele corre um interpretador por provider e observers de chat (assistente / tools) em cima desse texto estável. O orbe `run` dispara quando o texto do ecrã muda ou há tool aberta, não quando chega um byte. `setSessions` só corre se o frame interpretado mudou. Resize do PTY só com tamanho útil (≥ 40×10) e só se `cols`/`rows` mudarem. Bytes PTY são coalescidos ~16 ms antes de alimentar o VTE e o webview.

Higiene do stream: OSC (hyperlinks) e `\r` (reescrever linha) no `stripAnsi`; o leitor PTY não parte UTF-8 a meio do carácter.

Por provider, em cima do snapshot (não do dump):

- **Cursor** — tira dicas `Tip:` / `?` e linhas só de box-drawing; percentagem `Auto · n%`.
- **Claude** — modelo (Sonnet/Opus/Haiku) e quota semanal para a status-line.
- **Codex** — falha MCP visível (`handshaking` / `startup incomplete`) → aviso na status-line / orbe `warn`.

Observers de chat (vista Chrome): bolha user = envio do compositor; assistente = texto novo após idle, filtrado do chrome do TUI; tools = heurística por provider, cartão «actividade» se falhar. Sem parser fiel ao layout Ink/ratatui e sem reemitir histórico vendor.

## Módulos Rust

| Módulo | Responsabilidade |
|---|---|
| `provider` (`crates/core`) | Trait, `SessionMode`, detect PATH, inventory, extra argv documentado |
| `session` | `SessionInfo` + `SessionMap` + eventos `Bytes` / `Screen` / `JsonLine` / `Exit` / `Error` |
| `workspace` | Abrir pasta, listar, ler/escrever ficheiro (ignora `node_modules`, `.git`) |
| `git` | `git status` porcelain + numstat do cwd |
| `history` | Tipos do catálogo (repos, grupos, agentes) e migração do JSON legado |
| `history_store` | SQLite WAL em `{app_data}/history.db`: CRUD, import único de `history.json` |
| `runtime` (`src-tauri`) | N sessões: start / write / resize / kill / interrupt / shell; coalescing de bytes; emite `session-event` |
| `pty` | PTY portátil (agente e terminal ferramenta); spawn 80×24; SIGWINCH só com tamanho útil |
| `term` (`src-tauri`) | VTE no overlay GTK (Linux); overlay = buraco (janela GDK só no bounding box dos holes); unmap quando o chrome HTML precisa do ponteiro; sem restack e sem observer global; no-op noutros SO |
| `chrome` (`src-tauri`) | Webview filho `browser` + bounds/hide; overlay GTK partilhado com o VTE; chrome (histórico, favoritos, Design Mode); eventos `browser-event` |
| `browser` (`crates/core`) | `normalize_url` e rejeição de esquemas |
| `mcp` | Registry vazio (conectar é stub) |

Providers: `fixture` (PTY de eco), `claude` (TUI), `codex` (TUI), `cursor` (TUI via `cursor-agent`).

## IPC

Comandos: `list_providers`, `open_workspace`, `workspace_cwd`, `list_workspace`, `read_workspace_file`, `write_workspace_file`, `write_user_file`, `start_session`, `start_shell`, `list_sessions`, `session_write`, `session_resize`, `session_kill`, `session_interrupt`, `term_backend`, `term_set_bounds`, `term_close`, `send_selection_stub`, `browser_ensure`, `browser_navigate`, `browser_current`, `browser_set_viewport`, `browser_reload`, `browser_history_go`, `browser_set_design`, `browser_ack_pick`, `browser_open_devtools`, `browser_clear_data`, `browser_toggle_bookmark`, `browser_set_bookmark_bar`, `browser_set_bounds`, `browser_set_visible`, `browser_close`, `browser_push_to_session`, `git_status`, `history_get`, `history_upsert_session`, `history_delete_session`, `history_delete_agent`, `history_move_agent`, `history_list_turns`, `history_put_turn`, `history_replace_turns`, `mcp_list_tools`, `mcp_list_resources`.

Eventos: `session-event`, `browser-event` (`navigated`; consola/rede vêm de `browser_current`).

Pasta: diálogo nativo (`@tauri-apps/plugin-dialog`).

## UI

Grelha da janela: header, barras, chat, footer. Toggles nunca no titlebar; fechados colam no `session-head`. Abrir/fechar troca `--left` / `--right`. `prefers-reduced-motion` zera `--motion`. Paleta: tokens em `:root` (`--bg-chrome` / `--bg-canvas` / `--bg-elevated`, um `--accent`).
