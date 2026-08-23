use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

pub const DEFAULT_COLS: u16 = 80;
pub const DEFAULT_ROWS: u16 = 24;
pub const MIN_COLS: u16 = 40;
pub const MIN_ROWS: u16 = 10;

pub fn useful_size(cols: u16, rows: u16) -> bool {
    cols >= MIN_COLS && rows >= MIN_ROWS
}

pub struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

/// Emit the longest complete UTF-8 prefix. Incomplete trailing bytes stay in `acc`.
/// Invalid sequences are dropped so a later CSI/ASCII byte is not stuck behind them.
fn drain_complete_utf8(acc: &mut Vec<u8>) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        match std::str::from_utf8(acc) {
            Ok(_) => {
                out.extend(std::mem::take(acc));
                return out;
            }
            Err(err) => {
                let valid = err.valid_up_to();
                if valid > 0 {
                    out.extend(acc.drain(..valid));
                }
                match err.error_len() {
                    Some(len) if !acc.is_empty() => {
                        let skip = len.min(acc.len());
                        acc.drain(..skip);
                    }
                    _ => return out,
                }
            }
        }
    }
}

impl PtySession {
    pub fn spawn(
        binary: &Path,
        args: &[String],
        cwd: &Path,
        on_bytes: impl FnMut(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce(i32) + Send + 'static,
    ) -> Result<Self, String> {
        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize {
                rows: DEFAULT_ROWS,
                cols: DEFAULT_COLS,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(binary);
        cmd.args(args);
        cmd.cwd(cwd);
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        thread::spawn(move || {
            let mut on_bytes = on_bytes;
            let mut buf = [0u8; 4096];
            let mut acc = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        acc.extend_from_slice(&buf[..n]);
                        let complete = drain_complete_utf8(&mut acc);
                        if !complete.is_empty() {
                            on_bytes(complete);
                        }
                    }
                    Err(_) => break,
                }
            }
            if !acc.is_empty() {
                on_bytes(String::from_utf8_lossy(&acc).as_bytes().to_vec());
            }
            on_exit(0);
        });
        Ok(Self {
            writer: Arc::new(Mutex::new(writer)),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut w = self.writer.lock().map_err(|e| e.to_string())?;
        w.write_all(data).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .lock()
            .map_err(|e| e.to_string())?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self) -> Result<(), String> {
        self.child
            .lock()
            .map_err(|e| e.to_string())?
            .kill()
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::drain_complete_utf8;

    #[test]
    fn keeps_incomplete_utf8_in_acc() {
        let mut acc = vec![b'a', 0xE2, 0x94]; // start of '─' (e2 94 80)
        let out = drain_complete_utf8(&mut acc);
        assert_eq!(out, b"a");
        assert_eq!(acc, vec![0xE2, 0x94]);
        acc.push(0x80);
        let rest = drain_complete_utf8(&mut acc);
        assert_eq!(rest, "─".as_bytes());
        assert!(acc.is_empty());
    }

    #[test]
    fn drops_invalid_then_continues() {
        let mut acc = vec![0xFF, b'x'];
        let out = drain_complete_utf8(&mut acc);
        assert_eq!(out, b"x");
        assert!(acc.is_empty());
    }

    #[test]
    fn useful_size_skips_tiny_panels() {
        assert!(!super::useful_size(24, 8));
        assert!(!super::useful_size(39, 24));
        assert!(super::useful_size(80, 24));
        assert!(super::useful_size(40, 10));
    }
}
