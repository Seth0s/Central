fn main() {
    tauri_build::build();
    link_vte_linux();
}

fn link_vte_linux() {
    #[cfg(target_os = "linux")]
    {
        // Tell rustc this cfg is intentional (avoids unexpected_cfgs on 1.80+).
        println!("cargo:rustc-check-cfg=cfg(vte_get_text_format)");

        match pkg_config::Config::new()
            .atleast_version("0.62")
            .probe("vte-2.91")
        {
            Ok(lib) => {
                // get_text_format arrived in VTE 0.76 (Ubuntu 24.04+).
                // Ubuntu 22.04 CI ships ~0.68 and still has get_text.
                if vte_version_at_least(&lib.version, 0, 76) {
                    println!("cargo:rustc-cfg=vte_get_text_format");
                }
            }
            Err(_) => {
                // Runtime package (vte291) ships libvte-2.91.so.0; -devel adds the .pc.
                // Without a version, keep the pre-0.76 symbol so link succeeds on Jammy.
                let libdir = std::env::var("VTE_LIBDIR").unwrap_or_else(|_| "/usr/lib64".into());
                println!("cargo:rustc-link-search=native={libdir}");
                println!("cargo:rustc-link-arg=-Wl,-l:libvte-2.91.so.0");
            }
        }
    }
}

fn vte_version_at_least(version: &str, major: u32, minor: u32) -> bool {
    let mut parts = version.split('.').filter_map(|p| p.parse::<u32>().ok());
    let maj = parts.next().unwrap_or(0);
    let min = parts.next().unwrap_or(0);
    (maj, min) >= (major, minor)
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_vte_versions() {
        assert!(!super::vte_version_at_least("0.68.0", 0, 76));
        assert!(super::vte_version_at_least("0.76", 0, 76));
        assert!(super::vte_version_at_least("0.80.1", 0, 76));
    }
}
