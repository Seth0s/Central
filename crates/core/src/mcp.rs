use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Resource {
    pub uri: String,
    pub name: String,
}

#[derive(Default)]
pub struct McpRegistry {
    tools: Vec<Tool>,
    resources: Vec<Resource>,
}

impl McpRegistry {
    pub fn list_tools(&self) -> Vec<Tool> {
        self.tools.clone()
    }

    pub fn list_resources(&self) -> Vec<Resource> {
        self.resources.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_registry() {
        let r = McpRegistry::default();
        assert!(r.list_tools().is_empty());
        assert!(r.list_resources().is_empty());
    }
}
