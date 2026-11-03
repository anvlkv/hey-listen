//! Step through the `.heyl` files in a project's folder (M25.D).
//!
//! An evaluation run produces many sibling projects (one per species / recording) in a
//! single directory; File → Previous/Next Project and the toolbar's arrows move between
//! them without a dialog. The order is the folder's file names, case-insensitively, so
//! it is stable and obvious.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::PROJECT_EXTENSION;

/// The neighbouring project files of a project, in one folder read.
///
/// Drives the toolbar's `[<] name [>]` arrows: each is disabled when its neighbour does
/// not exist (including for an unsaved project, which has no folder yet).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AdjacentProjects {
    /// The previous project file in name order (`None` at the start of the folder).
    pub previous: Option<String>,
    /// The next project file in name order (`None` at the end of the folder).
    pub next: Option<String>,
}

/// Both neighbours of `path` in its folder (the toolbar's Previous/Next state).
#[tauri::command]
pub fn adjacent_projects(path: String) -> AdjacentProjects {
    let (previous, next) = neighbours(&path).unwrap_or((None, None));
    AdjacentProjects { previous, next }
}

/// The neighbouring project file in `path`'s folder.
///
/// `direction` is negative for the previous file and positive for the next; the ends
/// stop (no wrap-around). Returns `None` when `path` is not a project file in a
/// readable folder or has no neighbour.
#[tauri::command]
pub fn adjacent_project(path: String, direction: i32) -> Option<String> {
    if direction == 0 {
        return None;
    }
    let (previous, next) = neighbours(&path)?;
    if direction < 0 {
        previous
    } else {
        next
    }
}

/// The project files before and after `path`, when `path` is one of them.
fn neighbours(path: &str) -> Option<(Option<String>, Option<String>)> {
    let current = Path::new(path);
    let folder = current.parent()?;
    let projects = project_files(folder);
    let index = projects
        .iter()
        .position(|(_, candidate)| candidate.file_name() == current.file_name())?;

    let before = index
        .checked_sub(1)
        .and_then(|index| projects.get(index))
        .map(|(_, path)| path.to_string_lossy().into_owned());
    let after = projects
        .get(index + 1)
        .map(|(_, path)| path.to_string_lossy().into_owned());
    Some((before, after))
}

/// The `.heyl` files in `folder`, ordered by file name (case-insensitively).
fn project_files(folder: &Path) -> Vec<(String, PathBuf)> {
    let mut projects: Vec<(String, PathBuf)> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
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
    projects
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

    /// Create `names` in `dir` as dummy files.
    fn plant(dir: &Path, names: &[&str]) {
        for name in names {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
    }

    /// A file's path as the command returns it.
    fn path_of(dir: &Path, name: &str) -> String {
        dir.join(name).to_string_lossy().into_owned()
    }

    #[test]
    fn steps_through_project_files_in_name_order() {
        let dir = temp_dir("order");
        plant(&dir, &["b.heyl", "a.heyl", "c.txt", "d.HEYL"]);
        let a = path_of(&dir, "a.heyl");
        let b = path_of(&dir, "b.heyl");
        let d = path_of(&dir, "d.HEYL");

        // Case-insensitive name order: a, b, d (c.txt is not a project).
        assert_eq!(adjacent_project(b.clone(), 1), Some(d.clone()));
        assert_eq!(adjacent_project(d, 1), None);
        assert_eq!(adjacent_project(b, -1), Some(a.clone()));
        assert_eq!(adjacent_project(a.clone(), -1), None);
        assert_eq!(adjacent_project(a, 0), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn both_neighbours_come_from_one_read() {
        let dir = temp_dir("neighbours");
        plant(&dir, &["b.heyl", "a.heyl", "d.HEYL"]);
        let a = path_of(&dir, "a.heyl");
        let b = path_of(&dir, "b.heyl");
        let d = path_of(&dir, "d.HEYL");

        assert_eq!(
            adjacent_projects(b),
            AdjacentProjects {
                previous: Some(a.clone()),
                next: Some(d),
            }
        );
        // The ends have one neighbour each, so the toolbar disables the other arrow.
        assert_eq!(
            adjacent_projects(a.clone()),
            AdjacentProjects {
                previous: None,
                next: Some(dir.join("b.heyl").to_string_lossy().into_owned()),
            }
        );
        assert_eq!(
            adjacent_projects("stray.heyl".to_string()),
            AdjacentProjects {
                previous: None,
                next: None,
            }
        );
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
