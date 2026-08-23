use std::path::PathBuf;

use super::{which, Provider, SessionMode};

pub struct CursorProvider;

impl Provider for CursorProvider {
    fn id(&self) -> &'static str {
        "cursor"
    }

    fn binary_names(&self) -> &'static [&'static str] {
        // `cursor` on PATH is often the IDE launcher; the agent CLI is cursor-agent.
        &["cursor-agent"]
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
