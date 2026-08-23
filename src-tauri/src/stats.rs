//! Opt-in instrumentation for the terminal hot path.
//!
//! Off unless `CENTRALBYTE_TERM_STATS=1`. When on, it appends NDJSON to a file —
//! never to stdout, which shares the terminal with the PTY under `tauri dev`.
//! Override the path with `CENTRALBYTE_TERM_STATS_FILE`.
//!
//! Use the `stat!` macro, not `record` directly: it skips the `format!` when
//! instrumentation is off, so a disabled build pays one atomic read per call.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

fn origin() -> Instant {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    *ORIGIN.get_or_init(Instant::now)
}

pub fn enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var("CENTRALBYTE_TERM_STATS").as_deref() == Ok("1"))
}

fn path() -> PathBuf {
    std::env::var("CENTRALBYTE_TERM_STATS_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("centralbyte-term-stats.ndjson"))
}

fn sink() -> Option<&'static Mutex<std::fs::File>> {
    static SINK: OnceLock<Option<Mutex<std::fs::File>>> = OnceLock::new();
    SINK.get_or_init(|| {
        let p = path();
        match OpenOptions::new().create(true).append(true).open(&p) {
            Ok(f) => {
                eprintln!("centralbyte: term stats -> {}", p.display());
                Some(Mutex::new(f))
            }
            Err(e) => {
                eprintln!("centralbyte: term stats disabled ({p:?}: {e})");
                None
            }
        }
    })
    .as_ref()
}

/// One NDJSON line. `fields` is a JSON object body without the braces.
pub fn record(event: &str, fields: &str) {
    let Some(sink) = sink() else {
        return;
    };
    let us = origin().elapsed().as_micros();
    let line = format!("{{\"t_us\":{us},\"ev\":\"{event}\",{fields}}}\n");
    if let Ok(mut f) = sink.lock() {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Record an event, formatting the body only when instrumentation is on.
#[macro_export]
macro_rules! stat {
    ($event:expr, $($arg:tt)*) => {
        if $crate::stats::enabled() {
            $crate::stats::record($event, &format!($($arg)*));
        }
    };
}
