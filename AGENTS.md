# CentralByte — AGENTS.md

Este é o `AGENTS.md` da raiz do repositório **`Central`** (`git@github.com:Seth0s/Central.git`). Complementa a camada de workspace em `../AGENTS.md`; não herda contratos do control plane do CentralChat nem do Idy.

O código foi extraído de `CentralChat/vhosts/CentralChat_Desktop` e renomeado para CentralByte. Identificadores: `centralbyte` (npm e crate Tauri), `centralbyte_core` (domínio), `centralbyte_lib` (lib), `com.centralbyte.app` (bundle), `CentralByte` (`productName` e título de janela).

## Identidade e escopo

- Produto: pele desktop (Tauri 2) sobre CLIs de agentes reais já instalados. O harness — auth, tools, MCP, histórico da conversa — continua no binário do vendor. Esta app detecta, lança, mostra e devolve input.
- Uma tab de agente = **um processo de SO rodando o TUI num PTY**. Nunca `claude -p` nem `codex exec --json` como caminho de sessão.
- Componentes:
  - `crates/core` — domínio testável em Rust **sem GTK/WebKit**: providers, workspace, git, histórico (SQLite), browser URL, MCP (stub). É onde `cargo test` roda.
  - `src-tauri` — PTY, runtime de N sessões, IPC, VTE nativo (Linux) e webview filho do navegador.
  - `src` — chrome em React 19: layout em grelha, terminal nativo/xterm fallback, tradutores de PTY e observers.
    - `prototype/` — protótipo HTML/JS que serve de spec viva da UI. **Não entra no bundle.**

### Mapa do frontend

Três hooks guardam o estado; componentes só desenham; `src/lib/` é puro (sem React, sem IPC).

| Camada | Onde | Responsabilidade |
|---|---|---|
| Orquestração | `src/App.tsx` | grelha da janela, workspace, ações que precisam de catálogo **e** de agentes vivos |
| Catálogo | `src/hooks/useCatalog.ts` | SQLite: repositórios, sessões-grupo, linhas de agente, turnos legados |
| Runtime | `src/hooks/useAgentRuntime.ts` | painéis vivos, subscrição `session-event`, spawn/resume/close, compositor, slashes |
| Ferramentas | `src/hooks/useToolShelf.ts` | estante da barra direita e o trabalho de cada ferramenta |
| Chrome | `src/chrome/` | titlebar, statusbar, barra esquerda (Projects) |
| Painel | `src/session/`, `src/tools/` | painel de agente; painel e corpos de ferramenta |
| Overlays | `src/overlays/` | menus (`+`, slash, picker) e modais (sessão, agente, browse, permissão) |
| Puro | `src/lib/` | `paths`, `tool-model`, `ui-model`, `ui-metrics`, `status-line`, `chat`, `slash`, `pty_translate` |

A dependência entre hooks é de sentido único: runtime → catálogo (recebe `persistSession`/`persistTurns` por parâmetro). As duas escritas de catálogo que também tocam o painel vivo (renomear, mover) voltam por callback, através de uma `ref` declarada em `App.tsx` — é o único ponto onde o sentido único se dobra, e está comentado lá.
- O que não pertence: FastAPI, Go ControlPlane, JWT/tenancy, envelopes de contrato de outro produto, orquestração entre modelos, parsers fiéis de layout Ink/ratatui, API keys próprias.

## Fontes canônicas

- Arquitetura (fonte de verdade da UI, IPC, sessões, ferramentas e tradutores): `docs/architecture.md`
- Decisão da pele sobre PTY: `docs/adr/ADR-001-pty-skin.md`
- Decisão do navegador embutido: `docs/adr/ADR-002-embedded-browser.md`
- Medição VTE vs xterm.js (procedimento, métricas e critério): `docs/measurements/README.md`
- Planejamento: este `AGENTS.md` e o `README.md`

## Comandos e gates

```bash
npm install

npx tsc --noEmit       # tipos, testes incluídos
npm test               # vitest run
npm run test:watch     # vitest em watch
npm run build          # tsc && vite build

cargo test --manifest-path crates/core/Cargo.toml    # domínio, sem GTK/WebKit
cargo test  --manifest-path src-tauri/Cargo.toml     # precisa de webkit2gtk no Linux

npx tauri dev          # precisa de webkit2gtk no Linux
npx tauri build
```

CI em `.github/workflows/ci.yml`, três jobs paralelos: `frontend` (tsc, vitest, build), `core` (`cargo test`, sem libs de sistema) e `tauri` (`cargo test`, instala webkit2gtk).

Testes: `vitest`, ambiente `node` por omissão. Um teste de UI opta por jsdom com o docblock `// @vitest-environment jsdom` no topo do ficheiro; `src/test/setup.ts` faz o cleanup entre testes e o shim de `scrollIntoView`, que o jsdom não implementa. `src/App.test.tsx` é smoke da ligação entre os três hooks e os overlays — mocka `lib/commands`, as APIs Tauri, o `TermView` e o `CanvasPane`, e não afirma nada sobre comportamento de PTY.

Sem `claude`/`codex`/`cursor-agent` no PATH, use o provider `fixture` (eco no PTY).

Rode apenas os gates da camada que você tocou: `src/**` → `tsc` + `npm test`; `crates/core/**` → `cargo test`; `src-tauri/**` → `cargo test`.

## Terminal: variáveis e regras

O terminal é o ponto mais frágil da app e está sob medição — ver
`docs/measurements/README.md` para o procedimento e o critério.

| Variável | Efeito |
|---|---|
| `CENTRALBYTE_TERM=vte\|xterm` | força o backend, para o A/B correr na mesma máquina sem recompilar. Omitida: VTE no Linux, xterm no resto |
| `CENTRALBYTE_TERM_STATS=1` | liga a instrumentação NDJSON. Desligada custa uma leitura atômica por chamada |
| `CENTRALBYTE_TERM_STATS_FILE` | onde escrever. Por omissão `$TMPDIR/centralbyte-term-stats.ndjson`. **Nunca stdout** — sob `tauri dev` ele partilha o terminal com o PTY |

Três invariantes deste caminho, cada um com teste em `src-tauri/src/term.rs`:

- **Foco segue a *transição* para um buraco interativo**, nunca cada mudança de
  bounds (`should_grab_focus`). O GTK entrega o teclado ao widget que detém o
  foco, então agarrar a cada mudança roubaria o teclado de um `input` HTML em
  cada redimensionamento da janela. Sem o `grab_focus` na transição, o rato
  funciona e o teclado não.
- **Snapshot de ecrã é throttle, não debounce de cauda** (`SnapshotClock`,
  80 ms): armado pelo primeiro feed da rajada, nunca empurrado pelos seguintes.
  Um debounce de cauda deixaria a vista Chrome parada exactamente enquanto
  houvesse output. `SNAPSHOT_THROTTLE_MS` em `src/PtyTerm.tsx` espelha isto —
  mantenha os dois iguais ou os dois braços deixam de ser comparáveis.
- **No backend nativo o evento `Bytes` não atravessa o IPC.** O widget VTE *é* o
  terminal e `TermView` não registra `ptyRef` no modo nativo, então serializar o
  stream do PTY seria trabalho para nenhum leitor. O snapshot de ecrã viaja
  separado.

O z-order **não é conserto de código**: um widget GTK dentro de `gtk::Overlay`
pinta sempre acima de toda a superfície WebKitGTK, e `z-index` de CSS não
governa camadas de composição diferentes ([tauri#8246](https://github.com/tauri-apps/tauri/issues/8246),
aberto desde 2023). Desmapear o widget quando um modal abre é a única saída
dentro deste desenho — e é a causa do congelamento na pendência 1.

## Regras locais

- Idioma: pt-BR com o utilizador; código, identificadores e commits em inglês.
- A UI **nunca** fala com o PTY diretamente: só `invoke` + evento `session-event`.
- Duas vistas do mesmo PTY, sem segundo processo: **CLI** (terminal nativo — VTE no Linux, xterm.js fallback em macOS/Windows) e **Chrome** (compositor escreve texto + `\n` no PTY; transcript = nossos envios + observers). Na vista Chrome o emulador fica montado com tamanho real e input bloqueado, para o TUI não colapsar.
- Argv extra só o documentado, e só no spawn: Claude `--model` / `--append-system-prompt` / `--resume` / `--continue`; Codex `resume <id>` e `-m`; Cursor `--model` / `--resume`. Não inventar flags — há teste em `crates/core/src/provider/mod.rs` que trava isso.
- Slash commands são os do vendor. Pickers da pele (`/model`, `/effort`, `/autocompact`) escrevem o slash no TUI; nunca relançam o processo.
- **Pedido de abertura de URL.** O agente não tem IPC: só imprime. A skin ensina-lhe no system prompt do spawn a imprimir `<<centralbyte:open <url>>>`; o observer lê o delta do ecrã, e um marcador levanta o modal de permissão. Qualquer URL `http(s)` simples é apenas **coletada** (`session.seenUrls`, teto de 12) e oferecida na barra do painel Navegador — nunca interrompe, porque agentes imprimem URLs de docs e erros a toda a hora. Essa lista é o único caminho nos providers que não aceitam system prompt no spawn. Um pedido novo não substitui um modal ainda no ecrã. Tudo em `src/lib/pty_translate/browse_request.ts`, puro e testado.
- Fonte de verdade da conversa é o CLI. O SQLite em `{app_data}/history.db` guarda só chrome da app (pasta, grupo, nome do painel, vista A/B). A tabela `turns` é legado.
- Não pedir API keys: a auth é a do CLI na máquina. Nunca versionar `history.db`, logs de PTY ou conteúdo de sessão.
- Não importar módulos, auth ou tenancy do Idy nem do CentralChat.

## Estado e pendências (2026-08-23)

Verificado nesta data: `tsc --noEmit` limpo, `npm test` 34/34, `npm run build` limpo, `cargo test` do core 40/40, `cargo test` do `src-tauri` 25/25.

Problemas conhecidos, em ordem de urgência:

1. **O terminal congela sob oclusão — diagnosticado, não consertado.** Abrir um
   modal desmapeia o widget VTE; `sync_host` recalcula o `HOST` como a união só
   dos buracos **mapeados**, e sem nenhum mapeado o `GtkFixed` colapsa para
   `1×1` (`chrome.rs`). O dado não se perde — `feed_on_main` alimenta o VTE
   independentemente do mapeamento — o que falha é o redesenho ao voltar. O
   cenário 5 de `docs/measurements/README.md` mede isto; o conserto em
   `chrome.rs` só se justifica se a medição apontar para lá.
2. **Superfície IPC morta.** `send_selection_stub`, `mcp_list_tools`, `mcp_list_resources` e `history_put_turn` têm wrapper em `src/lib/commands.ts` sem nenhum consumidor. O registry MCP (`crates/core/src/mcp.rs`) é stub vazio por decisão, mas os comandos expostos não são usados.
3. **O protocolo de abertura só chega ao Claude.** `browseProtocolPrompt()` entra no system prompt no spawn, e hoje só o Claude o aceita. Codex e Cursor ficam com a lista passiva de URLs. Se um deles passar a aceitar system prompt no spawn, incluir o protocolo lá também.
4. **Cobertura de teste rasa.** Existem 34 testes: as suítes de `lib/` (parsers, slash, tradutores de PTY, pedidos de abertura) e 9 smoke de UI. Nada cobre `useAgentRuntime` nem `useCatalog` isoladamente, e nada exercita PTY real. `chat.test.ts` é um único `test()` porque intercala `const` partilhados com assertions — dá para dividir, mas exige reordenar as declarações.
5. **Deriva de documentação.** A lista de comandos em `docs/architecture.md` § IPC omite `read_user_file`, `list_markdown` e `browse_dir`, que estão registrados em `src-tauri/src/lib.rs`.
6. **Postura de segurança do webview a revisar.** `tauri.conf.json` tem `csp: null` e `assetProtocol.scope: ["**"]`, e a app embute um navegador que carrega páginas arbitrárias. Revisar antes de qualquer distribuição.

## Limites de alteração

- Mudar contrato de IPC (nome de comando, payload, evento) exige atualizar `src/lib/commands.ts`, `docs/architecture.md` § IPC e o registro em `src-tauri/src/lib.rs` no mesmo diff.
- Trocar `identifier` do bundle (`com.centralbyte.app`), esquema do SQLite ou nome de crate não é mudança local: exige revisão explícita (perda de `{app_data}` / rebuild completo).
- Decisões de ADR (PTY como sessão, webview filho único) só mudam por novo ADR em `docs/adr/`.
