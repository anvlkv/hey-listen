//! Project file errors, serializable for the Tauri IPC boundary.

use serde::Serialize;

/// Errors produced while reading or writing a project file.
#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("could not access the project file: {0}")]
    Io(#[from] std::io::Error),
    #[error("not a Hey Listen project file")]
    BadMagic,
    #[error("unsupported project file version {0}")]
    UnsupportedVersion(u32),
    #[error("the project file is corrupt: {0}")]
    Corrupt(String),
    #[error("could not encode the project data: {0}")]
    Encode(String),
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
impl Serialize for ProjectError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
