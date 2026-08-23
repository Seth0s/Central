use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize};

pub(crate) const MAX_REPOS: usize = 40;
pub(crate) const MAX_SESSIONS: usize = 200;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct History {
    #[serde(default)]
    pub repositories: Vec<Repo>,
    #[serde(default)]
    pub sessions: Vec<SavedSession>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Repo {
    pub path: String,
    pub name: String,
    pub opened_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SavedAgent {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub mode: String,
    #[serde(default)]
    pub resume_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SavedSession {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub updated_at: i64,
    pub agents: Vec<SavedAgent>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub archived: bool,
    /// What this agent group is solving. Stored now; used as shared CLI context.
    #[serde(default)]
    pub goal: String,
    /// Shared instructions for every agent in the group. Not a message bus.
    #[serde(default)]
    pub brief: String,
}

#[derive(Deserialize)]
struct SavedSessionRaw {
    id: String,
    #[serde(default)]
    title: String,
    cwd: String,
    #[serde(default, alias = "updatedAt")]
    updated_at: i64,
    #[serde(default)]
    agents: Vec<SavedAgent>,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    resume_id: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    goal: String,
    #[serde(default)]
    brief: String,
}

impl<'de> Deserialize<'de> for SavedSession {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = SavedSessionRaw::deserialize(deserializer)?;
        Ok(normalize_session(raw))
    }
}

fn normalize_session(raw: SavedSessionRaw) -> SavedSession {
    let agents = if !raw.agents.is_empty() {
        raw.agents
    } else if !raw.provider.is_empty() {
        vec![SavedAgent {
            id: raw.id.clone(),
            provider: raw.provider.clone(),
            name: if raw.name.is_empty() {
                raw.provider
            } else {
                raw.name
            },
            mode: if raw.mode.is_empty() {
                "json_stream".into()
            } else {
                raw.mode
            },
            resume_id: raw.resume_id,
        }]
    } else {
        Vec::new()
    };
    let title = if raw.title.is_empty() {
        agents
            .first()
            .map(|a| a.name.clone())
            .unwrap_or_else(|| "Sessão".into())
    } else {
        raw.title
    };
    SavedSession {
        id: raw.id,
        title,
        cwd: raw.cwd,
        updated_at: raw.updated_at,
        agents,
        pinned: raw.pinned,
        archived: raw.archived,
        goal: raw.goal,
        brief: raw.brief,
    }
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn folder_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(path)
        .to_string()
}

pub fn load(path: &Path) -> Result<History, String> {
    if !path.is_file() {
        return Ok(History::default());
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(History::default());
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn save(path: &Path, history: &History) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn remember_repo(history: &mut History, path: &str) {
    let path = path.trim();
    if path.is_empty() {
        return;
    }
    let canon = PathBuf::from(path).display().to_string();
    history.repositories.retain(|r| r.path != canon);
    history.repositories.insert(
        0,
        Repo {
            name: folder_name(&canon),
            path: canon,
            opened_at: now_secs(),
        },
    );
    history.repositories.truncate(MAX_REPOS);
}

pub fn upsert_session(history: &mut History, session: SavedSession) {
    let rids: Vec<String> = session
        .agents
        .iter()
        .filter_map(|a| a.resume_id.clone())
        .filter(|s| !s.is_empty())
        .collect();
    history.sessions.retain(|s| s.id != session.id);
    for s in &mut history.sessions {
        s.agents.retain(|a| match a.resume_id.as_deref() {
            Some(rid) if rids.iter().any(|x| x == rid) => false,
            _ => true,
        });
    }
    history.sessions.insert(0, session);
    history.sessions.truncate(MAX_SESSIONS);
}

pub fn delete_session(history: &mut History, id: &str) {
    history.sessions.retain(|s| s.id != id);
}

pub fn delete_agent(history: &mut History, session_id: &str, agent_id: &str) {
    if let Some(s) = history.sessions.iter_mut().find(|s| s.id == session_id) {
        s.agents.retain(|a| a.id != agent_id);
        s.updated_at = now_secs();
    }
}

pub fn move_agent(
    history: &mut History,
    from_session: &str,
    to_session: &str,
    agent_id: &str,
) -> Result<(), String> {
    if from_session == to_session {
        return Ok(());
    }
    let from_cwd = history
        .sessions
        .iter()
        .find(|s| s.id == from_session)
        .map(|s| s.cwd.clone())
        .ok_or_else(|| "session not found".to_string())?;
    let to_cwd = history
        .sessions
        .iter()
        .find(|s| s.id == to_session)
        .map(|s| s.cwd.clone())
        .ok_or_else(|| "session not found".to_string())?;
    if from_cwd != to_cwd {
        return Err("agent can only move between sessions in the same workspace".into());
    }
    let agent = {
        let src = history
            .sessions
            .iter_mut()
            .find(|s| s.id == from_session)
            .ok_or_else(|| "session not found".to_string())?;
        let idx = src
            .agents
            .iter()
            .position(|a| a.id == agent_id)
            .ok_or_else(|| "agent not found".to_string())?;
        src.agents.remove(idx)
    };
    if let Some(dest) = history.sessions.iter_mut().find(|s| s.id == to_session) {
        dest.agents.retain(|a| a.id != agent_id);
        dest.agents.push(agent);
        dest.updated_at = now_secs();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/var/tmp"));
        let dir = home
            .join(".cache")
            .join("ccdesk-test")
            .join(format!("hist-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_group() -> SavedSession {
        SavedSession {
            id: "g1".into(),
            title: "login".into(),
            cwd: "/a/Projects".into(),
            updated_at: 2,
            agents: vec![SavedAgent {
                id: "a1".into(),
                provider: "claude".into(),
                name: "Claude".into(),
                mode: "json_stream".into(),
                resume_id: Some("vend-1".into()),
            }],
            pinned: false,
            archived: false,
            goal: String::new(),
            brief: String::new(),
        }
    }

    #[test]
    fn remembers_repo_most_recent_first() {
        let mut h = History::default();
        remember_repo(&mut h, "/a/Projects");
        remember_repo(&mut h, "/a/Infra");
        remember_repo(&mut h, "/a/Projects");
        assert_eq!(h.repositories.len(), 2);
        assert_eq!(h.repositories[0].path, "/a/Projects");
        assert_eq!(h.repositories[0].name, "Projects");
    }

    #[test]
    fn upsert_replaces_by_id_and_resume() {
        let mut h = History::default();
        upsert_session(&mut h, sample_group());
        let mut next = sample_group();
        next.title = "new title".into();
        upsert_session(&mut h, next);
        assert_eq!(h.sessions.len(), 1);
        assert_eq!(h.sessions[0].title, "new title");
        assert_eq!(h.sessions[0].agents[0].id, "a1");
    }

    #[test]
    fn migrates_flat_session_json() {
        let raw = r#"{
            "repositories": [],
            "sessions": [{
                "id": "ui-1",
                "provider": "claude",
                "name": "Claude",
                "title": "old",
                "cwd": "/a/Projects",
                "mode": "json_stream",
                "resume_id": "vend-1",
                "updated_at": 1
            }]
        }"#;
        let h: History = serde_json::from_str(raw).unwrap();
        assert_eq!(h.sessions.len(), 1);
        assert_eq!(h.sessions[0].id, "ui-1");
        assert_eq!(h.sessions[0].agents.len(), 1);
        assert_eq!(h.sessions[0].agents[0].provider, "claude");
        assert_eq!(h.sessions[0].agents[0].resume_id.as_deref(), Some("vend-1"));
        assert!(!h.sessions[0].pinned);
        assert!(!h.sessions[0].archived);
        assert!(h.sessions[0].goal.is_empty());
        assert!(h.sessions[0].brief.is_empty());
    }

    #[test]
    fn deserializes_frontend_empty_session_payload() {
        let raw = r#"{
            "id": "g-new",
            "title": "Sessão",
            "cwd": "/a/Projects",
            "updated_at": 99,
            "agents": [],
            "pinned": false,
            "archived": false,
            "goal": "ship",
            "brief": "be brief"
        }"#;
        let session: SavedSession = serde_json::from_str(raw).unwrap();
        assert!(session.agents.is_empty());
        assert_eq!(session.goal, "ship");
        let mut h = History::default();
        upsert_session(&mut h, session);
        assert_eq!(h.sessions.len(), 1);
        assert_eq!(h.sessions[0].cwd, "/a/Projects");
        assert!(h.sessions[0].agents.is_empty());
    }

    #[test]
    fn upsert_keeps_empty_session() {
        let mut h = History::default();
        upsert_session(
            &mut h,
            SavedSession {
                id: "empty".into(),
                title: "Nova".into(),
                cwd: "/a/Projects".into(),
                updated_at: 1,
                agents: vec![],
                pinned: false,
                archived: false,
                goal: String::new(),
                brief: String::new(),
            },
        );
        assert_eq!(h.sessions.len(), 1);
        assert!(h.sessions[0].agents.is_empty());
        upsert_session(&mut h, sample_group());
        assert_eq!(h.sessions.len(), 2);
        assert!(h.sessions.iter().any(|s| s.id == "empty" && s.agents.is_empty()));
    }

    #[test]
    fn delete_last_agent_keeps_group() {
        let mut h = History::default();
        upsert_session(&mut h, sample_group());
        delete_agent(&mut h, "g1", "a1");
        assert_eq!(h.sessions.len(), 1);
        assert!(h.sessions[0].agents.is_empty());
        assert_eq!(h.sessions[0].id, "g1");
    }

    #[test]
    fn move_last_agent_keeps_source_group() {
        let mut h = History::default();
        upsert_session(&mut h, sample_group());
        let mut other = sample_group();
        other.id = "g2".into();
        other.title = "other".into();
        other.agents[0].id = "a2".into();
        other.agents[0].resume_id = None;
        upsert_session(&mut h, other);
        move_agent(&mut h, "g1", "g2", "a1").unwrap();
        let src = h.sessions.iter().find(|s| s.id == "g1").unwrap();
        assert!(src.agents.is_empty());
        let dest = h.sessions.iter().find(|s| s.id == "g2").unwrap();
        assert!(dest.agents.iter().any(|a| a.id == "a1"));
    }

    #[test]
    fn move_agent_same_cwd_only() {
        let mut h = History::default();
        upsert_session(&mut h, sample_group());
        let mut other = sample_group();
        other.id = "g2".into();
        other.title = "other".into();
        other.agents[0].id = "a2".into();
        other.agents[0].resume_id = None;
        upsert_session(&mut h, other);
        move_agent(&mut h, "g1", "g2", "a1").unwrap();
        let dest = h.sessions.iter().find(|s| s.id == "g2").unwrap();
        assert!(dest.agents.iter().any(|a| a.id == "a1"));
        assert!(h.sessions.iter().all(|s| s.id != "g1" || s.agents.iter().all(|a| a.id != "a1")));

        let mut foreign = sample_group();
        foreign.id = "g3".into();
        foreign.cwd = "/b/Else".into();
        foreign.agents[0].id = "a3".into();
        foreign.agents[0].resume_id = None;
        upsert_session(&mut h, foreign);
        assert!(move_agent(&mut h, "g2", "g3", "a1").is_err());
    }

    #[test]
    fn roundtrip_file() {
        let dir = scratch("round");
        let file = dir.join("history.json");
        let mut h = History::default();
        remember_repo(&mut h, "/tmp/ws");
        save(&file, &h).unwrap();
        let loaded = load(&file).unwrap();
        assert_eq!(loaded.repositories[0].name, "ws");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn roundtrip_keeps_empty_session() {
        let dir = scratch("empty-sess");
        let file = dir.join("history.json");
        let mut h = History::default();
        remember_repo(&mut h, "/tmp/ws");
        upsert_session(
            &mut h,
            SavedSession {
                id: "g-empty".into(),
                title: "Nova".into(),
                cwd: "/tmp/ws".into(),
                updated_at: 9,
                agents: vec![],
                pinned: false,
                archived: false,
                goal: "ship".into(),
                brief: "be brief".into(),
            },
        );
        save(&file, &h).unwrap();
        let loaded = load(&file).unwrap();
        assert_eq!(loaded.sessions.len(), 1);
        assert_eq!(loaded.sessions[0].id, "g-empty");
        assert!(loaded.sessions[0].agents.is_empty());
        assert_eq!(loaded.sessions[0].goal, "ship");
        let _ = fs::remove_dir_all(&dir);
    }
}
