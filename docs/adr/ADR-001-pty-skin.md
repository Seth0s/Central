# ADR-001 — Pele sobre o CLI verdadeiro

## Status

Aceite (supersedida em 2026-08-22: PTY é a sessão).

## Contexto

O utilizador já tem CLIs autenticados (Claude, Codex, …) e quer uma app desktop única. Reimplementar o harness (API, tools, MCP do vendor) duplica produto e parte quando o vendor muda.

O caminho `json_stream` (`claude -p`, `codex exec --json`) criou uma segunda verdade: catálogo `resume_id` + bolhas SQLite. O `/resume` do TUI não existe em `-p` (`isn't available in this environment`). A sessão vendor e a pele divergiam.

## Decisão

A app é uma **pele**: detecta o binário, lança o TUI real no `cwd`, mostra o PTY e escreve o input do utilizador. Um agente = um processo OS no PTY. Id, histórico e `/resume` ficam no vendor.

Dois **modos de vista** do mesmo PTY (não dois processos, sem troca de argv a meio):

- **CLI (A)** — terminal nativo (VTE no Linux; xterm.js fallback noutros SO). Teclado no TUI. `/resume` é o do vendor.
- **Chrome (B)** — compositor escreve linhas no PTY; observers por provider leem o ecrã estável (não um dump). Se o observer falhar, A continua correcto.

`--resume` / `--continue` só no **spawn**, se o utilizador os pedir no modal. A meio da vida o slash vai no PTY.

Sem backend obrigatório. Sem JWT TEAM. MCP e browser da app são slots; o MCP que conta no v1 é o do CLI.

## Consequências

- Auth, tools e sessão ficam no vendor.
- A UI não inventa id/histórico. SQLite guarda chrome da app (pasta, grupo, nome, vista A/B).
- Modo B pode traduzir ecrã; parsers isolados podem partir quando o TUI muda.
- No Linux o TUI não passa pelo WebKit (VTE no overlay GTK). xterm.js no webview fica só como fallback documentado.
- `fixture` permite testes e UI sem binários instalados (PTY de eco).
- Orquestração entre dois CLIs e host MCP próprio ficam fora desta base.
- Vários processos no mesmo grupo da barra esquerda são só agrupamento na UI: cada um tem o seu PTY. Encaminhar texto é uma acção explícita do utilizador.
