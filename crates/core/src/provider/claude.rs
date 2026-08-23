use std::path::PathBuf;

use super::{which, Provider, SessionMode};

pub struct ClaudeProvider;

impl Provider for ClaudeProvider {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn binary_names(&self) -> &'static [&'static str] {
        &["claude"]
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
