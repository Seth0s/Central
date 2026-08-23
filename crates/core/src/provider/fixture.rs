use std::path::PathBuf;

use super::{Provider, SessionMode};

pub struct FixtureProvider;

impl Provider for FixtureProvider {
    fn id(&self) -> &'static str {
        "fixture"
    }

    fn binary_names(&self) -> &'static [&'static str] {
        &[]
    }

    fn detect(&self) -> Option<PathBuf> {
        Some(PathBuf::from("fixture"))
    }

    fn supports(&self, mode: SessionMode) -> bool {
        matches!(mode, SessionMode::InteractivePty)
    }

    fn spawn_args(&self, _mode: SessionMode) -> Vec<String> {
        Vec::new()
    }
}
