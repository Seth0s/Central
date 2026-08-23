use std::path::PathBuf;

use serde::{Deserialize, Serialize};

mod claude;
mod codex;
mod cursor;
mod fixture;

pub use fixture::FixtureProvider;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    JsonStream,
    InteractivePty,
}

/// How a user prompt is written to stdin of a live JSON session.
/// `PlainText` is the global fallback (text + newline).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PromptCodec {
    PlainText,
    ClaudeNdjson,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProviderInfo {
    pub id: String,
    pub detected: bool,
    pub binary: Option<String>,
    pub modes: Vec<SessionMode>,
}

pub trait Provider: Send + Sync {
    fn id(&self) -> &'static str;
    fn binary_names(&self) -> &'static [&'static str];
    fn detect(&self) -> Option<PathBuf>;
    fn supports(&self, mode: SessionMode) -> bool;
    fn spawn_args(&self, mode: SessionMode) -> Vec<String>;
}

pub fn which(names: &[&str]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn all() -> Vec<Box<dyn Provider>> {
    vec![
        Box::new(fixture::FixtureProvider),
        Box::new(claude::ClaudeProvider),
        Box::new(codex::CodexProvider),
        Box::new(cursor::CursorProvider),
    ]
}

pub fn by_id(id: &str) -> Option<Box<dyn Provider>> {
    all().into_iter().find(|p| p.id() == id)
}

pub fn prompt_codec(provider_id: &str, mode: SessionMode) -> PromptCodec {
    match (provider_id, mode) {
        ("claude", SessionMode::JsonStream) => PromptCodec::ClaudeNdjson,
        _ => PromptCodec::PlainText,
    }
}

/// Encode a human prompt for the vendor stdin. Empty input stays empty
/// (the caller must not write). Unknown vendors use the global PlainText fallback.
pub fn encode_prompt(codec: PromptCodec, text: &str) -> String {
    let text = text.trim_end_matches(['\n', '\r']);
    if text.trim().is_empty() {
        return String::new();
    }
    match codec {
        PromptCodec::PlainText => format!("{text}\n"),
        PromptCodec::ClaudeNdjson => {
            let line = serde_json::json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{ "type": "text", "text": text }]
                }
            });
            format!("{line}\n")
        }
    }
}

pub fn encode_prompt_for(provider_id: &str, mode: SessionMode, text: &str) -> String {
    encode_prompt(prompt_codec(provider_id, mode), text)
}

/// Documented vendor argv only. Unknown flags are never invented; callers
/// persist a cwd file (e.g. CLAUDE.md) when the CLI has no matching option.
pub fn extra_cli_args(
    provider_id: &str,
    model: Option<&str>,
    system_prompt: Option<&str>,
    resume_id: Option<&str>,
) -> Vec<String> {
    let model = model.map(str::trim).filter(|s| !s.is_empty());
    let system = system_prompt.map(str::trim).filter(|s| !s.is_empty());
    let resume = resume_id.map(str::trim).filter(|s| !s.is_empty());
    match provider_id {
        "claude" => {
            let mut out = Vec::new();
            if let Some(m) = model {
                out.push("--model".into());
                out.push(m.to_string());
            }
            if let Some(s) = system {
                out.push("--append-system-prompt".into());
                out.push(s.to_string());
            }
            if let Some(r) = resume {
                out.push("--resume".into());
                out.push(r.to_string());
            }
            out
        }
        "codex" => {
            let mut out = Vec::new();
            if let Some(m) = model {
                out.push("-m".into());
                out.push(m.to_string());
            }
            out
        }
        "cursor" => {
            let mut out = Vec::new();
            if let Some(m) = model {
                out.push("--model".into());
                out.push(m.to_string());
            }
            if let Some(r) = resume {
                out.push("--resume".into());
                out.push(r.to_string());
            }
            out
        }
        _ => Vec::new(),
    }
}

/// Unique argv per provider. Codex JSON resume is a subcommand, so it cannot
/// be a trailing extra flag.
pub fn session_argv(
    provider_id: &str,
    mode: SessionMode,
    model: Option<&str>,
    system_prompt: Option<&str>,
    resume_id: Option<&str>,
    continue_last: bool,
) -> Vec<String> {
    let model = model.map(str::trim).filter(|s| !s.is_empty());
    let resume = resume_id.map(str::trim).filter(|s| !s.is_empty());
    let continue_last = continue_last && resume.is_none();
    match (provider_id, mode) {
        ("codex", _) => {
            let mut out = Vec::new();
            if let Some(r) = resume {
                out.push("resume".into());
                out.push(r.to_string());
            }
            out.extend(extra_cli_args(provider_id, model, system_prompt, None));
            out
        }
        _ => {
            let Some(prov) = by_id(provider_id) else {
                return Vec::new();
            };
            let mut out = prov.spawn_args(mode);
            out.extend(extra_cli_args(
                provider_id,
                model,
                system_prompt,
                resume,
            ));
            if continue_last && provider_id == "claude" {
                out.push("--continue".into());
            }
            out
        }
    }
}

pub fn inventory() -> Vec<ProviderInfo> {
    all()
        .into_iter()
        .map(|p| {
            let binary = p.detect();
            let modes = [SessionMode::JsonStream, SessionMode::InteractivePty]
                .into_iter()
                .filter(|m| p.supports(*m))
                .collect();
            ProviderInfo {
                id: p.id().to_string(),
                detected: binary.is_some() || p.id() == "fixture",
                binary: binary.map(|b| b.display().to_string()),
                modes,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_is_always_detected_and_is_pty_only() {
        let p = FixtureProvider;
        assert_eq!(p.id(), "fixture");
        assert!(p.supports(SessionMode::InteractivePty));
        assert!(!p.supports(SessionMode::JsonStream));
        assert!(inventory().iter().any(|i| i.id == "fixture" && i.detected));
    }

    #[test]
    fn vendor_ids_are_stable() {
        let ids: Vec<_> = all().into_iter().map(|p| p.id().to_string()).collect();
        assert_eq!(ids, vec!["fixture", "claude", "codex", "cursor"]);
    }

    #[test]
    fn claude_tui_has_no_print_flags() {
        let args = session_argv("claude", SessionMode::InteractivePty, None, None, None, false);
        assert!(args.is_empty());
        assert!(!inventory().iter().any(|i| i.id == "claude" && i.modes.iter().any(|m| *m == SessionMode::JsonStream)));
    }

    #[test]
    fn claude_extra_args_are_documented_flags_only() {
        assert_eq!(
            extra_cli_args("claude", Some("sonnet"), Some("be brief"), None),
            vec!["--model", "sonnet", "--append-system-prompt", "be brief"]
        );
        assert_eq!(
            extra_cli_args("claude", None, None, Some("sess-1")),
            vec!["--resume", "sess-1"]
        );
        assert!(extra_cli_args("claude", Some("  "), None, None).is_empty());
        let continued = session_argv("claude", SessionMode::InteractivePty, None, None, None, true);
        assert!(continued.iter().any(|a| a == "--continue"), "claude --continue");
        assert!(!continued.iter().any(|a| a == "--resume"), "continue has no resume id");
        let id_wins = session_argv(
            "claude",
            SessionMode::InteractivePty,
            None,
            None,
            Some("sess-1"),
            true,
        );
        assert!(
            id_wins.windows(2).any(|w| w == ["--resume", "sess-1"]),
            "explicit id uses --resume"
        );
        assert!(!id_wins.iter().any(|a| a == "--continue"), "explicit id beats continue");
    }

    #[test]
    fn codex_tui_resume_is_a_subcommand() {
        assert_eq!(
            session_argv("codex", SessionMode::InteractivePty, Some("gpt"), None, None, false),
            vec!["-m", "gpt"]
        );
        assert_eq!(
            session_argv("codex", SessionMode::InteractivePty, None, None, Some("thr-1"), false),
            vec!["resume", "thr-1"]
        );
        assert_eq!(
            session_argv("codex", SessionMode::InteractivePty, Some("gpt"), None, Some("thr-1"), false),
            vec!["resume", "thr-1", "-m", "gpt"]
        );
    }

    #[test]
    fn cursor_is_pty_only_and_uses_agent_binary() {
        let p = cursor::CursorProvider;
        assert_eq!(p.binary_names(), &["cursor-agent"]);
        assert!(p.supports(SessionMode::InteractivePty));
        assert!(!p.supports(SessionMode::JsonStream));
        assert_eq!(
            extra_cli_args("cursor", Some("gpt-5"), None, Some("chat-1")),
            vec!["--model", "gpt-5", "--resume", "chat-1"]
        );
    }

    #[test]
    fn encode_prompt_claude_is_ndjson_user_else_plain_fallback() {
        let claude = encode_prompt_for("claude", SessionMode::JsonStream, "hello\n");
        assert!(claude.ends_with('\n'));
        let v: serde_json::Value = serde_json::from_str(claude.trim_end()).unwrap();
        assert_eq!(v["type"], "user");
        assert_eq!(v["message"]["content"][0]["text"], "hello");

        assert_eq!(
            encode_prompt_for("codex", SessionMode::JsonStream, "ping"),
            "ping\n"
        );
        assert_eq!(
            encode_prompt_for("cursor", SessionMode::InteractivePty, "hi"),
            "hi\n"
        );
        assert!(encode_prompt_for("claude", SessionMode::JsonStream, " \n").is_empty());
    }
}
