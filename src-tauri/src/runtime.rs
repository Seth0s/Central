use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use centralbyte_core::provider::{self, encode_prompt_for, session_argv, SessionMode};
use centralbyte_core::session::{SessionEvent, SessionEventKind, SessionInfo};
use crate::pty::{self, PtySession};

const COALESCE_MS: u64 = 16;
const COALESCE_MAX: usize = 64 * 1024;

enum Live {
    Fixture { app: AppHandle, id: String },
    Pty(PtySession),
    Piped {
        stdin: Mutex<ChildStdin>,
        child: Arc<Mutex<Child>>,
    },
}

struct Handle {
    info: SessionInfo,
    live: Live,
    last_cols: u16,
    last_rows: u16,
}

#[derive(Clone)]
pub struct Runtime {
    inner: Arc<Mutex<HashMap<String, Handle>>>,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub struct StartOpts<'a> {
    pub provider_id: &'a str,
    pub mode: SessionMode,
    pub cwd: &'a Path,
    pub name: String,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub resume_id: Option<String>,
    pub continue_last: bool,
}

impl Runtime {
    pub fn start(&self, app: AppHandle, opts: StartOpts<'_>) -> Result<SessionInfo, String> {
        let StartOpts {
            provider_id,
            mode,
            cwd,
            name,
            model,
            system_prompt,
            resume_id,
            continue_last,
        } = opts;
        let prov = provider::by_id(provider_id).ok_or_else(|| format!("unknown provider: {provider_id}"))?;
        let mode = if prov.supports(SessionMode::InteractivePty) {
            SessionMode::InteractivePty
        } else if prov.supports(mode) {
            mode
        } else {
            return Err(format!("{provider_id} does not support {mode:?}"));
        };
        let id = Uuid::new_v4().to_string();
        let display_name = if name.trim().is_empty() {
            provider_id.to_string()
        } else {
            name.trim().to_string()
        };
        let mut info = SessionInfo {
            id: id.clone(),
            name: display_name,
            provider: provider_id.to_string(),
            mode: match mode {
                SessionMode::JsonStream => "json_stream".into(),
                SessionMode::InteractivePty => "interactive_pty".into(),
            },
            cwd: cwd.display().to_string(),
            model: model.clone().filter(|s| !s.trim().is_empty()),
        };
        let live = if provider_id == "fixture" {
            spawn_fixture(&app, &id, mode);
            Live::Fixture {
                app: app.clone(),
                id: id.clone(),
            }
        } else {
            let binary = prov.detect().ok_or_else(|| format!("{provider_id} not found on PATH"))?;
            let args = session_argv(
                provider_id,
                mode,
                model.as_deref(),
                system_prompt.as_deref(),
                resume_id.as_deref(),
                continue_last,
            );
            match mode {
                SessionMode::InteractivePty => spawn_pty(&app, &id, &binary, &args, cwd)?,
                SessionMode::JsonStream => match spawn_piped(&app, &id, &binary, &args, cwd) {
                    Ok(live) => live,
                    Err(err) if prov.supports(SessionMode::InteractivePty) => {
                        info.mode = "interactive_pty".into();
                        let pty_args = session_argv(
                            provider_id,
                            SessionMode::InteractivePty,
                            model.as_deref(),
                            system_prompt.as_deref(),
                            resume_id.as_deref(),
                            continue_last,
                        );
                        spawn_pty(&app, &id, &binary, &pty_args, cwd).map_err(|pty_err| {
                            format!("{err}; pty fallback failed: {pty_err}")
                        })?
                    }
                    Err(err) => return Err(err),
                },
            }
        };
        self.inner
            .lock()
            .map_err(|e| e.to_string())?
            .insert(
                id.clone(),
                Handle {
                    info: info.clone(),
                    live,
                    last_cols: 0,
                    last_rows: 0,
                },
            );
        Ok(info)
    }

    pub fn start_shell(&self, app: AppHandle, cwd: &Path) -> Result<SessionInfo, String> {
        let id = Uuid::new_v4().to_string();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let binary = PathBuf::from(&shell);
        let info = SessionInfo {
            id: id.clone(),
            name: "Terminal".into(),
            provider: "shell".into(),
            mode: "interactive_pty".into(),
            cwd: cwd.display().to_string(),
            model: None,
        };
        let app_e = app.clone();
        let id_e = id.clone();
        let mut on_bytes = spawn_byte_pump(app.clone(), id.clone());
        let pty = PtySession::spawn(
            &binary,
            &[],
            cwd,
            move |data| on_bytes(data),
            move |code| {
                let _ = emit(&app_e, &id_e, SessionEventKind::Exit { code });
            },
        )?;
        self.inner.lock().map_err(|e| e.to_string())?.insert(
            id.clone(),
            Handle {
                info: info.clone(),
                live: Live::Pty(pty),
                last_cols: 0,
                last_rows: 0,
            },
        );
        Ok(info)
    }

    pub fn list(&self) -> Result<Vec<SessionInfo>, String> {
        Ok(self
            .inner
            .lock()
            .map_err(|e| e.to_string())?
            .values()
            .map(|h| h.info.clone())
            .collect())
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let map = self.inner.lock().map_err(|e| e.to_string())?;
        let h = map.get(session_id).ok_or_else(|| "session_not_found".to_string())?;
        if let Live::Fixture { app, id } = &h.live {
            let app = app.clone();
            let id = id.clone();
            let mode = h.info.mode.clone();
            let payload = data.to_string();
            drop(map);
            thread::spawn(move || emit_fixture_write(&app, &id, &payload, &mode));
            return Ok(());
        }
        match &h.live {
            Live::Fixture { .. } => unreachable!(),
            Live::Pty(p) => p.write(data.as_bytes()),
            Live::Piped { stdin, .. } => {
                let payload = encode_prompt_for(&h.info.provider, SessionMode::JsonStream, data);
                if payload.is_empty() {
                    return Ok(());
                }
                let mut s = stdin.lock().map_err(|e| e.to_string())?;
                s.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
                s.flush().map_err(|e| e.to_string())
            }
        }
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if !pty::useful_size(cols, rows) {
            return Ok(());
        }
        let mut map = self.inner.lock().map_err(|e| e.to_string())?;
        let h = map
            .get_mut(session_id)
            .ok_or_else(|| "session_not_found".to_string())?;
        if h.last_cols == cols && h.last_rows == rows {
            return Ok(());
        }
        h.last_cols = cols;
        h.last_rows = rows;
        match &h.live {
            Live::Pty(p) => p.resize(cols, rows),
            _ => Ok(()),
        }
    }

    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        crate::term::close(session_id);
        let mut map = self.inner.lock().map_err(|e| e.to_string())?;
        let h = map.remove(session_id).ok_or_else(|| "session_not_found".to_string())?;
        match h.live {
            Live::Pty(p) => p.kill(),
            Live::Piped { child, .. } => child
                .lock()
                .map_err(|e| e.to_string())?
                .kill()
                .map_err(|e| e.to_string()),
            Live::Fixture { .. } => Ok(()),
        }
    }

    /// Interrupt the current turn without removing the session handle.
    /// Claude `-p` documents SIGINT (not SIGTERM / `session_kill`) as the stop signal.
    pub fn interrupt(&self, session_id: &str) -> Result<(), String> {
        let map = self.inner.lock().map_err(|e| e.to_string())?;
        let h = map.get(session_id).ok_or_else(|| "session_not_found".to_string())?;
        match &h.live {
            Live::Fixture { .. } => Ok(()),
            Live::Pty(p) => p.write(&[0x03]),
            Live::Piped { child, .. } => {
                let pid = child.lock().map_err(|e| e.to_string())?.id();
                interrupt_pid(pid)
            }
        }
    }
}

fn interrupt_pid(pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        let status = Command::new("kill")
            .args(["-INT", &pid.to_string()])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("interrupt failed: {status}"));
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        Err("interrupt is not supported on this platform".into())
    }
}

fn emit(app: &AppHandle, session_id: &str, kind: SessionEventKind) -> Result<(), String> {
    if let SessionEventKind::Bytes { data } = &kind {
        if crate::term::backend() == "vte" {
            // The native widget *is* the terminal, and TermView registers no
            // ptyRef in native mode, so nothing in the webview consumes raw
            // bytes. Emitting them would serialise the whole PTY stream over
            // IPC for no reader. The screen snapshot travels separately.
            crate::term::feed(session_id, data.as_bytes());
            crate::stat!(
                "pty_bytes_native",
                r#""session":"{}","bytes":{}"#,
                session_id,
                data.len()
            );
            return Ok(());
        }
        crate::stat!(
            "pty_bytes_ipc",
            r#""session":"{}","bytes":{}"#,
            session_id,
            data.len()
        );
    }
    app.emit(
        "session-event",
        SessionEvent {
            session_id: session_id.to_string(),
            kind,
        },
    )
    .map_err(|e| e.to_string())
}

fn spawn_byte_pump(app: AppHandle, id: String) -> impl FnMut(Vec<u8>) + Send {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut acc = Vec::new();
        let mut deadline: Option<Instant> = None;
        loop {
            if acc.is_empty() {
                match rx.recv() {
                    Ok(chunk) => {
                        acc.extend(chunk);
                        deadline = Some(Instant::now() + Duration::from_millis(COALESCE_MS));
                    }
                    Err(_) => break,
                }
            }
            let wait = deadline
                .map(|d| d.saturating_duration_since(Instant::now()))
                .unwrap_or(Duration::from_millis(COALESCE_MS));
            match rx.recv_timeout(wait) {
                Ok(chunk) => {
                    acc.extend(chunk);
                    if acc.len() >= COALESCE_MAX {
                        flush_bytes(&app, &id, &mut acc);
                        deadline = None;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    flush_bytes(&app, &id, &mut acc);
                    deadline = None;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    flush_bytes(&app, &id, &mut acc);
                    break;
                }
            }
        }
    });
    move |data| {
        let _ = tx.send(data);
    }
}

fn flush_bytes(app: &AppHandle, id: &str, acc: &mut Vec<u8>) {
    if acc.is_empty() {
        return;
    }
    let data = std::mem::take(acc);
    let _ = emit(
        app,
        id,
        SessionEventKind::Bytes {
            data: String::from_utf8_lossy(&data).into(),
        },
    );
}

fn emit_fixture_write(app: &AppHandle, id: &str, data: &str, mode: &str) {
    let text = data.trim_end_matches(['\n', '\r']);
    if text.is_empty() {
        return;
    }
    if mode == "interactive_pty" {
        let _ = emit(
            app,
            id,
            SessionEventKind::Bytes {
                data: format!("{text}\r\n"),
            },
        );
        return;
    }
    if let Some(url) = extract_http_url(text) {
        let line = format!(
            r#"{{"type":"tool_use","name":"browser","url":{}}}"#,
            serde_json::to_string(&url).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = emit(app, id, SessionEventKind::JsonLine { line });
    }
    let thinking = serde_json::json!({
        "type": "content_block_delta",
        "delta": { "type": "thinking_delta", "thinking": "A ler o pedido." }
    });
    let _ = emit(app, id, SessionEventKind::JsonLine { line: thinking.to_string() });
    thread::sleep(Duration::from_millis(40));
    let tool = serde_json::json!({
        "type": "tool_use",
        "id": "fix_read",
        "name": "Read",
        "input": { "file_path": "README.md" }
    });
    let _ = emit(app, id, SessionEventKind::JsonLine { line: tool.to_string() });
    thread::sleep(Duration::from_millis(30));
    let done = serde_json::json!({ "type": "tool_result", "tool_use_id": "fix_read" });
    let _ = emit(app, id, SessionEventKind::JsonLine { line: done.to_string() });
    let reply = format!("fixture: {text}");
    let assistant = serde_json::json!({ "type": "assistant", "text": reply });
    let _ = emit(
        app,
        id,
        SessionEventKind::JsonLine {
            line: assistant.to_string(),
        },
    );
    let used = (text.len() as u32 + 80).min(8000);
    let usage = serde_json::json!({
        "type": "result",
        "usage": { "input_tokens": used, "output_tokens": 40 },
        "model": "fixture"
    });
    let _ = emit(
        app,
        id,
        SessionEventKind::JsonLine {
            line: usage.to_string(),
        },
    );
}

fn extract_http_url(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|t| t.starts_with("http://") || t.starts_with("https://"))
        .map(|s| s.trim_end_matches([',', '.', ')', ']']).to_string())
}

fn spawn_fixture(app: &AppHandle, id: &str, mode: SessionMode) {
    let app = app.clone();
    let id = id.to_string();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(30));
        match mode {
            SessionMode::JsonStream => {
                let _ = emit(
                    &app,
                    &id,
                    SessionEventKind::JsonLine {
                        line: r#"{"type":"assistant","text":"fixture ready"}"#.into(),
                    },
                );
            }
            SessionMode::InteractivePty => {
                let _ = emit(
                    &app,
                    &id,
                    SessionEventKind::Bytes {
                        data: "fixture pty ready\r\n".into(),
                    },
                );
            }
        }
    });
}

fn spawn_pty(
    app: &AppHandle,
    id: &str,
    binary: &PathBuf,
    args: &[String],
    cwd: &Path,
) -> Result<Live, String> {
    let app_e = app.clone();
    let id_e = id.to_string();
    let mut on_bytes = spawn_byte_pump(app.clone(), id.to_string());
    let pty = PtySession::spawn(
        binary,
        args,
        cwd,
        move |data| on_bytes(data),
        move |code| {
            let _ = emit(&app_e, &id_e, SessionEventKind::Exit { code });
        },
    )?;
    Ok(Live::Pty(pty))
}

fn spawn_piped(
    app: &AppHandle,
    id: &str,
    binary: &PathBuf,
    args: &[String],
    cwd: &Path,
) -> Result<Live, String> {
    let mut child = Command::new(binary)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("stdout")?;
    let stderr = child.stderr.take().ok_or("stderr")?;
    let stdin = child.stdin.take().ok_or("stdin")?;
    let child = Arc::new(Mutex::new(child));
    let child_w = child.clone();
    let app_o = app.clone();
    let id_o = id.to_string();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for _ in reader.lines() {}
    });
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = emit(&app_o, &id_o, SessionEventKind::JsonLine { line });
        }
        let code = child_w
            .lock()
            .ok()
            .and_then(|mut c| c.wait().ok())
            .and_then(|s| s.code())
            .unwrap_or(0);
        let _ = emit(&app_o, &id_o, SessionEventKind::Exit { code });
    });
    Ok(Live::Piped {
        stdin: Mutex::new(stdin),
        child,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn interrupt_pid_stops_sleep() {
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        interrupt_pid(child.id()).unwrap();
        let status = child.wait().unwrap();
        assert!(!status.success(), "SIGINT should end sleep before timeout");
    }
}
