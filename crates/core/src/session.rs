use std::collections::HashMap;

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionEventKind {
    Bytes { data: String },
    Screen { text: String },
    JsonLine { line: String },
    Exit { code: i32 },
    Error { message: String },
}

#[derive(Clone, Debug, Serialize)]
pub struct SessionEvent {
    pub session_id: String,
    #[serde(flatten)]
    pub kind: SessionEventKind,
}

#[derive(Clone, Debug, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub mode: String,
    pub cwd: String,
    pub model: Option<String>,
}

/// In-memory map keyed by session id. The Tauri runtime holds the live
/// processes; this type is the testable contract for N concurrent sessions.
#[derive(Clone, Debug, Default)]
pub struct SessionMap {
    inner: HashMap<String, SessionInfo>,
}

impl SessionMap {
    pub fn insert(&mut self, info: SessionInfo) {
        self.inner.insert(info.id.clone(), info);
    }

    pub fn get(&self, id: &str) -> Option<&SessionInfo> {
        self.inner.get(id)
    }

    pub fn remove(&mut self, id: &str) -> Option<SessionInfo> {
        self.inner.remove(id)
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    pub fn ids(&self) -> Vec<String> {
        self.inner.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str, name: &str) -> SessionInfo {
        SessionInfo {
            id: id.into(),
            name: name.into(),
            provider: "fixture".into(),
            mode: "interactive_pty".into(),
            cwd: "/tmp".into(),
            model: None,
        }
    }

    #[test]
    fn map_keeps_independent_sessions_and_removes_by_id() {
        let mut map = SessionMap::default();
        map.insert(info("a", "one"));
        map.insert(info("b", "two"));
        assert_eq!(map.len(), 2);
        assert_eq!(map.get("a").map(|s| s.name.as_str()), Some("one"));
        assert!(map.remove("a").is_some());
        assert_eq!(map.len(), 1);
        assert!(map.get("a").is_none());
        assert_eq!(map.get("b").unwrap().id, "b");
    }
}
