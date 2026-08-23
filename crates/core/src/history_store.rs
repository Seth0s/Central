use std::path::{Path, PathBuf};

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde_json::Value;

use crate::history::{
    folder_name, load as load_json, now_secs, History, Repo, SavedAgent, SavedSession, MAX_REPOS,
    MAX_SESSIONS,
};

const SCHEMA: &str = "
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS repos (
  path TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  opened_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  goal TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  resume_id TEXT,
  sort_idx INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_resume
  ON agents(resume_id) WHERE resume_id IS NOT NULL AND resume_id != '';
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_agent_seq ON turns(agent_id, seq);
";

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(db_path: &Path, json_legacy: Option<&Path>) -> Result<Self, String> {
        if let Some(dir) = db_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        let store = Self { conn };
        if store.is_empty()? {
            if let Some(json) = json_legacy {
                if json.is_file() {
                    if let Ok(hist) = load_json(json) {
                        store.import(&hist)?;
                    }
                }
            }
        }
        Ok(store)
    }

    fn is_empty(&self) -> Result<bool, String> {
        let groups: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM groups", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let repos: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM repos", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(groups == 0 && repos == 0)
    }

    fn import(&self, hist: &History) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for repo in &hist.repositories {
            tx.execute(
                "INSERT OR REPLACE INTO repos(path, name, opened_at) VALUES (?1, ?2, ?3)",
                params![repo.path, repo.name, repo.opened_at],
            )
            .map_err(|e| e.to_string())?;
        }
        for (gi, g) in hist.sessions.iter().enumerate() {
            tx.execute(
                "INSERT OR REPLACE INTO groups(id, title, cwd, updated_at, pinned, archived, goal, brief)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    g.id,
                    g.title,
                    g.cwd,
                    g.updated_at,
                    g.pinned as i64,
                    g.archived as i64,
                    g.goal,
                    g.brief
                ],
            )
            .map_err(|e| e.to_string())?;
            for (ai, a) in g.agents.iter().enumerate() {
                tx.execute(
                    "INSERT OR REPLACE INTO agents(id, group_id, provider, name, mode, resume_id, sort_idx)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        a.id,
                        g.id,
                        a.provider,
                        a.name,
                        a.mode,
                        a.resume_id,
                        (gi * 100 + ai) as i64
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get(&self) -> Result<History, String> {
        let mut repos = Vec::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT path, name, opened_at FROM repos ORDER BY opened_at DESC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(Repo {
                        path: r.get(0)?,
                        name: r.get(1)?,
                        opened_at: r.get(2)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                repos.push(row.map_err(|e| e.to_string())?);
            }
        }
        let mut sessions = Vec::new();
        {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT id, title, cwd, updated_at, pinned, archived, goal, brief
                     FROM groups ORDER BY pinned DESC, updated_at DESC",
                )
                .map_err(|e| e.to_string())?;
            let groups: Vec<SavedSession> = stmt
                .query_map([], |r| {
                    Ok(SavedSession {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        cwd: r.get(2)?,
                        updated_at: r.get(3)?,
                        agents: Vec::new(),
                        pinned: r.get::<_, i64>(4)? != 0,
                        archived: r.get::<_, i64>(5)? != 0,
                        goal: r.get(6)?,
                        brief: r.get(7)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            for mut g in groups {
                g.agents = self.agents_for(&g.id)?;
                sessions.push(g);
            }
        }
        Ok(History {
            repositories: repos,
            sessions,
        })
    }

    fn agents_for(&self, group_id: &str) -> Result<Vec<SavedAgent>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, provider, name, mode, resume_id FROM agents
                 WHERE group_id = ?1 ORDER BY sort_idx ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([group_id], |r| {
                Ok(SavedAgent {
                    id: r.get(0)?,
                    provider: r.get(1)?,
                    name: r.get(2)?,
                    mode: r.get(3)?,
                    resume_id: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn remember_repo(&self, path: &str) -> Result<History, String> {
        let path = path.trim();
        if path.is_empty() {
            return self.get();
        }
        let canon = PathBuf::from(path).display().to_string();
        let name = folder_name(&canon);
        self.conn
            .execute(
                "INSERT INTO repos(path, name, opened_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(path) DO UPDATE SET name = excluded.name, opened_at = excluded.opened_at",
                params![canon, name, now_secs()],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "DELETE FROM repos WHERE path IN (
                   SELECT path FROM repos ORDER BY opened_at DESC LIMIT -1 OFFSET ?1
                 )",
                [MAX_REPOS as i64],
            )
            .map_err(|e| e.to_string())?;
        self.get()
    }

    pub fn upsert_session(&self, session: SavedSession) -> Result<History, String> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO groups(id, title, cwd, updated_at, pinned, archived, goal, brief)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               cwd = excluded.cwd,
               updated_at = excluded.updated_at,
               pinned = excluded.pinned,
               archived = excluded.archived,
               goal = excluded.goal,
               brief = excluded.brief",
            params![
                session.id,
                session.title,
                session.cwd,
                session.updated_at,
                session.pinned as i64,
                session.archived as i64,
                session.goal,
                session.brief
            ],
        )
        .map_err(|e| e.to_string())?;

        let keep: Vec<String> = session.agents.iter().map(|a| a.id.clone()).collect();
        if keep.is_empty() {
            tx.execute("DELETE FROM agents WHERE group_id = ?1", [&session.id])
                .map_err(|e| e.to_string())?;
        } else {
            let mut sql = String::from("DELETE FROM agents WHERE group_id = ?1 AND id NOT IN (");
            sql.push_str(&keep.iter().map(|_| "?").collect::<Vec<_>>().join(","));
            sql.push(')');
            let mut vals: Vec<String> = vec![session.id.clone()];
            vals.extend(keep);
            tx.execute(&sql, params_from_iter(vals.iter()))
                .map_err(|e| e.to_string())?;
        }

        for (i, agent) in session.agents.iter().enumerate() {
            if let Some(rid) = agent.resume_id.as_deref().filter(|s| !s.is_empty()) {
                tx.execute(
                    "UPDATE agents SET resume_id = NULL WHERE resume_id = ?1 AND id != ?2",
                    params![rid, agent.id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "INSERT INTO agents(id, group_id, provider, name, mode, resume_id, sort_idx)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                   group_id = excluded.group_id,
                   provider = excluded.provider,
                   name = excluded.name,
                   mode = excluded.mode,
                   resume_id = excluded.resume_id,
                   sort_idx = excluded.sort_idx",
                params![
                    agent.id,
                    session.id,
                    agent.provider,
                    agent.name,
                    agent.mode,
                    agent.resume_id,
                    i as i64
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.execute(
            "DELETE FROM groups WHERE id IN (
               SELECT id FROM groups ORDER BY pinned DESC, updated_at DESC LIMIT -1 OFFSET ?1
             )",
            [MAX_SESSIONS as i64],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        self.get()
    }

    pub fn delete_session(&self, id: &str) -> Result<History, String> {
        self.conn
            .execute("DELETE FROM groups WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        self.get()
    }

    pub fn delete_agent(&self, session_id: &str, agent_id: &str) -> Result<History, String> {
        self.conn
            .execute(
                "DELETE FROM agents WHERE id = ?1 AND group_id = ?2",
                params![agent_id, session_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "UPDATE groups SET updated_at = ?1 WHERE id = ?2",
                params![now_secs(), session_id],
            )
            .map_err(|e| e.to_string())?;
        self.get()
    }

    pub fn move_agent(&self, from_session: &str, to_session: &str, agent_id: &str) -> Result<History, String> {
        if from_session == to_session {
            return self.get();
        }
        let from_cwd: String = self
            .conn
            .query_row("SELECT cwd FROM groups WHERE id = ?1", [from_session], |r| r.get(0))
            .map_err(|_| "session not found".to_string())?;
        let to_cwd: String = self
            .conn
            .query_row("SELECT cwd FROM groups WHERE id = ?1", [to_session], |r| r.get(0))
            .map_err(|_| "session not found".to_string())?;
        if from_cwd != to_cwd {
            return Err("agent can only move between sessions in the same workspace".into());
        }
        let exists: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM agents WHERE id = ?1 AND group_id = ?2",
                params![agent_id, from_session],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err("agent not found".into());
        }
        let next_idx: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(sort_idx), -1) + 1 FROM agents WHERE group_id = ?1",
                [to_session],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "UPDATE agents SET group_id = ?1, sort_idx = ?2 WHERE id = ?3",
                params![to_session, next_idx, agent_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "UPDATE groups SET updated_at = ?1 WHERE id = ?2",
                params![now_secs(), to_session],
            )
            .map_err(|e| e.to_string())?;
        self.get()
    }

    pub fn list_turns(&self, agent_id: &str) -> Result<Vec<Value>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload FROM turns WHERE agent_id = ?1 ORDER BY seq ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([agent_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let raw = row.map_err(|e| e.to_string())?;
            out.push(serde_json::from_str(&raw).map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn put_turn(&self, agent_id: &str, seq: i64, turn: &Value) -> Result<(), String> {
        let id = turn
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "turn id required".to_string())?;
        let payload = serde_json::to_string(turn).map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT INTO turns(id, agent_id, seq, payload) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                   seq = excluded.seq,
                   payload = excluded.payload
                 WHERE turns.agent_id = excluded.agent_id",
                params![id, agent_id, seq, payload],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn replace_turns(&self, agent_id: &str, turns: &[Value]) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM turns WHERE agent_id = ?1", [agent_id])
            .map_err(|e| e.to_string())?;
        for (i, turn) in turns.iter().enumerate() {
            let id = turn
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "turn id required".to_string())?;
            let payload = serde_json::to_string(turn).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO turns(id, agent_id, seq, payload) VALUES (?1, ?2, ?3, ?4)",
                params![id, agent_id, i as i64, payload],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(label: &str) -> PathBuf {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/var/tmp"));
        let dir = home
            .join(".cache")
            .join("ccdesk-test")
            .join(format!("hist-db-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample() -> SavedSession {
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
    fn sqlite_roundtrip_and_json_import() {
        let dir = scratch("import");
        let json = dir.join("history.json");
        let db = dir.join("history.db");
        let mut h = History::default();
        crate::history::remember_repo(&mut h, "/tmp/ws");
        crate::history::upsert_session(&mut h, sample());
        crate::history::save(&json, &h).unwrap();
        let store = Store::open(&db, Some(&json)).unwrap();
        let loaded = store.get().unwrap();
        assert_eq!(loaded.repositories[0].name, "ws");
        assert_eq!(loaded.sessions[0].agents[0].resume_id.as_deref(), Some("vend-1"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn upsert_keeps_empty_group_and_resume_unique() {
        let dir = scratch("upsert");
        let store = Store::open(&dir.join("history.db"), None).unwrap();
        store
            .upsert_session(SavedSession {
                id: "empty".into(),
                title: "Nova".into(),
                cwd: "/a/Projects".into(),
                updated_at: 1,
                agents: vec![],
                pinned: false,
                archived: false,
                goal: "ship".into(),
                brief: "be brief".into(),
            })
            .unwrap();
        store.upsert_session(sample()).unwrap();
        let h = store.get().unwrap();
        assert!(h.sessions.iter().any(|s| s.id == "empty" && s.agents.is_empty()));
        let mut other = sample();
        other.id = "g2".into();
        other.agents[0].id = "a2".into();
        other.agents[0].resume_id = Some("vend-1".into());
        store.upsert_session(other).unwrap();
        let h = store.get().unwrap();
        let with_rid: Vec<_> = h
            .sessions
            .iter()
            .flat_map(|s| s.agents.iter())
            .filter(|a| a.resume_id.as_deref() == Some("vend-1"))
            .collect();
        assert_eq!(with_rid.len(), 1);
        assert_eq!(with_rid[0].id, "a2");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn json_import_runs_only_when_db_is_empty() {
        let dir = scratch("once");
        let json = dir.join("history.json");
        let db = dir.join("history.db");
        let mut h = History::default();
        crate::history::upsert_session(&mut h, sample());
        crate::history::save(&json, &h).unwrap();
        Store::open(&db, Some(&json)).unwrap();
        let mut extra = History::default();
        let mut other = sample();
        other.id = "g-extra".into();
        other.agents[0].id = "a-extra".into();
        other.agents[0].resume_id = None;
        crate::history::upsert_session(&mut extra, other);
        crate::history::save(&json, &extra).unwrap();
        let store = Store::open(&db, Some(&json)).unwrap();
        let loaded = store.get().unwrap();
        assert!(loaded.sessions.iter().any(|s| s.id == "g1"));
        assert!(!loaded.sessions.iter().any(|s| s.id == "g-extra"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn put_and_list_turns() {
        let dir = scratch("turns");
        let store = Store::open(&dir.join("history.db"), None).unwrap();
        store.upsert_session(sample()).unwrap();
        let mut turn = serde_json::json!({
            "id": "t1",
            "user": "hi",
            "thinking": "",
            "tools": [],
            "assistant": "hello",
            "usage": null,
            "startedAt": 1,
            "endedAt": 2
        });
        store.put_turn("a1", 0, &turn).unwrap();
        turn["assistant"] = serde_json::json!("hello!");
        store.put_turn("a1", 0, &turn).unwrap();
        let listed = store.list_turns("a1").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0]["assistant"], "hello!");
        let _ = fs::remove_dir_all(&dir);
    }

    fn turn(id: &str, user: &str) -> Value {
        serde_json::json!({
            "id": id,
            "user": user,
            "thinking": "",
            "tools": [],
            "assistant": "",
            "usage": null,
            "startedAt": 1,
            "endedAt": 2
        })
    }

    #[test]
    fn put_turn_does_not_steal_another_agents_row() {
        let dir = scratch("no-steal");
        let store = Store::open(&dir.join("history.db"), None).unwrap();
        store.upsert_session(sample()).unwrap();
        let mut other = sample();
        other.id = "g2".into();
        other.agents[0].id = "a2".into();
        other.agents[0].resume_id = None;
        store.upsert_session(other).unwrap();
        store.put_turn("a1", 0, &turn("m1", "from a1")).unwrap();
        store.put_turn("a2", 0, &turn("m1", "from a2")).unwrap();
        let a1 = store.list_turns("a1").unwrap();
        let a2 = store.list_turns("a2").unwrap();
        assert_eq!(a1.len(), 1);
        assert_eq!(a1[0]["user"], "from a1");
        assert!(a2.is_empty(), "colliding id must not move the row to the other agent");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn replace_turns_rewrites_one_agent_without_touching_the_other() {
        let dir = scratch("replace");
        let store = Store::open(&dir.join("history.db"), None).unwrap();
        store.upsert_session(sample()).unwrap();
        let mut other = sample();
        other.id = "g2".into();
        other.agents[0].id = "a2".into();
        other.agents[0].resume_id = None;
        store.upsert_session(other).unwrap();
        store.put_turn("a1", 0, &turn("t-a1-0", "old")).unwrap();
        store.put_turn("a1", 1, &turn("t-a1-1", "extra")).unwrap();
        store.put_turn("a2", 0, &turn("t-a2-0", "keep")).unwrap();
        store
            .replace_turns("a1", &[turn("t-a1-new", "fresh")])
            .unwrap();
        let a1 = store.list_turns("a1").unwrap();
        let a2 = store.list_turns("a2").unwrap();
        assert_eq!(a1.len(), 1);
        assert_eq!(a1[0]["user"], "fresh");
        assert_eq!(a2.len(), 1);
        assert_eq!(a2[0]["user"], "keep");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_agent_same_cwd_only() {
        let dir = scratch("move");
        let store = Store::open(&dir.join("history.db"), None).unwrap();
        store.upsert_session(sample()).unwrap();
        let mut other = sample();
        other.id = "g2".into();
        other.agents[0].id = "a2".into();
        other.agents[0].resume_id = None;
        store.upsert_session(other).unwrap();
        store.move_agent("g1", "g2", "a1").unwrap();
        let h = store.get().unwrap();
        let g1 = h.sessions.iter().find(|s| s.id == "g1").unwrap();
        assert!(g1.agents.is_empty());
        let g2 = h.sessions.iter().find(|s| s.id == "g2").unwrap();
        assert!(g2.agents.iter().any(|a| a.id == "a1"));
        let mut foreign = sample();
        foreign.id = "g3".into();
        foreign.cwd = "/b/Else".into();
        foreign.agents[0].id = "a3".into();
        foreign.agents[0].resume_id = None;
        store.upsert_session(foreign).unwrap();
        assert!(store.move_agent("g2", "g3", "a1").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
