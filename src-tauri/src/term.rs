//! Native terminal overlay. Linux paints VTE in the same GTK Fixed as the child
//! browser; other platforms return `xterm` and these commands are no-ops.

use std::sync::OnceLock;

use tauri::{AppHandle, Emitter, Manager, Window, Wry};

use centralbyte_core::session::{SessionEvent, SessionEventKind};

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn bind(app: AppHandle) {
    let _ = APP.set(app);
}

/// Where the GTK widget exists at all.
pub const NATIVE_AVAILABLE: bool = cfg!(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
));

/// Resolve the backend from the compiled default and an optional override.
/// Pure, so the override rules are testable without GTK.
pub fn resolve_backend(requested: Option<&str>, native_available: bool) -> &'static str {
    match requested {
        Some("xterm") => "xterm",
        // Asking for the native widget where it does not exist is ignored, not fatal.
        Some("vte") if native_available => "vte",
        _ if native_available => "vte",
        _ => "xterm",
    }
}

/// `CENTRALBYTE_TERM=xterm|vte` forces a backend so both arms of the A/B
/// measurement run on one machine without recompiling. Unknown values fall back
/// to the compiled default.
pub fn backend() -> &'static str {
    static CHOICE: OnceLock<&'static str> = OnceLock::new();
    CHOICE.get_or_init(|| {
        let requested = std::env::var("CENTRALBYTE_TERM").ok();
        resolve_backend(requested.as_deref(), NATIVE_AVAILABLE)
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub visible: bool,
    pub interactive: bool,
    pub bg: String,
    pub fg: String,
}

/// GEnum `VteFormat`: TEXT=1, HTML=2. Passing 0 logs VTE-CRITICAL and returns NULL.
pub const VTE_FORMAT_TEXT: u32 = 1;

/// GTK Fixed ignores requisition for some widgets; WRY uses size_allocate with this rect.
/// A ready hole keeps its CSS size even when not raised (Chrome view / HTML popups)
/// so the PTY does not collapse. Tiny holes stay 1×1.
pub fn layout_alloc(x: f64, y: f64, w: f64, h: f64, raised: bool) -> (i32, i32, i32, i32, bool) {
    let ready = w >= 8.0 && h >= 8.0;
    let xi = x.round() as i32;
    let yi = y.round() as i32;
    if !ready {
        (xi, yi, 1, 1, false)
    } else {
        (
            xi,
            yi,
            w.round().max(1.0) as i32,
            h.round().max(1.0) as i32,
            raised,
        )
    }
}

/// A full-screen text extraction runs on the GTK main thread, which VTE shares
/// with WebKitGTK — doing it per PTY flush starves both. This is the same
/// trailing-edge debounce `src/PtyTerm.tsx` already uses on the xterm side.
pub const SNAPSHOT_DEBOUNCE_MS: u64 = 80;

/// Trailing-edge debounce bookkeeping: at most one timer in flight, and no
/// extraction when nothing was fed since the last one.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SnapshotClock {
    dirty: bool,
    armed: bool,
}

impl SnapshotClock {
    /// Bytes arrived. Returns true when the caller must arm a timer.
    pub fn on_feed(&mut self) -> bool {
        self.dirty = true;
        if self.armed {
            return false;
        }
        self.armed = true;
        true
    }

    /// The timer fired. Returns true when a snapshot is actually due.
    pub fn on_timer(&mut self) -> bool {
        self.armed = false;
        std::mem::take(&mut self.dirty)
    }
}

/// Focus follows the *transition* into an interactive hole, never every bounds
/// change: GTK gives the keyboard to whichever widget holds focus, so grabbing on
/// each change would steal it from an HTML input on every window resize.
pub fn should_grab_focus(prev: Option<&Bounds>, next: &Bounds, raised: bool) -> bool {
    raised && next.interactive && prev.map_or(true, |p| !p.interactive)
}

/// Same hole after rounding, same chrome flags — skip GTK work and resize.
pub fn bounds_unchanged(prev: &Bounds, next: &Bounds) -> bool {
    layout_alloc(prev.x, prev.y, prev.w, prev.h, prev.visible)
        == layout_alloc(next.x, next.y, next.w, next.h, next.visible)
        && prev.interactive == next.interactive
        && prev.bg == next.bg
        && prev.fg == next.fg
}

pub fn set_bounds(
    window: &Window<Wry>,
    session_id: &str,
    bounds: Bounds,
    on_commit: impl Fn(String) + Send + Sync + 'static,
) -> Result<Option<(u16, u16)>, String> {
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        linux::set_bounds(window, session_id, bounds, Box::new(on_commit))
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    {
        let _ = (window, session_id, bounds, on_commit);
        Ok(None)
    }
}

pub fn feed(session_id: &str, data: &[u8]) {
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        linux::feed(session_id, data);
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    {
        let _ = (session_id, data);
    }
}

pub fn close(session_id: &str) {
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        linux::close(session_id);
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    {
        let _ = session_id;
    }
}

fn emit_screen(session_id: &str, text: String) {
    let Some(app) = APP.get() else {
        return;
    };
    let _ = app.emit(
        "session-event",
        SessionEvent {
            session_id: session_id.to_string(),
            kind: SessionEventKind::Screen { text },
        },
    );
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
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::CStr;
    use std::os::raw::{c_char, c_int, c_long, c_uint};
    use std::sync::mpsc;
    use std::time::Instant;

    use gdk::RGBA;
    use gtk::glib;
    use gtk::glib::translate::{from_glib_none, ToGlibPtr};
    use gtk::prelude::*;
    use pango::FontDescription;

    thread_local! {
        static TERMS: RefCell<HashMap<String, Slot>> = RefCell::new(HashMap::new());
        static PENDING: RefCell<HashMap<String, Vec<u8>>> = RefCell::new(HashMap::new());
    }

    struct Slot {
        widget: gtk::Widget,
        last_text: String,
        raised: bool,
        last: Option<Bounds>,
        last_size: Option<(u16, u16)>,
        clock: SnapshotClock,
    }

    #[repr(C)]
    struct VteTerminal {
        _private: [u8; 0],
    }

    /// GEnum `VteFormat`: TEXT=1, HTML=2. Zero fails `check_enum_value` (VTE-CRITICAL).
    const VTE_FORMAT_TEXT: c_uint = super::VTE_FORMAT_TEXT;

    extern "C" {
        fn vte_terminal_new() -> *mut gtk::ffi::GtkWidget;
        fn vte_terminal_feed(terminal: *mut VteTerminal, data: *const u8, length: isize);
        fn vte_terminal_set_input_enabled(terminal: *mut VteTerminal, enabled: c_int);
        fn vte_terminal_set_size(terminal: *mut VteTerminal, columns: c_long, rows: c_long);
        fn vte_terminal_get_char_width(terminal: *mut VteTerminal) -> c_long;
        fn vte_terminal_get_char_height(terminal: *mut VteTerminal) -> c_long;
        fn vte_terminal_set_color_foreground(terminal: *mut VteTerminal, color: *const RGBA);
        fn vte_terminal_set_color_background(terminal: *mut VteTerminal, color: *const RGBA);
        fn vte_terminal_set_font(terminal: *mut VteTerminal, font: *const pango::ffi::PangoFontDescription);
        fn vte_terminal_set_scrollback_lines(terminal: *mut VteTerminal, lines: c_long);
        fn vte_terminal_set_scroll_on_output(terminal: *mut VteTerminal, scroll: c_int);
        fn vte_terminal_set_mouse_autohide(terminal: *mut VteTerminal, setting: c_int);
        fn vte_terminal_set_audible_bell(terminal: *mut VteTerminal, is_audible: c_int);
        fn vte_terminal_get_text_format(terminal: *mut VteTerminal, format: c_uint) -> *mut c_char;
        fn vte_terminal_set_cursor_blink_mode(terminal: *mut VteTerminal, mode: c_int);
    }

    fn term_ptr(widget: &gtk::Widget) -> *mut VteTerminal {
        let ptr: *mut gtk::ffi::GtkWidget = ToGlibPtr::to_glib_none(widget).0;
        ptr as *mut VteTerminal
    }

    fn on_main<T: Send + 'static>(
        window: &Window<Wry>,
        f: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(f());
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }

    pub fn set_bounds(
        window: &Window<Wry>,
        session_id: &str,
        bounds: Bounds,
        on_commit: Box<dyn Fn(String) + Send + Sync>,
    ) -> Result<Option<(u16, u16)>, String> {
        crate::chrome::ensure_native_overlay(window)?;
        let id = session_id.to_string();
        let win = window.clone();
        on_main(window, move || apply(&win, &id, bounds, on_commit))?
    }

    fn apply(
        window: &Window<Wry>,
        session_id: &str,
        bounds: Bounds,
        on_commit: Box<dyn Fn(String) + Send + Sync>,
    ) -> Result<Option<(u16, u16)>, String> {
        let Some(fixed) = crate::chrome::linux_fixed(window) else {
            return Err("native overlay missing".into());
        };
        let created = TERMS.with(|m| m.borrow().contains_key(session_id));
        if !created {
            let widget = create_widget(session_id, &bounds, on_commit)?;
            let backlog = PENDING.with(|p| p.borrow_mut().remove(session_id).unwrap_or_default());
            if !backlog.is_empty() {
                unsafe {
                    vte_terminal_feed(term_ptr(&widget), backlog.as_ptr(), backlog.len() as isize);
                }
            }
            TERMS.with(|m| {
                m.borrow_mut().insert(
                    session_id.to_string(),
                    Slot {
                        widget: widget.clone(),
                        last_text: String::new(),
                        raised: false,
                        last: None,
                        last_size: None,
                        clock: SnapshotClock::default(),
                    },
                );
            });
        }
        TERMS.with(|m| {
            let mut map = m.borrow_mut();
            let Some(slot) = map.get_mut(session_id) else {
                return Ok(None);
            };
            if slot
                .last
                .as_ref()
                .is_some_and(|prev| super::bounds_unchanged(prev, &bounds))
            {
                return Ok(slot.last_size);
            }
            let widget = slot.widget.clone();
            let (xi, yi, wi, hi, raised) =
                super::layout_alloc(bounds.x, bounds.y, bounds.w, bounds.h, bounds.visible);
            let ready = wi >= 8 && hi >= 8;
            slot.raised = raised && ready;
            apply_palette(&widget, &bounds.bg, &bounds.fg);
            unsafe {
                vte_terminal_set_input_enabled(
                    term_ptr(&widget),
                    if slot.raised && bounds.interactive { 1 } else { 0 },
                );
            }
            widget.set_can_focus(slot.raised && bounds.interactive);
            // GTK propagates key events from the toplevel's focus widget, so
            // set_can_focus alone leaves the keyboard with the webview.
            let take_focus =
                super::should_grab_focus(slot.last.as_ref(), &bounds, slot.raised);
            // Overlay child GdkWindow must be the hole, not the origin box of GtkFixed.
            crate::chrome::linux_place_native(&fixed, &widget, xi, yi, wi, hi, slot.raised);
            if slot.raised {
                widget.queue_draw();
                if take_focus && !widget.has_focus() {
                    widget.grab_focus();
                }
            }
            if !ready {
                slot.last = Some(bounds);
                slot.last_size = None;
                return Ok(None);
            }
            let ptr = term_ptr(&widget);
            let cw = unsafe { vte_terminal_get_char_width(ptr) }.max(1);
            let ch = unsafe { vte_terminal_get_char_height(ptr) }.max(1);
            let cols = (wi as c_long / cw).max(1);
            let rows = (hi as c_long / ch).max(1);
            unsafe {
                vte_terminal_set_size(ptr, cols, rows);
            }
            let size = Some((cols as u16, rows as u16));
            slot.last = Some(bounds);
            slot.last_size = size;
            Ok(size)
        })
    }

    fn create_widget(
        session_id: &str,
        bounds: &Bounds,
        on_commit: Box<dyn Fn(String) + Send + Sync>,
    ) -> Result<gtk::Widget, String> {
        let widget: gtk::Widget = unsafe { from_glib_none(vte_terminal_new()) };
        WidgetExt::set_widget_name(&widget, &format!("cc-term-{session_id}"));
        widget.set_hexpand(false);
        widget.set_vexpand(false);
        widget.set_halign(gtk::Align::Start);
        widget.set_valign(gtk::Align::Start);
        let font = FontDescription::from_string("Monospace 13");
        unsafe {
            let ptr = term_ptr(&widget);
            vte_terminal_set_font(ptr, font.to_glib_none().0);
            vte_terminal_set_scrollback_lines(ptr, 2000);
            vte_terminal_set_scroll_on_output(ptr, 1);
            vte_terminal_set_mouse_autohide(ptr, 1);
            vte_terminal_set_audible_bell(ptr, 0);
            vte_terminal_set_cursor_blink_mode(ptr, 1);
        }
        apply_palette(&widget, &bounds.bg, &bounds.fg);
        let stat_id = session_id.to_string();
        widget.connect_local("commit", false, move |values| {
            let text = values
                .get(1)
                .and_then(|v| v.get::<String>().ok())
                .unwrap_or_default();
            if !text.is_empty() {
                crate::stat!(
                    "key",
                    r#""session":"{}","arm":"vte","chars":{}"#,
                    stat_id,
                    text.chars().count()
                );
                on_commit(text);
            }
            None
        });
        Ok(widget)
    }

    fn apply_palette(widget: &gtk::Widget, bg: &str, fg: &str) {
        let ptr = term_ptr(widget);
        if let Ok(color) = RGBA::parse(bg) {
            unsafe {
                vte_terminal_set_color_background(ptr, &color);
            }
        }
        if let Ok(color) = RGBA::parse(fg) {
            unsafe {
                vte_terminal_set_color_foreground(ptr, &color);
            }
        }
    }

    fn snapshot_text(ptr: *mut VteTerminal) -> String {
        let raw = unsafe { vte_terminal_get_text_format(ptr, VTE_FORMAT_TEXT) };
        if raw.is_null() {
            return String::new();
        }
        let text = unsafe { CStr::from_ptr(raw) }
            .to_string_lossy()
            .trim_end()
            .to_string();
        unsafe {
            glib::ffi::g_free(raw.cast());
        }
        text
    }

    pub fn feed(session_id: &str, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let Some(app) = APP.get() else {
            return;
        };
        let Some(window) = app
            .get_window("main")
            .or_else(|| app.get_webview_window("main").map(|w| w.as_ref().window()))
        else {
            return;
        };
        let id = session_id.to_string();
        let bytes = data.to_vec();
        let _ = window.run_on_main_thread(move || {
            feed_on_main(&id, &bytes);
        });
    }

    fn feed_on_main(session_id: &str, data: &[u8]) {
        // VTE invalidates its own region on feed, so no queue_draw here.
        let arm = TERMS.with(|m| {
            let mut map = m.borrow_mut();
            let slot = map.get_mut(session_id)?;
            let t0 = Instant::now();
            unsafe {
                vte_terminal_feed(term_ptr(&slot.widget), data.as_ptr(), data.len() as isize);
            }
            crate::stat!(
                "vte_feed",
                r#""session":"{}","bytes":{},"feed_us":{}"#,
                session_id,
                data.len(),
                t0.elapsed().as_micros()
            );
            Some(slot.clock.on_feed())
        });
        match arm {
            Some(true) => arm_snapshot(session_id.to_string()),
            Some(false) => {}
            None => queue_pending(session_id, data),
        }
    }

    /// Take one screen snapshot after the output settles, and emit it only when
    /// the interpreted frame actually changed.
    fn arm_snapshot(session_id: String) {
        glib::timeout_add_local_once(
            std::time::Duration::from_millis(SNAPSHOT_DEBOUNCE_MS),
            move || {
                let text = TERMS.with(|m| {
                    let mut map = m.borrow_mut();
                    let slot = map.get_mut(&session_id)?;
                    if !slot.clock.on_timer() {
                        return None;
                    }
                    let t0 = Instant::now();
                    let text = snapshot_text(term_ptr(&slot.widget));
                    let changed = text != slot.last_text;
                    crate::stat!(
                        "vte_snapshot",
                        r#""session":"{}","chars":{},"snapshot_us":{},"changed":{}"#,
                        session_id,
                        text.len(),
                        t0.elapsed().as_micros(),
                        changed
                    );
                    if !changed {
                        return None;
                    }
                    slot.last_text = text.clone();
                    Some(text)
                });
                if let Some(text) = text {
                    emit_screen(&session_id, text);
                }
            },
        );
    }

    fn queue_pending(session_id: &str, data: &[u8]) {
        PENDING.with(|p| {
            let mut map = p.borrow_mut();
            let buf = map.entry(session_id.to_string()).or_default();
            buf.extend_from_slice(data);
            const CAP: usize = 1_000_000;
            if buf.len() > CAP {
                let extra = buf.len() - CAP;
                buf.drain(..extra);
            }
        });
    }

    pub fn close(session_id: &str) {
        let Some(app) = APP.get() else {
            return;
        };
        let Some(window) = app
            .get_window("main")
            .or_else(|| app.get_webview_window("main").map(|w| w.as_ref().window()))
        else {
            return;
        };
        let id = session_id.to_string();
        let _ = window.run_on_main_thread(move || {
            PENDING.with(|p| {
                p.borrow_mut().remove(&id);
            });
            let widget = TERMS.with(|m| m.borrow_mut().remove(&id).map(|s| s.widget));
            if let Some(widget) = widget {
                crate::chrome::linux_forget_native(&widget);
                if let Some(parent) = widget.parent() {
                    if let Ok(container) = parent.downcast::<gtk::Container>() {
                        container.remove(&widget);
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{layout_alloc, resolve_backend, SnapshotClock};

    #[test]
    fn backend_defaults_to_the_compiled_target() {
        assert_eq!(resolve_backend(None, true), "vte");
        assert_eq!(resolve_backend(None, false), "xterm");
    }

    #[test]
    fn backend_override_forces_either_arm_of_the_benchmark() {
        assert_eq!(resolve_backend(Some("xterm"), true), "xterm");
        assert_eq!(resolve_backend(Some("vte"), true), "vte");
    }

    #[test]
    fn backend_override_cannot_conjure_a_widget_that_does_not_exist() {
        assert_eq!(resolve_backend(Some("vte"), false), "xterm");
    }

    #[test]
    fn backend_ignores_an_unknown_override() {
        assert_eq!(resolve_backend(Some("kitty"), true), "vte");
        assert_eq!(resolve_backend(Some(""), false), "xterm");
    }

    #[test]
    fn first_feed_arms_one_timer_and_later_feeds_ride_it() {
        let mut clock = SnapshotClock::default();
        assert!(clock.on_feed(), "first feed arms");
        assert!(!clock.on_feed(), "second feed rides the armed timer");
        assert!(!clock.on_feed());
    }

    #[test]
    fn the_timer_takes_one_snapshot_for_the_whole_burst() {
        let mut clock = SnapshotClock::default();
        clock.on_feed();
        clock.on_feed();
        assert!(clock.on_timer(), "burst is due");
        assert!(!clock.on_timer(), "nothing fed since, so nothing to extract");
    }

    #[test]
    fn a_feed_after_the_timer_arms_again() {
        let mut clock = SnapshotClock::default();
        clock.on_feed();
        assert!(clock.on_timer());
        assert!(clock.on_feed(), "the next burst needs its own timer");
        assert!(clock.on_timer());
    }

    #[test]
    fn an_idle_clock_never_extracts() {
        let mut clock = SnapshotClock::default();
        assert!(!clock.on_timer());
        assert_eq!(clock, SnapshotClock::default());
    }

    #[test]
    fn hidden_or_tiny_hole_does_not_fill_the_window() {
        assert_eq!(layout_alloc(0.0, 0.0, 0.0, 0.0, true), (0, 0, 1, 1, false));
        assert_eq!(layout_alloc(40.0, 56.0, 4.0, 800.0, true), (40, 56, 1, 1, false));
    }

    #[test]
    fn ready_hole_keeps_size_when_lowered() {
        assert_eq!(
            layout_alloc(320.0, 56.0, 900.0, 700.0, false),
            (320, 56, 900, 700, false)
        );
    }

    #[test]
    fn visible_hole_keeps_css_rect() {
        assert_eq!(
            layout_alloc(348.4, 56.2, 900.6, 640.8, true),
            (348, 56, 901, 641, true)
        );
    }

    #[test]
    fn vte_text_format_is_the_glib_enum_value() {
        assert_eq!(super::VTE_FORMAT_TEXT, 1);
    }

    fn sample(visible: bool) -> super::Bounds {
        super::Bounds {
            x: 348.4,
            y: 56.2,
            w: 900.6,
            h: 640.8,
            visible,
            interactive: visible,
            bg: "#1e1e1e".into(),
            fg: "#f3f3f3".into(),
        }
    }

    #[test]
    fn focus_is_taken_when_the_hole_becomes_interactive() {
        let off = super::Bounds { interactive: false, ..sample(true) };
        let on = sample(true);
        assert!(super::should_grab_focus(Some(&off), &on, true));
    }

    #[test]
    fn a_first_interactive_hole_takes_focus() {
        assert!(super::should_grab_focus(None, &sample(true), true));
    }

    #[test]
    fn a_resize_of_an_already_focused_hole_does_not_steal_the_keyboard() {
        let before = sample(true);
        let mut wider = before.clone();
        wider.w = 1200.0;
        assert!(!super::should_grab_focus(Some(&before), &wider, true));
    }

    #[test]
    fn a_lowered_or_non_interactive_hole_never_takes_focus() {
        let hidden = super::Bounds { interactive: false, ..sample(false) };
        assert!(!super::should_grab_focus(None, &hidden, true));
        assert!(!super::should_grab_focus(None, &sample(true), false));
    }

    #[test]
    fn bounds_unchanged_ignores_subpixel_noise() {
        let a = sample(true);
        let mut b = a.clone();
        b.x = 348.41;
        b.w = 900.55;
        assert!(super::bounds_unchanged(&a, &b));
    }

    #[test]
    fn bounds_unchanged_sees_visibility_and_palette() {
        let a = sample(true);
        let mut hidden = a.clone();
        hidden.visible = false;
        hidden.interactive = false;
        assert!(!super::bounds_unchanged(&a, &hidden));
        let mut tint = a.clone();
        tint.bg = "#000000".into();
        assert!(!super::bounds_unchanged(&a, &tint));
    }
}
