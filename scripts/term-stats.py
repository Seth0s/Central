#!/usr/bin/env python3
"""Summarise a terminal-instrumentation run, or compare two arms.

    python3 scripts/term-stats.py run.ndjson
    python3 scripts/term-stats.py vte.ndjson xterm.ndjson

Reads the NDJSON written by CENTRALBYTE_TERM_STATS=1 (src-tauri/src/stats.rs and
the mirrored xterm events in src/PtyTerm.tsx). Prints the numbers the Fase 3
decision criteria are written against; it does not decide anything itself.
"""

import json
import sys
from pathlib import Path

# Events the two arms use for the same thing.
FEED = {"vte_feed", "xterm_feed"}
SNAPSHOT = {"vte_snapshot", "xterm_snapshot"}
PTY = {"pty_bytes_native", "pty_bytes_ipc"}


def pct(values, q):
    """Nearest-rank percentile; no numpy dependency on purpose."""
    if not values:
        return 0
    ordered = sorted(values)
    i = min(len(ordered) - 1, int(round(q / 100 * (len(ordered) - 1))))
    return ordered[i]


def load(path):
    rows = []
    bad = 0
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            bad += 1
    if bad:
        print(f"  ! {bad} unparseable line(s) skipped in {path}", file=sys.stderr)
    return rows


def key_latencies_ms(rows):
    """Keystroke -> the frame that shows it, in ms.

    A keystroke is answered by the next snapshot that actually *changed*: an
    unchanged one repainted nothing the typist could see. Keys with no changed
    snapshot after them (end of run, or a key the program swallowed) are
    dropped rather than counted as zero.
    """
    ordered = sorted(rows, key=lambda r: r.get("t_us", 0))
    out = []
    pending = None
    for r in ordered:
        ev = r.get("ev")
        if ev == "key":
            # Only the first key of a burst is timed; a held-down repeat would
            # otherwise credit every key with the same single repaint.
            if pending is None:
                pending = r.get("t_us", 0)
        elif ev in SNAPSHOT and r.get("changed") is True and pending is not None:
            out.append((r.get("t_us", 0) - pending) / 1000.0)
            pending = None
    return out


def summarise(path):
    rows = load(path)
    if not rows:
        return None

    span_us = max(r["t_us"] for r in rows) - min(r["t_us"] for r in rows)
    span_s = span_us / 1e6 if span_us else 0.0

    feeds = [r for r in rows if r.get("ev") in FEED]
    snaps = [r for r in rows if r.get("ev") in SNAPSHOT]
    ptys = [r for r in rows if r.get("ev") in PTY]
    keys = [r for r in rows if r.get("ev") == "key"]

    key_ms = key_latencies_ms(rows)

    feed_us = [r["feed_us"] for r in feeds if "feed_us" in r]
    snap_us = [r["snapshot_us"] for r in snaps if "snapshot_us" in r]
    pty_bytes = sum(r.get("bytes", 0) for r in ptys)
    ipc_bytes = sum(r.get("bytes", 0) for r in ptys if r["ev"] == "pty_bytes_ipc")
    changed = sum(1 for r in snaps if r.get("changed") is True)
    renderers = {r.get("renderer") for r in feeds if r.get("renderer")}
    arms = {r.get("arm") for r in keys if r.get("arm")}

    return {
        "path": str(path),
        "arm": ", ".join(sorted(a for a in arms if a)) or "?",
        "renderer": ", ".join(sorted(r for r in renderers if r)) or "native",
        "span_s": span_s,
        "pty_bytes": pty_bytes,
        "pty_kbps": (pty_bytes / 1024 / span_s) if span_s else 0.0,
        "ipc_bytes": ipc_bytes,
        "feeds": len(feeds),
        "feed_p50": pct(feed_us, 50),
        "feed_p95": pct(feed_us, 95),
        "feed_max": max(feed_us) if feed_us else 0,
        "snaps": len(snaps),
        "snaps_per_s": (len(snaps) / span_s) if span_s else 0.0,
        "snap_changed_pct": (100 * changed / len(snaps)) if snaps else 0.0,
        "snap_p50": pct(snap_us, 50),
        "snap_p95": pct(snap_us, 95),
        "snap_max": max(snap_us) if snap_us else 0,
        "keys": len(keys),
        "key_matched": len(key_ms),
        "key_p50": pct(key_ms, 50),
        "key_p95": pct(key_ms, 95),
        "key_max": max(key_ms) if key_ms else 0.0,
    }


ROWS = [
    ("arm", "arm", "{}"),
    ("renderer", "renderer", "{}"),
    ("span_s", "duration (s)", "{:.1f}"),
    ("pty_kbps", "PTY throughput (KiB/s)", "{:.1f}"),
    ("pty_bytes", "PTY bytes total", "{:,}"),
    ("ipc_bytes", "of which crossed IPC", "{:,}"),
    ("feeds", "feeds", "{:,}"),
    ("feed_p50", "feed p50 (us)", "{:,}"),
    ("feed_p95", "feed p95 (us)", "{:,}"),
    ("feed_max", "feed max (us)", "{:,}"),
    ("snaps", "snapshots", "{:,}"),
    ("snaps_per_s", "snapshots/s", "{:.1f}"),
    ("snap_changed_pct", "snapshots that changed (%)", "{:.0f}"),
    ("snap_p50", "snapshot p50 (us)", "{:,}"),
    ("snap_p95", "snapshot p95 (us)", "{:,}"),
    ("snap_max", "snapshot max (us)", "{:,}"),
    ("keys", "keystrokes", "{:,}"),
    ("key_matched", "of which repainted", "{:,}"),
    ("key_p50", "key->paint p50 (ms)", "{:.1f}"),
    ("key_p95", "key->paint p95 (ms)", "{:.1f}"),
    ("key_max", "key->paint max (ms)", "{:.1f}"),
]


def main(paths):
    reports = []
    for p in paths:
        r = summarise(p)
        if r is None:
            print(f"  ! no events in {p}", file=sys.stderr)
            continue
        reports.append(r)
    if not reports:
        return 1

    label_w = max(len(label) for _, label, _ in ROWS)
    col_w = 22
    header = " " * label_w + "".join(Path(r["path"]).stem.rjust(col_w) for r in reports)
    print(header)
    print("-" * len(header))
    for key, label, fmt in ROWS:
        cells = "".join(fmt.format(r[key]).rjust(col_w) for r in reports)
        print(label.ljust(label_w) + cells)

    print()
    print("feed+snapshot p95 bounds the whole UI on the VTE arm: both run on the")
    print("GTK main loop that WebKitGTK also draws on. key->paint carries the 80 ms")
    print("snapshot debounce that both arms apply, so it is a ceiling on what the")
    print("typist sees, not the renderer's own cost. Fase 3 asks for a median")
    print("under 30 ms; read it against that debounce before concluding.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1:]))
