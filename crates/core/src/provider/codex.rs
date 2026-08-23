use std::path::PathBuf;

use super::{which, Provider, SessionMode};

pub struct CodexProvider;

impl Provider for CodexProvider {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn binary_names(&self) -> &'static [&'static str] {
        &["codex"]
    }

    fn detect(&self) -> Option<PathBuf> {
        which(self.binary_names())
    }

    fn supports(&self, mode: SessionMode) -> bool {
        matches!(mode, SessionMode::InteractivePty)
    }

    fn spawn_args(&self, _mode: SessionMode) -> Vec<String> {
        Vec::new()
    }
}
