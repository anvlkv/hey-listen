//! Project file errors, serializable for the Tauri IPC boundary.

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
serialize_error_as_string!(ProjectError);
