//! Open (or raise) the project a compare view is bound to (M25.D).
//!
//! A compare view names its other side but gives no way to reach it: a **live**
//! reference already lives in another project window (possibly behind this one), while
//! a **saved** reference has no window at all until its project file is opened again.
//! This command resolves both cases from one button:
//!
//! 1. a live reference label → raise that window;
//! 2. the owner's saved snapshot for `tool` → open the reference **file** it recorded.
//!
//! The file path is stored with the snapshot (M25.C follow-up), so nothing here guesses
//! a project from its display name — two projects can share one, and an origin project's
//! title may share a prefix with the owner's file. A reference file that has since been
//! deleted is reported; the frontend shows it as a transient notice.

use std::path::Path;

use tauri::{Manager, WebviewWindow};

use crate::audio::analysis::compare::SavedComparison;
use crate::audio::analyzers::AnalyzerId;
use crate::commands::window::project::open_file_window;
use crate::commands::window::raise;
use crate::state::window_state;

/// Open the compare view's reference project, or raise the window that shows it.
///
/// `label` is a live reference (a project window label); `tool` names the analyzer whose
/// saved snapshot to read a reference **path** from. Returns `"focused"` or `"opened"`.
#[tauri::command]
pub fn open_reference_window(
    window: WebviewWindow,
    label: Option<String>,
    tool: Option<AnalyzerId>,
) -> Result<String, String> {
    let app = window.app_handle();

    // 1. The live reference window itself. Never this window: a project is not its own
    //    reference.
    if let Some(label) = label.filter(|label| !label.is_empty()) {
        if label == window.label() {
            return Err("the reference is this project".to_string());
        }
        let Some(target) = app.get_webview_window(&label) else {
            return Err(
                "the reference project is closed — open it again, then compare".to_string(),
            );
        };
        raise(&target);
        return Ok("focused".to_string());
    }

    // 2. A saved reference: the project file recorded with its snapshot.
    let tool = tool.ok_or_else(|| "this comparison has no reference project".to_string())?;
    let snapshot = window_state(&window)
        .saved_comparison(tool)
        .ok_or_else(|| format!("no saved comparison for '{tool}'"))?;
    let path = reference_file(&snapshot)?;
    open_file_window(app, &path)?;
    Ok("opened".to_string())
}

/// The reference file a saved comparison recorded, or why it cannot be opened.
///
/// A comparison against a project that was never saved records no path — there is
/// nothing to reopen, and guessing one from the display name is what used to open the
/// owner project instead.
fn reference_file(snapshot: &SavedComparison) -> Result<String, String> {
    let Some(path) = snapshot.reference_path.clone() else {
        return Err(format!(
            "“{}” has no recorded project file — reconnect the comparison to its project, \
             then compare again",
            snapshot.reference_name
        ));
    };
    if !Path::new(&path).is_file() {
        return Err(format!("the reference project file is missing: {path}"));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::reference_file;
    use crate::audio::analysis::compare::{SavedComparison, SourceShape, Span};
    use crate::audio::analysis::fixtures;
    use crate::audio::analysis::{AnalysisResult, SharedParams, StoredAnalysisResult, ToolOptions};
    use crate::audio::analyzers::AnalyzerId;

    fn snapshot(reference_path: Option<String>) -> SavedComparison {
        SavedComparison {
            tool: AnalyzerId::Spectrum,
            reference_name: "agelaius_phoeniceus XC1136859".to_string(),
            source: SourceShape {
                sample_rate: 48_000,
                channels: 2,
                duration: 17.0,
            },
            window: Span {
                start: 0.0,
                end: 17.0,
            },
            params: SharedParams::default(),
            options: ToolOptions::default(),
            filter_fingerprint: None,
            b_offset: 0.0,
            saved_ms: 1,
            result: StoredAnalysisResult::from(&AnalysisResult::Spectrum(fixtures::spectrum())),
            reference_path,
        }
    }

    #[test]
    fn a_recorded_reference_file_opens() {
        let path =
            std::env::temp_dir().join(format!("hey_listen_reference_{}.heyl", std::process::id()));
        std::fs::write(&path, b"x").unwrap();
        let path = path.to_string_lossy().to_string();

        assert_eq!(
            reference_file(&snapshot(Some(path.clone()))),
            Ok(path.clone())
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_missing_reference_file_is_reported() {
        let path = std::env::temp_dir().join("hey_listen_missing_reference.heyl");
        let err = reference_file(&snapshot(Some(path.to_string_lossy().to_string())))
            .expect_err("a missing file must not open");
        assert!(err.contains("missing"), "{err}");
    }

    #[test]
    fn a_snapshot_without_a_path_is_reported() {
        // An older file (or a comparison against an unsaved project) must say so instead
        // of falling back to a name lookup.
        let err = reference_file(&snapshot(None)).expect_err("no path must not open");
        assert!(err.contains("no recorded project file"), "{err}");
    }
}
