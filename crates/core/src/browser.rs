/// URL rules for the in-app WRY browser webview.

pub fn normalize_url(raw: &str) -> Result<String, String> {
    let t = raw.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("about:blank") {
        return Ok("about:blank".into());
    }
    let scheme = t.split_once(':').map(|(s, _)| s.to_ascii_lowercase());
    match scheme.as_deref() {
        Some("http") | Some("https") => Ok(t.to_string()),
        Some("about") => Err("unsupported url scheme".into()),
        Some("javascript") | Some("file") | Some("data") | Some("blob") | Some("vbscript") => {
            Err("unsupported url scheme".into())
        }
        Some(_) if t.contains("://") => Err("unsupported url scheme".into()),
        _ if t.starts_with("localhost") || t.starts_with("127.") => Ok(format!("http://{t}")),
        _ => Ok(format!("https://{t}")),
    }
}

/// Structured snippet sent to the active session after a Design Mode pick.
pub fn format_design_push(
    url: &str,
    selector: &str,
    tag: &str,
    role: &str,
    text: &str,
    html: &str,
) -> String {
    format!(
        "[browser design]\nurl: {url}\nselector: {selector}\ntag: {tag}\nrole: {role}\ntext:\n{text}\nhtml:\n{html}\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_https() {
        assert_eq!(normalize_url("example.com").unwrap(), "https://example.com");
        assert_eq!(normalize_url("https://x").unwrap(), "https://x");
    }

    #[test]
    fn localhost_uses_http() {
        assert_eq!(
            normalize_url("localhost:5173").unwrap(),
            "http://localhost:5173"
        );
        assert_eq!(normalize_url("127.0.0.1:8080").unwrap(), "http://127.0.0.1:8080");
    }

    #[test]
    fn blank_and_http() {
        assert_eq!(normalize_url("").unwrap(), "about:blank");
        assert_eq!(normalize_url("about:blank").unwrap(), "about:blank");
        assert_eq!(
            normalize_url("http://localhost:5173").unwrap(),
            "http://localhost:5173"
        );
    }

    #[test]
    fn rejects_dangerous_schemes() {
        assert!(normalize_url("javascript:alert(1)").is_err());
        assert!(normalize_url("file:///etc/passwd").is_err());
        assert!(normalize_url("data:text/html,x").is_err());
        assert!(normalize_url("blob:https://x/1").is_err());
        assert!(normalize_url("about:config").is_err());
    }

    #[test]
    fn design_push_keeps_fields() {
        let out = format_design_push(
            "https://example.com",
            "button.follow",
            "BUTTON",
            "button",
            "Follow",
            "<button class=\"follow\">Follow</button>",
        );
        assert!(out.starts_with("[browser design]\n"));
        assert!(out.contains("selector: button.follow"));
        assert!(out.contains("Follow"));
    }
}
