use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

const SKIP: &[&str] = &["node_modules", ".git", "dist", "target"];

#[derive(Clone, Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

pub fn list_children(root: &Path) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    let rd = fs::read_dir(root).map_err(|e| e.to_string())?;
    for ent in rd {
        let ent = ent.map_err(|e| e.to_string())?;
        let name = ent.file_name().to_string_lossy().to_string();
        if SKIP.contains(&name.as_str()) {
            continue;
        }
        let path = ent.path();
        out.push(DirEntry {
            name,
            path: path.display().to_string(),
            is_dir: path.is_dir(),
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(out)
}

pub fn resolve_open(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path.trim());
    if !p.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    Ok(p.canonicalize().unwrap_or(p))
}

pub(crate) const MAX_FILE_BYTES: u64 = 512_000;

pub fn confine(root: &Path, path: &str) -> Result<PathBuf, String> {
    let dest = confined_dest(root, path)?;
    dest.canonicalize().map_err(|e| e.to_string())
}

fn confined_dest(root: &Path, path: &str) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let raw = PathBuf::from(path.trim());
    let abs = if raw.is_absolute() {
        raw
    } else {
        root.join(raw)
    };
    if abs.exists() {
        let canon = abs.canonicalize().map_err(|e| e.to_string())?;
        if !canon.starts_with(&root) {
            return Err("path outside workspace".into());
        }
        return Ok(canon);
    }
    let parent = abs.parent().ok_or_else(|| "invalid path".to_string())?;
    let parent_canon = parent.canonicalize().map_err(|e| e.to_string())?;
    if !parent_canon.starts_with(&root) {
        return Err("path outside workspace".into());
    }
    let name = abs.file_name().ok_or_else(|| "invalid path".to_string())?;
    Ok(parent_canon.join(name))
}

pub fn list_confined(root: &Path, path: Option<&str>) -> Result<Vec<DirEntry>, String> {
    let dir = match path {
        Some(p) if !p.is_empty() => confine(root, p)?,
        _ => root.to_path_buf(),
    };
    if !dir.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }
    list_children(&dir)
}

pub fn read_text_file(root: &Path, path: &str) -> Result<String, String> {
    let file = confine(root, path)?;
    if !file.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let len = fs::metadata(&file).map_err(|e| e.to_string())?.len();
    if len > MAX_FILE_BYTES {
        return Err("file too large".into());
    }
    fs::read_to_string(&file).map_err(|e| e.to_string())
}

pub fn write_text_file(root: &Path, path: &str, body: &str) -> Result<(), String> {
    let file = confined_dest(root, path)?;
    if file.exists() && !file.is_file() {
        return Err(format!("not a file: {path}"));
    }
    if body.len() as u64 > MAX_FILE_BYTES {
        return Err("file too large".into());
    }
    fs::write(&file, body).map_err(|e| e.to_string())
}

pub fn read_any_file(path: &str) -> Result<String, String> {
    let file = PathBuf::from(path.trim());
    if !file.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let len = fs::metadata(&file).map_err(|e| e.to_string())?.len();
    if len > MAX_FILE_BYTES {
        return Err("file too large".into());
    }
    fs::read_to_string(&file).map_err(|e| e.to_string())
}

pub fn write_any_file(path: &str, body: &str) -> Result<(), String> {
    let file = PathBuf::from(path.trim());
    if body.len() as u64 > MAX_FILE_BYTES * 4 {
        return Err("file too large".into());
    }
    if let Some(dir) = file.parent() {
        if !dir.as_os_str().is_empty() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&file, body).map_err(|e| e.to_string())
}

fn is_markdown(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.ends_with(".md") || n.ends_with(".markdown") || n.ends_with(".mdx") || n.ends_with(".mmd")
}

pub fn list_markdown(root: &Path, max_depth: u8) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    walk_markdown(root, 0, max_depth, &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn walk_markdown(dir: &Path, depth: u8, max_depth: u8, out: &mut Vec<DirEntry>) -> Result<(), String> {
    if depth > max_depth {
        return Ok(());
    }
    for ent in list_children(dir)? {
        if ent.is_dir {
            walk_markdown(Path::new(&ent.path), depth + 1, max_depth, out)?;
        } else if is_markdown(&ent.name) {
            out.push(ent);
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
pub struct BrowseListing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<DirEntry>,
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn browse(path: Option<&str>) -> Result<BrowseListing, String> {
    let dir = match path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => home_dir(),
    };
    if !dir.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }
    let canon = dir.canonicalize().unwrap_or(dir);
    let parent = canon.parent().map(|p| p.display().to_string());
    Ok(BrowseListing {
        path: canon.display().to_string(),
        parent,
        entries: list_children(&canon)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn skips_node_modules() {
        let dir = std::env::temp_dir().join(format!("ccdesk-ws-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();
        let kids = list_children(&dir).unwrap();
        assert!(kids.iter().any(|e| e.name == "src"));
        assert!(!kids.iter().any(|e| e.name == "node_modules"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_text_stays_inside_workspace() {
        let dir = std::env::temp_dir().join(format!("ccdesk-read-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("note.md"), "# hi\n").unwrap();
        assert_eq!(read_text_file(&dir, "note.md").unwrap(), "# hi\n");
        let outside = std::env::temp_dir().join("ccdesk-outside.md");
        fs::write(&outside, "nope").unwrap();
        assert!(read_text_file(&dir, outside.to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_file(&outside);
    }

    #[test]
    fn write_text_stays_inside_workspace() {
        let dir = std::env::temp_dir().join(format!("ccdesk-write-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("note.md"), "# hi\n").unwrap();
        write_text_file(&dir, "note.md", "# ok\n").unwrap();
        assert_eq!(read_text_file(&dir, "note.md").unwrap(), "# ok\n");
        let outside = std::env::temp_dir().join("ccdesk-outside-write.md");
        fs::write(&outside, "nope").unwrap();
        assert!(write_text_file(&dir, outside.to_str().unwrap(), "x").is_err());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "nope");
        write_text_file(&dir, "fresh.md", "# new\n").unwrap();
        assert_eq!(read_text_file(&dir, "fresh.md").unwrap(), "# new\n");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_file(&outside);
    }

    #[test]
    fn write_any_file_creates_parent() {
        let dir = std::env::temp_dir().join(format!("ccdesk-any-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join("out").join("note.md");
        write_any_file(file.to_str().unwrap(), "# export\n").unwrap();
        assert_eq!(read_any_file(file.to_str().unwrap()).unwrap(), "# export\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_markdown_and_skips_node_modules() {
        let dir = std::env::temp_dir().join(format!("ccdesk-md-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("docs")).unwrap();
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("README.md"), "# r\n").unwrap();
        fs::write(dir.join("docs/note.md"), "# n\n").unwrap();
        fs::write(dir.join("node_modules/x.md"), "# skip\n").unwrap();
        let found = list_markdown(&dir, 3).unwrap();
        let names: Vec<_> = found.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"README.md"));
        assert!(names.contains(&"note.md"));
        assert!(!names.contains(&"x.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn browse_lists_dir_and_parent() {
        let dir = std::env::temp_dir().join(format!("ccdesk-browse-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        let listing = browse(Some(dir.to_str().unwrap())).unwrap();
        assert!(listing.entries.iter().any(|e| e.name == "src" && e.is_dir));
        assert!(listing.parent.is_some());
        let _ = fs::remove_dir_all(&dir);
    }
}

