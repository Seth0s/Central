use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl, Window,
    Wry,
};
use url::Url;

use centralbyte_core::browser;

const CONSOLE_CAP: usize = 200;
const NETWORK_CAP: usize = 200;
const SNAPSHOT_CAP: usize = 200 * 1024;
const BOOKMARK_CAP: usize = 40;
const BROWSER_LABEL: &str = "browser";

const INIT_SCRIPT: &str = r##"
(function () {
  if (window.__ccSkin) return;
  function cap(arr) {
    while (arr.length > 200) arr.shift();
  }
  function esc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += "#" + esc(cur.id);
        parts.unshift(part);
        break;
      }
      var cn = cur.getAttribute("class");
      if (cn) {
        var cls = cn.trim().split(/\s+/).slice(0, 2).filter(Boolean);
        if (cls.length) part += "." + cls.map(esc).join(".");
      }
      var parent = cur.parentElement;
      if (parent) {
        var idx = 1;
        var seen = 0;
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName !== cur.tagName) continue;
          seen++;
          if (parent.children[i] === cur) { idx = seen; break; }
        }
        if (seen > 1) part += ":nth-of-type(" + idx + ")";
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(" > ");
  }
  var skin = { console: [], network: [], pick: null, design: false, hideDesign: function () {} };
  window.__ccSkin = skin;
  ["log", "info", "warn", "error", "debug"].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      var text = Array.prototype.slice.call(arguments).map(String).join(" ");
      skin.console.push({ level: level, text: text });
      cap(skin.console);
      if (orig) orig.apply(console, arguments);
    };
  });
  if (window.PerformanceObserver) {
    try {
      var po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          if (e.entryType === "resource" && e.name) {
            var xhr = e.initiatorType === "xmlhttprequest" || e.initiatorType === "fetch";
            skin.network.push({
              kind: "request",
              method: xhr ? "XHR" : "GET",
              status: null,
              url: e.name
            });
            cap(skin.network);
          }
        });
      });
      po.observe({ type: "resource", buffered: true });
    } catch (e) {}
  }
  function box() {
    var el = document.getElementById("__ccDesignBox");
    if (el) return el;
    el = document.createElement("div");
    el.id = "__ccDesignBox";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3c8cdb;background:rgba(60,140,219,0.10);display:none;box-sizing:border-box;";
    var tip = document.createElement("div");
    tip.id = "__ccDesignTip";
    tip.style.cssText = "position:absolute;left:0;top:-22px;background:#3c8cdb;color:#fff;font:12px/18px ui-sans-serif,system-ui,sans-serif;padding:0 8px;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;border-radius:4px 4px 0 0;";
    el.appendChild(tip);
    (document.documentElement || document.body).appendChild(el);
    return el;
  }
  function hideDesign() {
    var el = document.getElementById("__ccDesignBox");
    if (el) el.style.display = "none";
  }
  skin.hideDesign = hideDesign;
  function place(target) {
    if (!skin.design || !target || !target.getBoundingClientRect) {
      hideDesign();
      return;
    }
    if (target.id === "__ccDesignBox" || target.id === "__ccDesignTip") return;
    var r = target.getBoundingClientRect();
    var el = box();
    el.style.display = "block";
    el.style.left = r.left + "px";
    el.style.top = r.top + "px";
    el.style.width = Math.max(r.width, 2) + "px";
    el.style.height = Math.max(r.height, 2) + "px";
    var tip = document.getElementById("__ccDesignTip");
    if (tip) {
      var label = (target.tagName || "").toLowerCase();
      var name = target.getAttribute("name") || target.id || "";
      tip.textContent = label + (name ? " · " + name : "") + " — clique para o chat";
      tip.style.top = r.top < 28 ? "0px" : "-22px";
    }
  }
  document.addEventListener("mouseover", function (e) {
    if (!skin.design) return;
    place(e.target);
  }, true);
  document.addEventListener("click", function (e) {
    if (!skin.design) return;
    e.preventDefault();
    e.stopPropagation();
    var t = e.target;
    if (!t || t.nodeType !== 1) return;
    var text = (t.innerText || t.textContent || "").replace(/\s+/g, " ").trim();
    skin.pick = {
      selector: cssPath(t),
      tag: t.tagName || "",
      text: text.slice(0, 2000),
      html: String(t.outerHTML || "").slice(0, 8000),
      role: t.getAttribute("role") || ""
    };
  }, true);
  document.addEventListener("keydown", function (e) {
    if (!skin.design) return;
    if (e.key === "Escape") {
      skin.design = false;
      hideDesign();
    }
  }, true);
})();
"##;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConsoleLine {
    pub level: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetLine {
    pub kind: String,
    pub method: Option<String>,
    pub status: Option<u16>,
    pub url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
#[allow(dead_code)]
pub enum BrowserUiEvent {
    Console { level: String, text: String },
    Request { method: String, url: String },
    Response { status: u16, url: String },
    Navigated { url: String, title: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ElementPick {
    pub selector: String,
    pub tag: String,
    pub text: String,
    pub html: String,
    #[serde(default)]
    pub role: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bookmark {
    pub url: String,
    pub title: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct BrowserPrefs {
    #[serde(default)]
    bookmarks: Vec<Bookmark>,
    #[serde(default)]
    bookmark_bar: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct BrowserCurrent {
    pub running: bool,
    pub url: String,
    pub title: String,
    pub viewport_w: u32,
    pub viewport_h: u32,
    pub console: Vec<ConsoleLine>,
    pub network: Vec<NetLine>,
    #[serde(default)]
    pub scripts: Vec<String>,
    pub pick: Option<ElementPick>,
    pub design: bool,
    pub bookmarks: Vec<Bookmark>,
    pub bookmark_bar: bool,
}

#[derive(Clone, Copy)]
struct Hole {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Default for Hole {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
        }
    }
}

#[derive(Deserialize)]
struct PageSnap {
    url: String,
    title: String,
    w: u32,
    h: u32,
    #[serde(default)]
    console: Vec<ConsoleLine>,
    #[serde(default)]
    network: Vec<NetLine>,
    #[serde(default)]
    scripts: Vec<String>,
    #[serde(default)]
    pick: Option<ElementPick>,
    #[serde(default)]
    text: String,
}

pub struct ChromeHost {
    webview: Option<Webview<Wry>>,
    hole: Hole,
    viewport_w: u32,
    viewport_h: u32,
    visible: bool,
    design: bool,
    prefs: BrowserPrefs,
    prefs_loaded: bool,
    console: VecDeque<ConsoleLine>,
    network: VecDeque<NetLine>,
}

impl Default for ChromeHost {
    fn default() -> Self {
        Self {
            webview: None,
            hole: Hole::default(),
            viewport_w: 0,
            viewport_h: 0,
            visible: false,
            design: false,
            prefs: BrowserPrefs::default(),
            prefs_loaded: false,
            console: VecDeque::new(),
            network: VecDeque::new(),
        }
    }
}

impl ChromeHost {
    pub async fn ensure(&mut self, app: &AppHandle) -> Result<BrowserCurrent, String> {
        self.load_prefs(app);
        if let Some(existing) = app.get_webview(BROWSER_LABEL) {
            self.webview = Some(existing);
            self.apply_geom()?;
            return Ok(self.current().await);
        }
        self.spawn(app)?;
        Ok(self.current().await)
    }

    fn spawn(&mut self, app: &AppHandle) -> Result<(), String> {
        if let Some(old) = app.get_webview(BROWSER_LABEL) {
            let _ = old.close();
        }
        let window = main_window(app)?;
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        linux::ensure_overlay(&window)?;

        let app_nav = app.clone();
        let start: Url = "about:blank".parse().map_err(|e: url::ParseError| e.to_string())?;
        let builder = WebviewBuilder::new(BROWSER_LABEL, WebviewUrl::External(start))
            .devtools(true)
            .initialization_script(INIT_SCRIPT)
            .on_navigation(|url| match url.scheme() {
                "http" | "https" => true,
                "about" => url.as_str() == "about:blank" || url.as_str().starts_with("about:blank?"),
                _ => false,
            })
            .on_page_load(move |wv, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }
                let url = payload.url().to_string();
                let app = app_nav.clone();
                let _ = wv.eval_with_callback("document.title", move |raw| {
                    let title = serde_json::from_str::<String>(&raw).unwrap_or(raw);
                    let _ = app.emit(
                        "browser-event",
                        BrowserUiEvent::Navigated {
                            url: url.clone(),
                            title,
                        },
                    );
                });
            });

        let geom = self.draw_rect();
        let webview = window
            .add_child(
                builder,
                LogicalPosition::new(geom.x, geom.y),
                LogicalSize::new(geom.w.max(1.0), geom.h.max(1.0)),
            )
            .map_err(|e| e.to_string())?;
        if !self.visible {
            let _ = webview.hide();
        }
        self.webview = Some(webview);
        self.apply_geom()?;
        Ok(())
    }

    pub async fn navigate(&mut self, app: &AppHandle, url: &str) -> Result<BrowserCurrent, String> {
        let next = browser::normalize_url(url)?;
        self.ensure(app).await?;
        let wv = self.webview.as_ref().ok_or_else(|| "browser_not_running".to_string())?;
        let parsed: Url = next.parse().map_err(|e: url::ParseError| e.to_string())?;
        wv.navigate(parsed).map_err(|e| e.to_string())?;
        Ok(self.current().await)
    }

    pub async fn current(&mut self) -> BrowserCurrent {
        let Some(wv) = self.webview.as_ref() else {
            return self.empty();
        };
        match snap(wv).await {
            Ok(page) => {
                merge_buffers(&mut self.console, page.console, CONSOLE_CAP);
                merge_net(&mut self.network, page.network, NETWORK_CAP);
                if self.design {
                    if let Some(wv) = &self.webview {
                        sync_design(wv, true);
                    }
                }
                let (mut w, mut h) = (self.viewport_w, self.viewport_h);
                if w == 0 {
                    w = page.w;
                }
                if h == 0 {
                    h = page.h;
                }
                BrowserCurrent {
                    running: true,
                    url: page.url,
                    title: page.title,
                    viewport_w: w,
                    viewport_h: h,
                    console: self.console.iter().cloned().collect(),
                    network: self.network.iter().cloned().collect(),
                    scripts: page.scripts,
                    pick: page.pick,
                    design: self.design,
                    bookmarks: self.prefs.bookmarks.clone(),
                    bookmark_bar: self.prefs.bookmark_bar,
                }
            }
            Err(_) => self.empty(),
        }
    }

    pub async fn set_viewport(
        &mut self,
        app: &AppHandle,
        w: u32,
        h: u32,
    ) -> Result<BrowserCurrent, String> {
        self.ensure(app).await?;
        self.viewport_w = w;
        self.viewport_h = h;
        self.apply_geom()?;
        Ok(self.current().await)
    }

    pub async fn reload(&mut self, app: &AppHandle) -> Result<BrowserCurrent, String> {
        self.ensure(app).await?;
        let wv = self.webview.as_ref().ok_or_else(|| "browser_not_running".to_string())?;
        wv.reload().map_err(|e| e.to_string())?;
        Ok(self.current().await)
    }

    pub async fn history_go(&mut self, app: &AppHandle, back: bool) -> Result<BrowserCurrent, String> {
        self.ensure(app).await?;
        let wv = self.webview.as_ref().ok_or_else(|| "browser_not_running".to_string())?;
        let js = if back {
            "history.back()"
        } else {
            "history.forward()"
        };
        wv.eval(js).map_err(|e| e.to_string())?;
        Ok(self.current().await)
    }

    pub async fn set_design(&mut self, app: &AppHandle, on: bool) -> Result<BrowserCurrent, String> {
        self.ensure(app).await?;
        self.design = on;
        if let Some(wv) = &self.webview {
            sync_design(wv, on);
        }
        Ok(self.current().await)
    }

    pub async fn ack_pick(&mut self) -> Result<(), String> {
        let Some(wv) = self.webview.as_ref() else {
            return Ok(());
        };
        wv.eval("if (window.__ccSkin) window.__ccSkin.pick = null")
            .map_err(|e| e.to_string())
    }

    pub fn open_devtools(&mut self) -> Result<(), String> {
        let wv = self.webview.as_ref().ok_or_else(|| "browser_not_running".to_string())?;
        wv.open_devtools();
        Ok(())
    }

    pub fn clear_data(&mut self) -> Result<(), String> {
        let wv = self.webview.as_ref().ok_or_else(|| "browser_not_running".to_string())?;
        wv.clear_all_browsing_data().map_err(|e| e.to_string())
    }

    pub async fn toggle_bookmark(&mut self, app: &AppHandle) -> Result<BrowserCurrent, String> {
        self.ensure(app).await?;
        let wv = self.webview.as_ref().ok_or_else(|| "browser_not_running".to_string())?;
        let page = snap(wv).await?;
        if page.url.is_empty() || page.url == "about:blank" {
            return Err("nothing to bookmark".into());
        }
        if let Some(i) = self.prefs.bookmarks.iter().position(|b| b.url == page.url) {
            self.prefs.bookmarks.remove(i);
        } else {
            let title = if page.title.is_empty() {
                page.url.clone()
            } else {
                page.title
            };
            self.prefs.bookmarks.insert(
                0,
                Bookmark {
                    url: page.url,
                    title,
                },
            );
            self.prefs.bookmarks.truncate(BOOKMARK_CAP);
        }
        save_prefs(app, &self.prefs)?;
        Ok(self.current().await)
    }

    pub async fn set_bookmark_bar(
        &mut self,
        app: &AppHandle,
        on: bool,
    ) -> Result<BrowserCurrent, String> {
        self.load_prefs(app);
        self.prefs.bookmark_bar = on;
        save_prefs(app, &self.prefs)?;
        Ok(self.current().await)
    }

    fn load_prefs(&mut self, app: &AppHandle) {
        if self.prefs_loaded {
            return;
        }
        self.prefs = load_prefs(app);
        self.prefs_loaded = true;
    }

    pub fn set_bounds(&mut self, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
        self.hole = Hole { x, y, w, h };
        self.apply_geom()
    }

    pub fn set_visible(&mut self, visible: bool) -> Result<(), String> {
        self.visible = visible;
        if let Some(wv) = &self.webview {
            if visible {
                wv.show().map_err(|e| e.to_string())?;
            } else {
                wv.hide().map_err(|e| e.to_string())?;
            }
        }
        self.apply_geom()
    }

    pub async fn push(&mut self, app: &AppHandle, kind: &str) -> Result<String, String> {
        self.ensure(app).await?;
        let wv = self.webview.as_ref().ok_or_else(|| "browser_not_running".to_string())?;
        let page = snap(wv).await?;
        merge_buffers(&mut self.console, page.console.clone(), CONSOLE_CAP);
        merge_net(&mut self.network, page.network.clone(), NETWORK_CAP);
        let text = match kind {
            "url" => format!(
                "[browser url]\n{}\nTitle: {}\n",
                page.url,
                if page.title.is_empty() { "—" } else { &page.title }
            ),
            "console" => {
                let mut out = String::from("[browser console]\n");
                if self.console.is_empty() {
                    out.push_str("(empty)\n");
                } else {
                    for line in &self.console {
                        out.push_str(&format!("{}  {}\n", line.level, line.text));
                    }
                }
                out
            }
            "network" => {
                let mut out = String::from("[browser network]\n");
                if self.network.is_empty() {
                    out.push_str("(empty)\n");
                } else {
                    for line in &self.network {
                        match line.kind.as_str() {
                            "request" => out.push_str(&format!(
                                "{} {}\n",
                                line.method.as_deref().unwrap_or("GET"),
                                line.url
                            )),
                            _ => out.push_str(&format!(
                                "{} {}\n",
                                line.status.map(|s| s.to_string()).unwrap_or_else(|| "—".into()),
                                line.url
                            )),
                        }
                    }
                }
                out
            }
            "snapshot" => {
                let body = format!("url: {}\ntitle: {}\n\n{}", page.url, page.title, page.text);
                format!("[browser snapshot]\n{}\n", cap_bytes(body, SNAPSHOT_CAP))
            }
            "design" => {
                let pick = page.pick.ok_or_else(|| "no element selected".to_string())?;
                let text = browser::format_design_push(
                    &page.url,
                    &pick.selector,
                    &pick.tag,
                    &pick.role,
                    &pick.text,
                    &pick.html,
                );
                let _ = wv.eval("if (window.__ccSkin) window.__ccSkin.pick = null");
                text
            }
            "scripts" => {
                let mut out = String::from("[browser scripts]\n");
                if page.scripts.is_empty() {
                    out.push_str("(empty)\n");
                } else {
                    for src in &page.scripts {
                        out.push_str(src);
                        out.push('\n');
                    }
                }
                out
            }
            _ => return Err("unknown push kind".into()),
        };
        Ok(if text.ends_with('\n') {
            text
        } else {
            format!("{text}\n")
        })
    }

    pub fn close(&mut self) {
        if let Some(wv) = self.webview.take() {
            let _ = wv.close();
        }
    }

    fn empty(&self) -> BrowserCurrent {
        BrowserCurrent {
            running: self.webview.is_some(),
            url: "about:blank".into(),
            title: String::new(),
            viewport_w: self.viewport_w,
            viewport_h: self.viewport_h,
            console: self.console.iter().cloned().collect(),
            network: self.network.iter().cloned().collect(),
            scripts: Vec::new(),
            pick: None,
            design: self.design,
            bookmarks: self.prefs.bookmarks.clone(),
            bookmark_bar: self.prefs.bookmark_bar,
        }
    }

    fn draw_rect(&self) -> Hole {
        let mut x = self.hole.x;
        let mut y = self.hole.y;
        let mut w = self.hole.w.max(1.0);
        let mut h = self.hole.h.max(1.0);
        if self.viewport_w > 0 && self.viewport_h > 0 {
            let vw = f64::from(self.viewport_w);
            let vh = f64::from(self.viewport_h);
            let scale = (w / vw).min(h / vh).min(1.0);
            let dw = (vw * scale).max(1.0);
            let dh = (vh * scale).max(1.0);
            x += (w - dw) / 2.0;
            y += (h - dh) / 2.0;
            w = dw;
            h = dh;
        }
        if !self.visible {
            w = 1.0;
            h = 1.0;
        }
        Hole { x, y, w, h }
    }

    fn apply_geom(&self) -> Result<(), String> {
        let Some(wv) = &self.webview else {
            return Ok(());
        };
        let g = self.draw_rect();
        wv.set_bounds(Rect {
            position: LogicalPosition::new(g.x, g.y).into(),
            size: LogicalSize::new(g.w, g.h).into(),
        })
        .map_err(|e| e.to_string())?;
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        linux::place(wv, g.x, g.y, g.w, g.h, self.visible)?;
        Ok(())
    }
}

fn main_window(app: &AppHandle) -> Result<Window<Wry>, String> {
    app.get_window("main")
        .or_else(|| app.get_webview_window("main").map(|w| w.as_ref().window()))
        .ok_or_else(|| "main window missing".into())
}

async fn snap(wv: &Webview<Wry>) -> Result<PageSnap, String> {
    eval_json(
        wv,
        r#"(function(){
          var c = window.__ccSkin || {console:[], network:[], pick:null};
          var scripts = [];
          try {
            var list = document.scripts || [];
            for (var i = 0; i < list.length && scripts.length < 80; i++) {
              scripts.push(list[i].src || "(inline)");
            }
          } catch (e) {}
          return {
            url: location.href,
            title: document.title || "",
            w: window.innerWidth || 0,
            h: window.innerHeight || 0,
            console: c.console || [],
            network: c.network || [],
            scripts: scripts,
            pick: c.pick || null,
            text: document.body ? document.body.innerText : ""
          };
        })()"#,
    )
    .await
}

async fn eval_json<T: for<'de> Deserialize<'de>>(wv: &Webview<Wry>, js: &str) -> Result<T, String> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    wv.eval_with_callback(js, move |raw| {
        let _ = tx.send(raw);
    })
    .map_err(|e| e.to_string())?;
    let raw = tokio::time::timeout(Duration::from_secs(3), rx.recv())
        .await
        .map_err(|_| "eval timeout".to_string())?
        .ok_or_else(|| "eval cancelled".to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("eval json: {e}: {raw}"))
}

fn merge_buffers(dst: &mut VecDeque<ConsoleLine>, incoming: Vec<ConsoleLine>, cap: usize) {
    *dst = incoming.into();
    while dst.len() > cap {
        dst.pop_front();
    }
}

fn merge_net(dst: &mut VecDeque<NetLine>, incoming: Vec<NetLine>, cap: usize) {
    *dst = incoming.into();
    while dst.len() > cap {
        dst.pop_front();
    }
}

fn sync_design(wv: &Webview<Wry>, on: bool) {
    let flag = if on { "true" } else { "false" };
    let _ = wv.eval(&format!(
        "if(window.__ccSkin){{window.__ccSkin.design={flag};if(!{flag}&&window.__ccSkin.hideDesign)window.__ccSkin.hideDesign();}}"
    ));
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("browser.json"))
}

fn load_prefs(app: &AppHandle) -> BrowserPrefs {
    let Ok(path) = prefs_path(app) else {
        return BrowserPrefs::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_prefs(app: &AppHandle, prefs: &BrowserPrefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn cap_bytes(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max.saturating_sub(1);
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
mod linux {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::sync::mpsc;
    use gtk::cairo::{RectangleInt, Region};
    use gtk::glib;
    use gtk::glib::translate::ToGlibPtr;
    use gtk::prelude::*;
    use gtk::OverlaySignals;

    const LINUX_FIXED: &str = "cc-browser-fixed";

    /// GtkOverlay allocates overlay children from (0,0) using requisition, which for a
    /// GtkFixed is the bottom-right of its children — covering the sidebar/header.
    /// The host window must be the bounding box of the holes, not that origin box.
    fn overlay_host_rect(holes: &[(i32, i32, i32, i32)]) -> (i32, i32, i32, i32) {
        let mut iter = holes.iter().copied().filter(|&(_, _, w, h)| w >= 8 && h >= 8);
        let Some((x, y, w, h)) = iter.next() else {
            return (0, 0, 1, 1);
        };
        let mut x0 = x;
        let mut y0 = y;
        let mut x1 = x + w;
        let mut y1 = y + h;
        for (x, y, w, h) in iter {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x + w);
            y1 = y1.max(y + h);
        }
        (x0, y0, (x1 - x0).max(1), (y1 - y0).max(1))
    }

    fn overlay_rel(abs: (i32, i32, i32, i32), origin: (i32, i32)) -> (i32, i32, i32, i32) {
        (abs.0 - origin.0, abs.1 - origin.1, abs.2, abs.3)
    }

    struct NativeHole {
        widget: gtk::Widget,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        mapped: bool,
    }

    thread_local! {
        static HOLES: RefCell<HashMap<usize, NativeHole>> = RefCell::new(HashMap::new());
        static HOST: Cell<(i32, i32, i32, i32)> = Cell::new((0, 0, 1, 1));
        static POSITION_HOOK: Cell<bool> = Cell::new(false);
        /// Coalesce move_/size_allocate onto one idle tick. Nested `size_allocate`
        /// on VTE while GtkFixed is still inside its own allocate (every window
        /// resize frame) corrupts glibc freelists → "corrupted double-linked list".
        static RELAYOUT_PENDING: Cell<bool> = Cell::new(false);
    }

    fn widget_key(widget: &gtk::Widget) -> usize {
        let ptr: *mut gtk::ffi::GtkWidget = widget.to_glib_none().0;
        ptr as usize
    }

    /// Bounding box of holes that keep a CSS size (mapped or not). Unmapped VTE
    /// is `hide()` only — collapsing HOST to 1×1 was the freeze/redraw bug and
    /// let GtkFixed requisition expand from (0,0) over the chrome.
    fn ready_rects() -> Vec<(i32, i32, i32, i32)> {
        HOLES.with(|m| {
            m.borrow()
                .values()
                .filter(|h| h.w >= 8 && h.h >= 8)
                .map(|h| (h.x, h.y, h.w, h.h))
                .collect()
        })
    }

    /// Mapped holes only — empty region while hidden so the webview gets clicks.
    fn vis_rects() -> Vec<(i32, i32, i32, i32)> {
        HOLES.with(|m| {
            m.borrow()
                .values()
                .filter(|h| h.mapped && h.w >= 8 && h.h >= 8)
                .map(|h| (h.x, h.y, h.w, h.h))
                .collect()
        })
    }

    fn hook_position(overlay: &gtk::Overlay, fixed: &gtk::Fixed) {
        if POSITION_HOOK.replace(true) {
            return;
        }
        overlay.connect_get_child_position(|_, widget| {
            if WidgetExt::widget_name(widget) != LINUX_FIXED {
                return None;
            }
            let (x, y, w, h) = HOST.with(|c| c.get());
            Some(gtk::Rectangle::new(x, y, w, h))
        });
        let host = fixed.clone();
        fixed.connect_size_allocate(move |_, _| {
            schedule_relayout(&host);
        });
        let punch = fixed.clone();
        fixed.connect_realize(move |_| {
            punch_input(&punch);
        });
    }

    fn schedule_relayout(fixed: &gtk::Fixed) {
        if RELAYOUT_PENDING.replace(true) {
            return;
        }
        let host = fixed.clone();
        glib::idle_add_local_once(move || {
            RELAYOUT_PENDING.set(false);
            relayout_children(&host);
            punch_input(&host);
        });
    }

    fn relayout_children(fixed: &gtk::Fixed) {
        let host = HOST.with(|c| c.get());
        // Never size_allocate VTE into the 1×1 sentinel — that collapses the PTY
        // and leaves a distorted cell grid when HOST later grows.
        if host.2 < 8 || host.3 < 8 {
            return;
        }
        let origin = (host.0, host.1);
        HOLES.with(|m| {
            for hole in m.borrow().values() {
                if hole.widget.parent().as_ref() != Some(fixed.upcast_ref()) {
                    continue;
                }
                if hole.w < 8 || hole.h < 8 {
                    continue;
                }
                let (x, y, w, h) = overlay_rel((hole.x, hole.y, hole.w, hole.h), origin);
                fixed.move_(&hole.widget, x, y);
                hole.widget.set_size_request(w, h);
                // GtkFixed ignores requisition for VTE; allocate only from idle
                // (see schedule_relayout), never from inside size-allocate.
                hole.widget.size_allocate(&gtk::Allocation::new(x, y, w, h));
            }
        });
    }

    fn punch_input(fixed: &gtk::Fixed) {
        let Some(win) = fixed.parent_window() else {
            return;
        };
        let host = HOST.with(|c| c.get());
        let origin = (host.0, host.1);
        let region = Region::create();
        for rect in vis_rects() {
            let (x, y, w, h) = overlay_rel(rect, origin);
            let _ = region.union_rectangle(&RectangleInt::new(x, y, w, h));
        }
        win.input_shape_combine_region(&region, 0, 0);
    }

    fn sync_host(fixed: &gtk::Fixed) {
        let host = overlay_host_rect(&ready_rects());
        let prev = HOST.with(|c| c.get());
        HOST.with(|c| c.set(host));
        if let Some(parent) = fixed.parent() {
            if let Ok(overlay) = parent.downcast::<gtk::Overlay>() {
                hook_position(&overlay, fixed);
                // Resizing the overlay every hole tick storms allocate+VTE and
                // was a strong amplifier of the freelist corruption on drag-resize.
                if prev != host {
                    overlay.queue_resize();
                }
            }
        }
        schedule_relayout(fixed);
    }

    pub fn place_native(
        fixed: &gtk::Fixed,
        widget: &gtk::Widget,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        mapped: bool,
    ) {
        let key = widget_key(widget);
        HOLES.with(|m| {
            m.borrow_mut().insert(
                key,
                NativeHole {
                    widget: widget.clone(),
                    x,
                    y,
                    w,
                    h,
                    mapped,
                },
            );
        });
        widget.set_hexpand(false);
        widget.set_vexpand(false);
        widget.set_halign(gtk::Align::Start);
        widget.set_valign(gtk::Align::Start);
        if widget.parent().as_ref() != Some(fixed.upcast_ref()) {
            if let Some(parent) = widget.parent() {
                if let Ok(container) = parent.downcast::<gtk::Container>() {
                    container.remove(widget);
                }
            }
            let host = overlay_host_rect(&ready_rects());
            let (rx, ry, _, _) = overlay_rel((x, y, w, h), (host.0, host.1));
            fixed.put(widget, rx, ry);
        }
        if mapped {
            widget.show();
        } else {
            widget.hide();
        }
        sync_host(fixed);
    }

    pub fn forget_native(widget: &gtk::Widget) {
        HOLES.with(|m| {
            m.borrow_mut().remove(&widget_key(widget));
        });
        if let Some(parent) = widget.parent() {
            if let Ok(fixed) = parent.downcast::<gtk::Fixed>() {
                sync_host(&fixed);
            }
        }
    }

    pub fn ensure_overlay(window: &Window<Wry>) -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        let win = window.clone();
        window
            .run_on_main_thread(move || {
                let res = wrap(&win);
                let _ = tx.send(res);
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }

    fn wrap(window: &Window<Wry>) -> Result<(), String> {
        let gtk_window = window.gtk_window().map_err(|e| e.to_string())?;
        let vbox = window.default_vbox().map_err(|e| e.to_string())?;
        if vbox
            .parent()
            .and_then(|p| p.downcast::<gtk::Overlay>().ok())
            .is_some()
        {
            if let Some(fixed) = find_named(gtk_window.upcast_ref()) {
                fixed.set_hexpand(false);
                fixed.set_vexpand(false);
                fixed.set_can_focus(false);
                if let Some(parent) = fixed.parent() {
                    if let Ok(overlay) = parent.downcast::<gtk::Overlay>() {
                        overlay.set_overlay_pass_through(&fixed, true);
                        hook_position(&overlay, &fixed);
                    }
                }
            }
            return Ok(());
        }
        let overlay = gtk::Overlay::new();
        let fixed = gtk::Fixed::new();
        WidgetExt::set_widget_name(&fixed, LINUX_FIXED);
        fixed.set_hexpand(false);
        fixed.set_vexpand(false);
        fixed.set_can_focus(false);
        gtk_window.remove(&vbox);
        overlay.add(&vbox);
        overlay.add_overlay(&fixed);
        overlay.set_overlay_pass_through(&fixed, true);
        hook_position(&overlay, &fixed);
        gtk_window.add(&overlay);
        overlay.show_all();
        Ok(())
    }

    pub fn place(wv: &Webview<Wry>, x: f64, y: f64, w: f64, h: f64, visible: bool) -> Result<(), String> {
        let xi = x.round() as i32;
        let yi = y.round() as i32;
        let wi = w.round().max(1.0) as i32;
        let hi = h.round().max(1.0) as i32;
        wv.with_webview(move |platform| {
            let widget: gtk::Widget = platform.inner().upcast();
            let Some(fixed) = find_fixed(&widget) else {
                return;
            };
            place_native(&fixed, &widget, xi, yi, wi, hi, visible);
        })
        .map_err(|e| e.to_string())
    }

    fn find_fixed(widget: &gtk::Widget) -> Option<gtk::Fixed> {
        let top = widget.toplevel()?;
        find_named(&top)
    }

    fn find_named(widget: &gtk::Widget) -> Option<gtk::Fixed> {
        if WidgetExt::widget_name(widget) == LINUX_FIXED {
            return widget.clone().downcast::<gtk::Fixed>().ok();
        }
        let container = widget.clone().downcast::<gtk::Container>().ok()?;
        for child in container.children() {
            if let Some(found) = find_named(&child) {
                return Some(found);
            }
        }
        None
    }

    pub fn fixed_from_window(window: &Window<Wry>) -> Option<gtk::Fixed> {
        let gtk_win = window.gtk_window().ok()?;
        find_named(gtk_win.upcast_ref())
    }

    #[cfg(test)]
    mod overlay_hole_tests {
        use super::{overlay_host_rect, overlay_rel};

        #[test]
        fn single_hole_host_is_the_hole_not_the_origin_box() {
            assert_eq!(
                overlay_host_rect(&[(348, 56, 900, 700)]),
                (348, 56, 900, 700)
            );
        }

        #[test]
        fn empty_or_tiny_host_is_one_pixel() {
            assert_eq!(overlay_host_rect(&[]), (0, 0, 1, 1));
            assert_eq!(overlay_host_rect(&[(10, 10, 1, 1)]), (0, 0, 1, 1));
        }

        #[test]
        fn two_holes_union_and_relative_origin() {
            let host = overlay_host_rect(&[(348, 56, 900, 400), (1260, 80, 300, 400)]);
            assert_eq!(host, (348, 56, 1212, 424));
            assert_eq!(
                overlay_rel((348, 56, 900, 400), (host.0, host.1)),
                (0, 0, 900, 400)
            );
            assert_eq!(
                overlay_rel((1260, 80, 300, 400), (host.0, host.1)),
                (912, 24, 300, 400)
            );
        }

        #[test]
        fn host_keeps_css_size_even_when_the_caller_would_hide_the_widget() {
            // mapped=false still contributes to HOST; only punch_input uses mapped.
            assert_eq!(
                overlay_host_rect(&[(348, 56, 900, 700)]),
                (348, 56, 900, 700)
            );
        }
    }
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
pub(crate) fn ensure_native_overlay(window: &Window<Wry>) -> Result<(), String> {
    linux::ensure_overlay(window)
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
pub(crate) fn linux_fixed(window: &Window<Wry>) -> Option<gtk::Fixed> {
    linux::fixed_from_window(window)
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
pub(crate) fn linux_place_native(
    fixed: &gtk::Fixed,
    widget: &gtk::Widget,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    mapped: bool,
) {
    linux::place_native(fixed, widget, x, y, w, h, mapped);
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
pub(crate) fn linux_forget_native(widget: &gtk::Widget) {
    linux::forget_native(widget);
}