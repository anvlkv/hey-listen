//! Step through the `.heyl` files in a project's folder (M25.D).
//!
//! An evaluation run produces many sibling projects (one per species / recording) in a
//! single directory; File → Previous/Next Project moves between them without a dialog.
//! The order is the folder's file names, case-insensitively, so it is stable and obvious.

use std::path::{Path, PathBuf};

use super::PROJECT_EXTENSION;

/// The neighbouring project file in `path`'s folder.
///
/// `direction` is negative for the previous file and positive for the next; the ends
/// stop (no wrap-around). Returns `None` when `path` is not a project file in a
/// readable folder or has no neighbour.
#[tauri::command]
pub fn adjacent_project(path: String, direction: i32) -> Option<String> {
    let current = Path::new(&path);
    let folder = current.parent()?;
    if direction == 0 {
        return None;
    }

    let mut projects: Vec<(String, PathBuf)> = std::fs::read_dir(folder)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|candidate| {
            candidate
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case(PROJECT_EXTENSION))
        })
        .filter_map(|candidate| {
            let name = candidate.file_name()?.to_str()?.to_lowercase();
            Some((name, candidate))
        })
        .collect();
    // Same-name files differing only in case are ordered by their real path.
    projects.sort();

    let index = projects
        .iter()
        .position(|(_, candidate)| candidate.file_name() == current.file_name())?;
    let target = if direction < 0 {
        index.checked_sub(1)?
    } else {
        index + 1
    };
    let (_, next) = projects.get(target)?;
    Some(next.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("hey_listen_siblings_{}_{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn steps_through_project_files_in_name_order() {
        let dir = temp_dir("order");
        for name in ["b.heyl", "a.heyl", "c.txt", "d.HEYL"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        let a = dir.join("a.heyl").to_string_lossy().into_owned();
        let b = dir.join("b.heyl").to_string_lossy().into_owned();
        let d = dir.join("d.HEYL").to_string_lossy().into_owned();

        // Case-insensitive name order: a, b, d (c.txt is not a project).
        assert_eq!(adjacent_project(b.clone(), 1), Some(d.clone()));
        assert_eq!(adjacent_project(d, 1), None);
        assert_eq!(adjacent_project(b, -1), Some(a.clone()));
        assert_eq!(adjacent_project(a.clone(), -1), None);
        assert_eq!(adjacent_project(a, 0), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_project_outside_the_folder_has_no_neighbour() {
        let dir = temp_dir("missing");
        let stray = dir.join("stray.heyl").to_string_lossy().into_owned();
        assert_eq!(adjacent_project(stray, 1), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
