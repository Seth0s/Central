//! Best-effort vendor resume id discovery from on-disk CLI transcripts.
//!
//! Claude Code stores JSONL transcripts under
//! `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/` (default `~/.claude/projects/`),
//! either as `<session-id>.jsonl` or `sessions/<session-id>.jsonl`. The filename
//! stem is the id accepted by `claude --resume`.
//!
//! Codex has no equally stable public layout we trust here — callers get `None`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Encode an absolute cwd the way Claude Code names project dirs: every
/// non-alphanumeric character becomes `-`. Paths longer than 200 chars are
/// truncated with a short hash suffix (matches Claude Code docs).
pub fn encode_claude_project_dir(cwd: &Path) -> String {
    let raw = cwd.to_string_lossy();
    let encoded: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    if encoded.len() <= 200 {
        return encoded;
    }
    let hash = simple_hash(&raw);
    format!("{}-{:x}", &encoded[..200], hash)
}

fn simple_hash(s: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for b in s.as_bytes() {
        h ^= u32::from(*b);
        h = h.wrapping_mul(16777619);
    }
    h
}

fn claude_projects_root(home: &Path) -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir).join("projects");
        }
    }
    home.join(".claude").join("projects")
}

fn collect_jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().and_then(|n| n.to_str()) == Some("sessions") {
                collect_jsonl(&path, out);
            }
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

/// Newest Claude transcript stem for `cwd`, optionally only files touched at or
/// after `not_before`. Returns `None` when the project dir is missing or empty.
pub fn latest_claude_resume_id(
    home: &Path,
    cwd: &Path,
    not_before: Option<SystemTime>,
) -> Option<String> {
    let project = claude_projects_root(home).join(encode_claude_project_dir(cwd));
    if !project.is_dir() {
        return None;
    }
    let mut files = Vec::new();
    collect_jsonl(&project, &mut files);
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for path in files {
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        let Ok(mtime) = meta.modified() else {
            continue;
        };
        if let Some(min) = not_before {
            // Allow a small clock skew / write delay.
            if mtime + Duration::from_secs(2) < min {
                continue;
            }
        }
        match &best {
            Some((t, _)) if *t >= mtime => {}
            _ => best = Some((mtime, path)),
        }
    }
    best.and_then(|(_, path)| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    })
}

/// Probe a provider for a resume id. Only Claude is implemented.
pub fn probe_vendor_resume(
    provider: &str,
    home: &Path,
    cwd: &Path,
    not_before_unix_ms: Option<u64>,
) -> Option<String> {
    match provider {
        "claude" => {
            let not_before = not_before_unix_ms.and_then(|ms| {
                UNIX_EPOCH.checked_add(Duration::from_millis(ms))
            });
            latest_claude_resume_id(home, cwd, not_before)
        }
        _ => None,
    }
}

pub fn unix_ms_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn encodes_cwd_like_claude_docs() {
        assert_eq!(
            encode_claude_project_dir(Path::new("/home/me/proj")),
            "-home-me-proj"
        );
    }

    #[test]
    fn finds_newest_jsonl_stem() {
        let root = std::env::temp_dir().join(format!("cb-resume-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let project = root.join(".claude").join("projects").join("-tmp-demo");
        fs::create_dir_all(project.join("sessions")).unwrap();
        let older = project.join("sessions").join("old-sess.jsonl");
        let newer = project.join("sessions").join("new-sess.jsonl");
        fs::write(&older, "{}\n").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        let mut f = fs::File::create(&newer).unwrap();
        writeln!(f, "{{}}").unwrap();
        f.sync_all().unwrap();

        let id = latest_claude_resume_id(&root, Path::new("/tmp/demo"), None);
        assert_eq!(id.as_deref(), Some("new-sess"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn codex_is_explicitly_unsupported() {
        assert!(probe_vendor_resume("codex", Path::new("/tmp"), Path::new("/tmp"), None).is_none());
    }
}
