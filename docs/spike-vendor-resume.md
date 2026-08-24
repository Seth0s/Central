# Spike — captura de `resume_id` vendor

## Claude (implementado)

Claude Code grava transcripts JSONL em:

`$CLAUDE_CONFIG_DIR/projects/<cwd-encoded>/[sessions/]<session-id>.jsonl`

(default `~/.claude/projects/`). O stem do ficheiro é o id de `claude --resume`.

A app, após um spawn Claude **sem** `resumeId` (incl. `--continue`), espera um curto
intervalo e chama `probe_vendor_resume`, escolhendo o JSONL mais recente do
projecto (opcionalmente só ficheiros tocados depois do spawn). O id é gravado no
painel vivo e no catálogo via `persistSession`.

## Codex (não suportado)

Não há layout público estável equivalente que queiramos acoplar. Reabrir continua
a usar `continueLast` / TUI `/resume` manual. Não inventar heurísticas.
