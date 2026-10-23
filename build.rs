use std::{fs, path::Path, process::Command};

use anyhow::Result;

const APP_ID: &str = "io.github.revenge977.StremioLinuxShellEnhanced";
const GETTEXT_DOMAIN: &str = "stremio";
const GETTEXT_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/po");
const DATA_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/data");

fn main() -> Result<()> {
    setup_po()?;
    setup_schemas()?;
    setup_enhanced()?;

    Ok(())
}

fn watch_dir_recursively(dir: &Path) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    println!("cargo:rerun-if-changed={}", dir.display());
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            watch_dir_recursively(&path)?;
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    Ok(())
}

fn setup_enhanced() -> Result<()> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let enhanced_dir = manifest_dir.join("src/app/enhanced");
    let enhanced_src = enhanced_dir.join("src");
    let enhanced_build_js = enhanced_dir.join("build.js");
    let enhanced_package_json = enhanced_dir.join("package.json");
    let enhanced_tsconfig = enhanced_dir.join("tsconfig.json");
    let enhanced_output = enhanced_dir.join("enhanced.js");

    watch_dir_recursively(&enhanced_src)?;
    println!("cargo:rerun-if-changed={}", enhanced_build_js.display());
    println!("cargo:rerun-if-changed={}", enhanced_package_json.display());
    println!("cargo:rerun-if-changed={}", enhanced_tsconfig.display());

    let status = Command::new("node")
        .arg(&enhanced_build_js)
        .current_dir(&enhanced_dir)
        .status();

    match status {
        Ok(s) if s.success() => {}
        Ok(s) => {
            if !enhanced_output.exists() {
                anyhow::bail!(
                    "Failed to compile enhanced.js (node exit code: {:?}). Ensure Node.js and npm/npx are installed.",
                    s.code()
                );
            } else {
                eprintln!("Warning: Failed to rebuild enhanced.js; using existing bundle.");
            }
        }
        Err(e) => {
            if !enhanced_output.exists() {
                anyhow::bail!(
                    "Failed to run 'node' ({e}) to compile enhanced.js, and no existing bundle was found. Please install Node.js."
                );
            } else {
                eprintln!("Warning: Node.js not found ({e}); using existing enhanced.js.");
            }
        }
    }

    Ok(())
}

fn setup_po() -> Result<()> {
    println!("cargo:rerun-if-changed={GETTEXT_DIR}");

    let po_dir = Path::new(GETTEXT_DIR);
    let mo_dir = Path::new(env!("GETTEXT_DIR"));

    for entry in fs::read_dir(po_dir)? {
        let entry = entry?;
        let path = entry.path();

        if let Some(extension) = path.extension()
            && extension == "po"
            && let Some(po_lang) = path.file_stem()
        {
            let mo_dir = mo_dir.join(po_lang).join("LC_MESSAGES");

            fs::create_dir_all(&mo_dir)?;

            let mo_path = mo_dir.join(format!("{GETTEXT_DOMAIN}.mo"));

            Command::new("msgfmt")
                .arg("-o")
                .arg(mo_path)
                .arg(path)
                .spawn()?;
        }
    }

    Ok(())
}

fn setup_schemas() -> Result<()> {
    println!("cargo:rerun-if-changed={DATA_DIR}");

    let out_dir = Path::new(env!("GSETTINGS_SCHEMA_DIR"));
    fs::create_dir_all(out_dir)?;

    let source_filename = &format!("{APP_ID}.gschema.xml");
    let source_file = Path::new(DATA_DIR).join(source_filename);

    let output_app_id = match cfg!(debug_assertions) {
        true => &format!("{APP_ID}.Devel"),
        false => APP_ID,
    };

    let output_filename = &format!("{output_app_id}.gschema.xml");
    let output_file = out_dir.join(output_filename);

    fs::copy(source_file, &output_file)?;

    if cfg!(debug_assertions) {
        let content = fs::read_to_string(&output_file)?;
        let new_content = content.replace(APP_ID, output_app_id);

        fs::write(output_file, new_content)?;
    }

    let output = Command::new("glib-compile-schemas").arg(out_dir).output()?;

    assert!(
        output.status.success(),
        "Failed to compile schemas: {}\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );

    Ok(())
}
