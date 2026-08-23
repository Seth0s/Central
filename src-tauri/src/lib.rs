mod chrome;
mod pty;
mod runtime;
pub mod stats;
mod term;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

use chrome::{BrowserCurrent, ChromeHost};
use centralbyte_core::git::{self, GitStatus};
use centralbyte_core::history::{History, SavedSession};
use centralbyte_core::history_store::Store;
use centralbyte_core::mcp::McpRegistry;
use centralbyte_core::provider::SessionMode;
use centralbyte_core::session::SessionInfo;
use centralbyte_core::workspace::{self, DirEntry};
use runtime::{Runtime, StartOpts};
use term::Bounds as TermBounds;

struct AppState {
    workspace: Mutex<Option<PathBuf>>,
    runtime: Runtime,
    chrome: tokio::sync::Mutex<ChromeHost>,
    mcp: Mutex<McpRegistry>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace: Mutex::new(None),
            runtime: Runtime::default(),
            chrome: tokio::sync::Mutex::new(ChromeHost::default()),
            mcp: Mutex::new(McpRegistry::default()),
        }
    }
}

fn cwd_or_home(state: &AppState) -> Result<PathBuf, String> {
    if let Some(p) = state.workspace.lock().map_err(|e| e.to_string())?.clone() {
        return Ok(p);
    }
    Ok(std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn workspace_root(state: &AppState) -> Result<PathBuf, String> {
    cwd_or_home(state)
}

fn history_db(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("history.db"))
}

fn history_json_legacy(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("history.json"))
}

fn open_store(app: &tauri::AppHandle) -> Result<Store, String> {
    Store::open(&history_db(app)?, Some(&history_json_legacy(app)?))
}

#[tauri::command]
fn list_providers() -> Vec<centralbyte_core::provider::ProviderInfo> {
    centralbyte_core::provider::inventory()
}

#[tauri::command]
fn open_workspace(app: tauri::AppHandle, state: tauri::State<AppState>, path: String) -> Result<String, String> {
    let p = workspace::resolve_open(&path)?;
    let shown = p.display().to_string();
    *state.workspace.lock().map_err(|e| e.to_string())? = Some(p);
    let store = open_store(&app)?;
    store.remember_repo(&shown)?;
    Ok(shown)
}

#[tauri::command]
fn workspace_cwd(state: tauri::State<AppState>) -> Result<Option<String>, String> {
    Ok(state
        .workspace
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|p| p.display().to_string()))
}

#[tauri::command]
fn list_workspace(state: tauri::State<AppState>, path: Option<String>) -> Result<Vec<DirEntry>, String> {
    let root = workspace_root(&state)?;
    workspace::list_confined(&root, path.as_deref())
}

#[tauri::command]
fn read_workspace_file(state: tauri::State<AppState>, path: String) -> Result<String, String> {
    let root = workspace_root(&state)?;
    match workspace::read_text_file(&root, &path) {
        Ok(s) => Ok(s),
        Err(_) => workspace::read_any_file(&path),
    }
}

#[tauri::command]
fn read_user_file(path: String) -> Result<String, String> {
    workspace::read_any_file(&path)
}

#[tauri::command]
fn write_user_file(path: String, body: String) -> Result<(), String> {
    workspace::write_any_file(&path, &body)
}

#[tauri::command]
fn write_workspace_file(state: tauri::State<AppState>, path: String, body: String) -> Result<(), String> {
    let root = workspace_root(&state)?;
    workspace::write_text_file(&root, &path, &body)
}

#[tauri::command]
fn list_markdown(state: tauri::State<AppState>) -> Result<Vec<DirEntry>, String> {
    let root = workspace_root(&state)?;
    workspace::list_markdown(&root, 4)
}

#[tauri::command]
fn browse_dir(path: Option<String>) -> Result<workspace::BrowseListing, String> {
    workspace::browse(path.as_deref())
}

#[tauri::command]
fn git_status(state: tauri::State<AppState>, cwd: Option<String>) -> Result<GitStatus, String> {
    let dir = match cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => cwd_or_home(&state)?,
    };
    git::status(&dir)
}

#[tauri::command]
fn history_get(app: tauri::AppHandle) -> Result<History, String> {
    open_store(&app)?.get()
}

#[tauri::command]
fn history_upsert_session(app: tauri::AppHandle, session: SavedSession) -> Result<History, String> {
    let id = session.id.clone();
    let hist = open_store(&app)?.upsert_session(session)?;
    if !hist.sessions.iter().any(|s| s.id == id) {
        return Err("session was not stored".into());
    }
    Ok(hist)
}

#[tauri::command]
fn history_delete_session(app: tauri::AppHandle, id: String) -> Result<History, String> {
    open_store(&app)?.delete_session(&id)
}

#[tauri::command]
fn history_delete_agent(
    app: tauri::AppHandle,
    session_id: String,
    agent_id: String,
) -> Result<History, String> {
    open_store(&app)?.delete_agent(&session_id, &agent_id)
}

#[tauri::command]
fn history_move_agent(
    app: tauri::AppHandle,
    from_session: String,
    to_session: String,
    agent_id: String,
) -> Result<History, String> {
    open_store(&app)?.move_agent(&from_session, &to_session, &agent_id)
}

#[tauri::command]
fn history_list_turns(app: tauri::AppHandle, agent_id: String) -> Result<Vec<serde_json::Value>, String> {
    open_store(&app)?.list_turns(&agent_id)
}

#[tauri::command]
fn history_put_turn(
    app: tauri::AppHandle,
    agent_id: String,
    seq: i64,
    turn: serde_json::Value,
) -> Result<(), String> {
    open_store(&app)?.put_turn(&agent_id, seq, &turn)
}

#[tauri::command]
fn history_replace_turns(
    app: tauri::AppHandle,
    agent_id: String,
    turns: Vec<serde_json::Value>,
) -> Result<(), String> {
    open_store(&app)?.replace_turns(&agent_id, &turns)
}

#[tauri::command]
fn start_session(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    provider_id: String,
    mode: SessionMode,
    cwd: Option<String>,
    name: Option<String>,
    model: Option<String>,
    system_prompt: Option<String>,
    resume_id: Option<String>,
    continue_last: Option<bool>,
) -> Result<SessionInfo, String> {
    let cwd = match cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => workspace::resolve_open(p)?,
        None => cwd_or_home(&state)?,
    };
    state.runtime.start(
        app,
        StartOpts {
            provider_id: &provider_id,
            mode,
            cwd: &cwd,
            name: name.unwrap_or_default(),
            model,
            system_prompt,
            resume_id,
            continue_last: continue_last.unwrap_or(false),
        },
    )
}

#[tauri::command]
fn start_shell(app: tauri::AppHandle, state: tauri::State<AppState>, cwd: Option<String>) -> Result<SessionInfo, String> {
    let dir = match cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => workspace::resolve_open(p)?,
        None => cwd_or_home(&state)?,
    };
    state.runtime.start_shell(app, &dir)
}

#[tauri::command]
fn list_sessions(state: tauri::State<AppState>) -> Result<Vec<SessionInfo>, String> {
    state.runtime.list()
}

#[tauri::command]
fn session_write(state: tauri::State<AppState>, session_id: String, data: String) -> Result<(), String> {
    state.runtime.write(&session_id, &data)
}

#[tauri::command]
fn session_resize(
    state: tauri::State<AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.runtime.resize(&session_id, cols, rows)
}

#[tauri::command]
fn session_kill(state: tauri::State<AppState>, session_id: String) -> Result<(), String> {
    state.runtime.kill(&session_id)
}

#[tauri::command]
fn session_interrupt(state: tauri::State<AppState>, session_id: String) -> Result<(), String> {
    state.runtime.interrupt(&session_id)
}

#[tauri::command]
fn term_backend() -> &'static str {
    term::backend()
}

#[tauri::command]
fn term_set_bounds(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    session_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    visible: bool,
    interactive: bool,
    bg: Option<String>,
    fg: Option<String>,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .or_else(|| app.get_webview_window("main").map(|w| w.as_ref().window()))
        .ok_or_else(|| "main window missing".to_string())?;
    let runtime = state.runtime.clone();
    let sid = session_id.clone();
    let size = term::set_bounds(
        &window,
        &session_id,
        TermBounds {
            x,
            y,
            w,
            h,
            visible,
            interactive,
            bg: bg.unwrap_or_else(|| "#1e1e1e".into()),
            fg: fg.unwrap_or_else(|| "#f3f3f3".into()),
        },
        move |text| {
            let _ = runtime.write(&sid, &text);
        },
    )?;
    if let Some((cols, rows)) = size {
        state.runtime.resize(&session_id, cols, rows)?;
    }
    Ok(())
}

#[tauri::command]
fn term_close(session_id: String) -> Result<(), String> {
    term::close(&session_id);
    Ok(())
}

#[tauri::command]
fn send_selection_stub() -> serde_json::Value {
    serde_json::json!({ "ok": false, "reason": "not_implemented" })
}

#[tauri::command]
async fn browser_ensure(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<BrowserCurrent, String> {
    state.chrome.lock().await.ensure(&app).await
}

#[tauri::command]
async fn browser_navigate(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<BrowserCurrent, String> {
    state.chrome.lock().await.navigate(&app, &url).await
}

#[tauri::command]
async fn browser_current(state: tauri::State<'_, AppState>) -> Result<BrowserCurrent, String> {
    Ok(state.chrome.lock().await.current().await)
}

#[tauri::command]
async fn browser_set_viewport(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    w: u32,
    h: u32,
) -> Result<BrowserCurrent, String> {
    state.chrome.lock().await.set_viewport(&app, w, h).await
}

#[tauri::command]
async fn browser_reload(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<BrowserCurrent, String> {
    state.chrome.lock().await.reload(&app).await
}

#[tauri::command]
async fn browser_history_go(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    back: bool,
) -> Result<BrowserCurrent, String> {
    state.chrome.lock().await.history_go(&app, back).await
}

#[tauri::command]
async fn browser_set_design(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    on: bool,
) -> Result<BrowserCurrent, String> {
    state.chrome.lock().await.set_design(&app, on).await
}

#[tauri::command]
async fn browser_ack_pick(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.chrome.lock().await.ack_pick().await
}

#[tauri::command]
async fn browser_open_devtools(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.chrome.lock().await.open_devtools()
}

#[tauri::command]
async fn browser_clear_data(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.chrome.lock().await.clear_data()
}

#[tauri::command]
async fn browser_toggle_bookmark(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<BrowserCurrent, String> {
    state.chrome.lock().await.toggle_bookmark(&app).await
}

#[tauri::command]
async fn browser_set_bookmark_bar(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    on: bool,
) -> Result<BrowserCurrent, String> {
    state.chrome.lock().await.set_bookmark_bar(&app, on).await
}

#[tauri::command]
async fn browser_set_bounds(
    state: tauri::State<'_, AppState>,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    state.chrome.lock().await.set_bounds(x, y, w, h)
}

#[tauri::command]
async fn browser_set_visible(state: tauri::State<'_, AppState>, visible: bool) -> Result<(), String> {
    state.chrome.lock().await.set_visible(visible)
}

#[tauri::command]
async fn browser_close(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.chrome.lock().await.close();
    Ok(())
}

#[tauri::command]
async fn browser_push_to_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: String,
    kind: String,
) -> Result<(), String> {
    let payload = state.chrome.lock().await.push(&app, &kind).await?;
    state.runtime.write(&session_id, &payload)
}

/// True when CENTRALBYTE_TERM_STATS=1, so the webview arm can skip building
/// payloads it would only throw away.
#[tauri::command]
fn stats_enabled() -> bool {
    stats::enabled()
}

/// One NDJSON line from the webview arm, into the same file as the native arm.
/// `fields` is a JSON object body without the braces.
#[tauri::command]
fn stats_log(event: String, fields: String) {
    if stats::enabled() {
        stats::record(&event, &fields);
    }
}

#[tauri::command]
fn mcp_list_tools(state: tauri::State<AppState>) -> Result<Vec<centralbyte_core::mcp::Tool>, String> {
    Ok(state.mcp.lock().map_err(|e| e.to_string())?.list_tools())
}

#[tauri::command]
fn mcp_list_resources(
    state: tauri::State<AppState>,
) -> Result<Vec<centralbyte_core::mcp::Resource>, String> {
    Ok(state.mcp.lock().map_err(|e| e.to_string())?.list_resources())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            term::bind(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_providers,
            open_workspace,
            workspace_cwd,
            list_workspace,
            read_workspace_file,
            read_user_file,
            write_user_file,
            write_workspace_file,
            list_markdown,
            browse_dir,
            git_status,
            history_get,
            history_upsert_session,
            history_delete_session,
            history_delete_agent,
            history_move_agent,
            history_list_turns,
            history_put_turn,
            history_replace_turns,
            start_session,
            start_shell,
            list_sessions,
            session_write,
            session_resize,
            session_kill,
            session_interrupt,
            term_backend,
            term_set_bounds,
            term_close,
            send_selection_stub,
            browser_ensure,
            browser_navigate,
            browser_current,
            browser_set_viewport,
            browser_reload,
            browser_history_go,
            browser_set_design,
            browser_ack_pick,
            browser_open_devtools,
            browser_clear_data,
            browser_toggle_bookmark,
            browser_set_bookmark_bar,
            browser_set_bounds,
            browser_set_visible,
            browser_close,
            browser_push_to_session,
            stats_enabled,
            stats_log,
            mcp_list_tools,
            mcp_list_resources,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
