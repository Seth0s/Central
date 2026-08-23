# Medir VTE vs xterm.js

Este diretório guarda as corridas. O procedimento abaixo existe para que duas
corridas feitas em dias diferentes sejam comparáveis — a decisão da Fase 3
depende disso mais do que de qualquer número isolado.

A pergunta que se está a responder: **o terminal deve continuar a ser um widget
VTE nativo no overlay GTK, ou passar a xterm.js dentro do WebKit?** `ADR-001`
diz hoje que "no Linux o TUI não passa pelo WebKit"; mudar isso exige um
`ADR-003`, e ele só se escreve com estes números na mão.

## Antes de medir: dois consertos a confirmar à mão

Estes eram bugs, não questões de performance. Confirme-os primeiro — se o
teclado não chegar ao VTE, a coluna de latência do braço nativo é vazia e a
comparação não existe.

1. **Teclado chega ao VTE.** Abra uma sessão, clique no terminal, digite. Antes
   do `grab_focus` o rato funcionava e o teclado não (o foco ficava no webview).
2. **O terminal volta a desenhar ao fechar um modal.** Este ainda **não está
   consertado** — está diagnosticado (`sync_host` colapsa o `GtkFixed` para 1×1
   quando nenhum buraco está mapeado). O cenário 5 existe para o medir; o
   conserto em `chrome.rs` só se justifica se a medição apontar para lá.

## Uma corrida

```bash
# Arranque limpo: um ficheiro por corrida, nomeado pelo braço e pelo cenário.
export CENTRALBYTE_TERM_STATS=1
export CENTRALBYTE_TERM_STATS_FILE="$PWD/docs/measurements/$(date +%F)-vte-firehose.ndjson"
export CENTRALBYTE_TERM=vte          # ou xterm, para o outro braço
npx tauri dev
```

`CENTRALBYTE_TERM` força o backend, então os dois braços correm na mesma
máquina sem recompilar. O NDJSON é anexado, nunca truncado: um ficheiro por
corrida, ou os cenários misturam-se.

Em paralelo, fora da app, para o custo que a instrumentação interna não vê:

```bash
pidstat -h -r -u -p $(pgrep -f 'centralbyte|central-byte' | head -1) 1 > cpu-rss.txt
```

## Os cinco cenários

Mesma janela, mesmo tamanho de painel, mesmo tema, nos dois braços.

| # | Carga | O que revela |
|---|---|---|
| 1 | `yes \| head -c 50000000` | throughput puro, sem semântica |
| 2 | `find / -xdev 2>/dev/null \| head -500000` | orientado a linha, scroll constante |
| 3 | `htop`, depois `vim` num ficheiro grande, a rolar | alt screen e redesenho denso — onde o renderer DOM do xterm perde linhas |
| 4 | uma sessão `claude` real, com o painel Chrome ligado | o caso para o qual a app existe, incluindo o custo dos observers |
| 5 | repetir (3) abrindo e fechando um modal a cada poucos segundos | o congelamento por oclusão, com número em vez de impressão |

## Ler o resultado

```bash
python3 scripts/term-stats.py docs/measurements/2026-08-23-vte-firehose.ndjson \
                              docs/measurements/2026-08-23-xterm-firehose.ndjson
```

O que cada linha significa:

- **feed p95** — custo de entregar bytes ao motor. No braço VTE isto corre no
  main loop do GTK que o WebKitGTK também usa para desenhar, então limita a UI
  inteira, não só o terminal. No braço xterm corre na thread do renderer.
- **snapshot p95** — custo de extrair o texto do ecrã para a vista Chrome. Os
  dois braços aplicam o mesmo throttle de 80 ms (`SNAPSHOT_DEBOUNCE_MS` em
  `term.rs`, `SNAPSHOT_THROTTLE_MS` em `PtyTerm.tsx` — mantenha-os iguais).
- **of which crossed IPC** — deve ser `0` no braço VTE. Se não for, o guard em
  `runtime.rs` regrediu e está a serializar o PTY inteiro para ninguém.
- **key->paint** — carrega os 80 ms do throttle, então é um teto do que o
  utilizador vê, não o custo do renderer. Leia o critério dos 30 ms contra isso.
- **snapshots that changed (%)** — baixo significa que se está a extrair ecrã
  para o descartar; é trabalho a eliminar, em qualquer dos braços.

O script não decide nada. O critério está escrito no plano, antes de haver
números, precisamente para não ser ajustado ao resultado.

## Registar

Um ficheiro por comparação, `AAAA-MM-DD-<máquina>.md`, com: versão do
CentralByte (`git rev-parse --short HEAD`), CPU/GPU, sessão gráfica (X11 ou
Wayland — o overlay GTK comporta-se de forma diferente), versão do WebKitGTK
(`pkg-config --modversion webkit2gtk-4.1`), a tabela do script, e o que se viu
com os olhos: linhas perdidas, tearing, congelamento. Os números não capturam
uma linha que falhou ao desenhar.
