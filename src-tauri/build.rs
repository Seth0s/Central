fn main() {
    tauri_build::build();
    link_vte_linux();
}

fn link_vte_linux() {
    #[cfg(target_os = "linux")]
    {
        if pkg_config::Config::new()
            .atleast_version("0.62")
            .probe("vte-2.91")
            .is_ok()
        {
            return;
        }
        // Runtime package (vte291) ships libvte-2.91.so.0; -devel adds the .pc and unversioned .so.
        let libdir = std::env::var("VTE_LIBDIR").unwrap_or_else(|_| "/usr/lib64".into());
        println!("cargo:rustc-link-search=native={libdir}");
        println!("cargo:rustc-link-arg=-Wl,-l:libvte-2.91.so.0");
    }
}
