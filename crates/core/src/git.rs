use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::workspace::MAX_FILE_BYTES;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GitEntry {
    pub path: String,
    pub status: String,
    pub insertions: i32,
    pub deletions: i32,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GitStatus {
    pub repo: bool,
    pub branch: String,
    pub insertions: i32,
    pub deletions: i32,
    pub entries: Vec<GitEntry>,
}

pub fn status(cwd: &Path) -> Result<GitStatus, String> {
    if !cwd.is_dir() {
        return Err(format!("not a directory: {}", cwd.display()));
    }
    let top = match git(cwd, &["rev-parse", "--show-toplevel"]) {
        Ok(s) => s.trim().to_string(),
        Err(_) => {
            return Ok(GitStatus {
                repo: false,
                branch: String::new(),
                insertions: 0,
                deletions: 0,
                entries: vec![],
            });
        }
    };
    let root = PathBuf::from(&top);
    let branch = git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let porcelain = git(&root, &["status", "--porcelain=v1", "-uall"])?;
    let numstat = git(&root, &["diff", "--numstat", "HEAD"]).unwrap_or_else(|_| {
        let unstaged = git(&root, &["diff", "--numstat"]).unwrap_or_default();
        let staged = git(&root, &["diff", "--cached", "--numstat"]).unwrap_or_default();
        format!("{unstaged}{staged}")
    });
    let counts = parse_numstat(&numstat);
    let mut entries: Vec<GitEntry> = porcelain
        .lines()
        .filter_map(|line| parse_porcelain_line(line))
        .map(|(status, path)| {
            let (insertions, deletions) = counts
                .iter()
                .find(|(p, _, _)| p == &path)
                .map(|(_, i, d)| (*i, *d))
                .unwrap_or_else(|| {
                    if status.contains('?') {
                        (count_lines(root.join(&path)), 0)
                    } else {
                        (0, 0)
                    }
                });
            GitEntry {
                path,
                status,
                insertions,
                deletions,
            }
        })
        .collect();
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    let insertions = entries.iter().map(|e| e.insertions).sum();
    let deletions = entries.iter().map(|e| e.deletions).sum();
    Ok(GitStatus {
        repo: true,
        branch,
        insertions,
        deletions,
        entries,
    })
}

fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git {:?} failed", args)
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn parse_porcelain_line(line: &str) -> Option<(String, String)> {
    if line.len() < 4 {
        return None;
    }
    let status = line[..2].trim().to_string();
    let rest = line[3..].trim();
    let path = rest
        .rsplit_once(" -> ")
        .map(|(_, dest)| dest)
        .unwrap_or(rest)
        .trim_matches('"')
        .to_string();
    if path.is_empty() {
        return None;
    }
    Some((if status.is_empty() { line[..2].to_string() } else { status }, path))
}

fn parse_numstat(raw: &str) -> Vec<(String, i32, i32)> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let ins = parts.next()?.parse::<i32>().ok().unwrap_or(0);
            let del = parts.next()?.parse::<i32>().ok().unwrap_or(0);
            let path = parts.next()?.to_string();
            if path.is_empty() {
                return None;
            }
            Some((path, ins, del))
        })
        .collect()
}

fn count_lines(path: PathBuf) -> i32 {
    let Ok(meta) = fs::metadata(&path) else {
        return 0;
    };
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return 0;
    }
    fs::read_to_string(&path)
        .map(|s| s.lines().count() as i32)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn scratch(label: &str) -> PathBuf {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/var/tmp"));
        let dir = home
            .join(".cache")
            .join("ccdesk-test")
            .join(format!("{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git_ok(dir: &Path, args: &[&str]) {
        let st = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .unwrap();
        assert!(st.success(), "git {args:?}");
    }

    #[test]
    fn not_a_repo() {
        let dir = scratch("git-none");
        let st = status(&dir).unwrap();
        assert!(!st.repo);
        assert!(st.entries.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_modified_and_untracked() {
        let dir = scratch("git-st");
        git_ok(&dir, &["init"]);
        git_ok(&dir, &["config", "user.email", "dev@example.com"]);
        git_ok(&dir, &["config", "user.name", "Dev"]);
        git_ok(&dir, &["config", "commit.gpgsign", "false"]);
        fs::write(dir.join("kept.txt"), "a\n").unwrap();
        git_ok(&dir, &["add", "kept.txt"]);
        git_ok(&dir, &["commit", "-m", "init"]);
        fs::write(dir.join("kept.txt"), "a\nb\n").unwrap();
        fs::write(dir.join("new.txt"), "one\ntwo\n").unwrap();
        let st = status(&dir).unwrap();
        assert!(st.repo);
        let kept = st.entries.iter().find(|e| e.path == "kept.txt").unwrap();
        assert!(kept.insertions >= 1);
        let new = st.entries.iter().find(|e| e.path == "new.txt").unwrap();
        assert!(new.status.contains('?'));
        assert_eq!(new.insertions, 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_rename_porcelain() {
        let row = parse_porcelain_line("R  src/a.ts -> src/b.ts").unwrap();
        assert_eq!(row.1, "src/b.ts");
    }
}
