//! Binary project file store (M6).
//!
//! A single-file, versioned container: a fixed header, a section index, the section
//! payloads, and a trailing checksum. Structured sections use `postcard`, the layout
//! uses `serde_json`, and `DATA` is a raw interleaved-`f32`/`i16` blob written in fixed
//! chunks with a trailing chunk index, so large audio streams in (and can be seeked)
//! without holding the whole file twice.
//!
//! This module is deliberately free of `tauri` types so the format round-trips in
//! unit tests; `commands/project.rs` adapts it to the IPC boundary.
//!
//! ```text
//! +0    magic           4 bytes   "HEYL"
//! +4    version         4 bytes   u32 LE
//! +8    flags           4 bytes   u32 LE
//! +12   section_count   4 bytes   u32 LE
//! +16   section_index   N * 24    offset (u64) + length (u64) + id (u8) + reserved (7)
//! ...   sections        ...
//! +end  checksum        8 bytes   CRC-32 of everything before it (stored as u64 LE)
//! ```

use std::path::{Path, PathBuf};

pub mod annotations;
mod error;
mod migrate;
mod read;
pub(crate) mod sections;
pub mod side;
mod write;

pub use error::ProjectError;
pub use migrate::DroppedSection;
pub use read::{read_project, LoadedProject};
pub use sections::{
    AnalysisSetup, AnalysisWindow, Annotation, AnnotationValues, Meta, SourceDescriptor,
    SourceKind, SourceStorage, StoredResult,
};
#[allow(unused_imports)] // `write_project` is the in-memory writer the tests use
pub use write::{write_project, write_project_atomic, write_project_with_pcm_format, SaveProject};

/// File magic at offset 0 (`"HEYL"`).
pub const MAGIC: [u8; 4] = *b"HEYL";
/// Container version.
pub const VERSION: u32 = 8;
/// The oldest container version this build reads. Older files are migrated forward through
/// the step chain in [`migrate`] (ADR-32); anything outside `MIN_READ_VERSION..=VERSION`
/// is an `UnsupportedVersion` error.
pub const MIN_READ_VERSION: u32 = 1;
/// Feature flags; unused today (bit 0 is reserved for a future endianness/compression
/// flag), so writers emit 0 and readers ignore it.
pub const FLAGS: u32 = 0;

/// Fixed header length, in bytes.
pub const HEADER_LEN: usize = 16;
/// One section-index entry: offset (u64) + length (u64) + id (u8) + 7 reserved bytes.
pub const INDEX_ENTRY_LEN: usize = 24;
/// Trailing checksum length, in bytes.
pub const CHECKSUM_LEN: usize = 8;

// Section ids.
pub const SECTION_META: u8 = 0x01;
pub const SECTION_SOURCE: u8 = 0x02;
pub const SECTION_DATA: u8 = 0x03;
pub const SECTION_SETUP: u8 = 0x04;
pub const SECTION_LAYOUT: u8 = 0x05;
pub const SECTION_RESULTS: u8 = 0x06;
pub const SECTION_ANNOTATIONS: u8 = 0x07;
/// Saved comparison snapshots (M25.C, M23 Phase 3): the reference side of each compare
/// tab, several per tool.
pub const SECTION_COMPARE: u8 = 0x08;

/// Interleaved samples per `DATA` chunk (~256 KiB at `f32`). Bounds per-chunk memory
/// and keeps the chunk index small.
///
/// Deliberately distinct from `crate::audio::STREAM_CHUNK_SAMPLES`: this is part of
/// the on-disk format (the reader/writer and the `DATA` header record it), so it must
/// not drift with the in-memory IPC streaming chunk size.
pub const DATA_CHUNK_SAMPLES: usize = 64 * 1024;

// `DATA` section sub-layout: a self-describing header, the chunks, a trailing
// chunk index (offset + length per chunk, relative to the payload start), then a
// footer pointing at the index. Appending a chunk only rewrites the index/footer.
pub const DATA_HEADER_LEN: u64 = 24;
pub const DATA_INDEX_ENTRY_LEN: u64 = 16;
pub const DATA_FOOTER_LEN: u64 = 16;
/// Sample-format tag for interleaved little-endian `f32` (the app's default).
pub const PCM_FORMAT_F32: u8 = 0;
/// Sample-format tag for interleaved little-endian `i16` (D-20).
pub const PCM_FORMAT_I16: u8 = 1;

/// How a `DATA` payload encodes its samples: the header's `format` byte plus the sample
/// width every size check needs.
///
/// The layout itself is width-agnostic — the chunk index stores **byte** offsets and
/// lengths — so both formats share the header/chunks/index/footer shape and differ only
/// in a chunk's decoding. The core always holds `f32`
/// ([`SourceData`](crate::state::SourceData)); this only selects the on-disk encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PcmFormat {
    /// Little-endian `f32`, the app's default (`format = 0`).
    F32,
    /// Little-endian `i16` (`format = 1`): half the size, a `1 / 32768` step.
    I16,
}

impl PcmFormat {
    /// The `DATA` header's `format` byte.
    pub fn format_byte(self) -> u8 {
        match self {
            PcmFormat::F32 => PCM_FORMAT_F32,
            PcmFormat::I16 => PCM_FORMAT_I16,
        }
    }

    /// Bytes per interleaved sample on disk.
    pub fn byte_width(self) -> u64 {
        match self {
            PcmFormat::F32 => 4,
            PcmFormat::I16 => 2,
        }
    }

    /// Parse a `DATA` header's `format` byte; `None` is an unsupported format.
    pub fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            PCM_FORMAT_F32 => Some(PcmFormat::F32),
            PCM_FORMAT_I16 => Some(PcmFormat::I16),
            _ => None,
        }
    }
}

/// Decode a **linked** project's file source again (a project whose `storage` is
/// [`SourceStorage::Linked`] has no `DATA` section; the `SOURCE` descriptor keeps the
/// path). Returns `None` when the source is not a file or the file cannot be decoded, so a
/// project with a missing external recording still opens (with an empty timeline).
pub fn decode_reference(
    source: Option<&SourceDescriptor>,
    base_dir: Option<&Path>,
) -> Option<crate::state::SourceData> {
    let path = resolve_link(source?, base_dir)?;
    let path = path.to_str()?;
    let mut samples = Vec::new();
    let summary = crate::audio::decode::decode_file(path, |chunk| {
        samples.extend_from_slice(chunk);
        Ok(())
    })
    .ok()?;
    Some(crate::state::SourceData {
        samples,
        sample_rate: summary.sample_rate.max(1),
        channels: summary.channels.max(1),
    })
}

/// The file a linked source points at: the project-relative path first (so a project
/// folder moved with its recording still resolves), then the recorded path — resolved
/// against `base_dir` when it is relative. The first candidate that is a file wins.
pub fn resolve_link(source: &SourceDescriptor, base_dir: Option<&Path>) -> Option<PathBuf> {
    if source.kind != SourceKind::File {
        return None;
    }
    if let (Some(base), Some(relative)) = (base_dir, source.relative_path.as_deref()) {
        let candidate = base.join(relative);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let path = Path::new(source.path.as_deref()?);
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base_dir.map_or_else(|| path.to_path_buf(), |base| base.join(path))
    };
    candidate.is_file().then_some(candidate)
}

/// Record the source path relative to the project file it is being saved beside.
///
/// Never canonicalizes: a save must not resolve symlinks or fail on a path that does not
/// exist yet. A path outside `project_dir` (or a source with no path) leaves
/// `relative_path` unset.
pub(crate) fn relativize(source: &mut SourceDescriptor, project_dir: Option<&Path>) {
    source.relative_path = None;
    if source.kind != SourceKind::File {
        return;
    }
    let (Some(path), Some(dir)) = (source.path.as_deref(), project_dir) else {
        return;
    };
    if dir.as_os_str().is_empty() {
        return;
    }
    let Ok(relative) = Path::new(path).strip_prefix(dir) else {
        return;
    };
    let parts: Vec<String> = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect();
    if !parts.is_empty() {
        source.relative_path = Some(parts.join("/"));
    }
}

// --- checksum ----------------------------------------------------------------

/// CRC-32 lookup table, generated at compile time (IEEE 802.3 polynomial).
const fn crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0usize;
    while i < 256 {
        let mut crc = i as u32;
        let mut bit = 0;
        while bit < 8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
            bit += 1;
        }
        table[i] = crc;
        i += 1;
    }
    table
}

static CRC_TABLE: [u32; 256] = crc_table();

/// CRC-32 (IEEE 802.3) accumulator over the container bytes.
#[derive(Debug, Clone, Copy)]
struct Crc32 {
    state: u32,
}

impl Crc32 {
    fn new() -> Self {
        Self { state: 0xFFFF_FFFF }
    }

    fn update(&mut self, bytes: &[u8]) {
        let mut crc = self.state;
        for &byte in bytes {
            let index = ((crc ^ u32::from(byte)) & 0xFF) as usize;
            crc = (crc >> 8) ^ CRC_TABLE[index];
        }
        self.state = crc;
    }

    fn finish(self) -> u32 {
        self.state ^ 0xFFFF_FFFF
    }
}

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod tests_compare;

#[cfg(test)]
mod tests_storage;

#[cfg(test)]
mod tests_data;
