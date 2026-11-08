//! Binary project file store (M6) — see `docs/project-file-format.md`.
//!
//! A single-file, versioned container: a fixed header, a section index, the section
//! payloads, and a trailing checksum. Structured sections use `postcard`, the layout
//! uses `serde_json`, and `DATA` is a raw interleaved-`f32` blob written in fixed
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

pub mod annotations;
mod error;
mod read;
pub(crate) mod sections;
pub mod side;
mod write;

pub use error::ProjectError;
pub use read::{read_project, LoadedProject};
pub use sections::{
    AnalysisSetup, AnalysisWindow, Annotation, Meta, SourceDescriptor, SourceKind, StoredResult,
};
#[allow(unused_imports)] // `write_project` is the in-memory writer the tests use
pub use write::{write_project, write_project_atomic, SaveProject};

/// File magic at offset 0 (`"HEYL"`).
pub const MAGIC: [u8; 4] = *b"HEYL";
/// Container version (`docs/project-file-format.md`).
pub const VERSION: u32 = 1;
/// Feature flags; unused today (bit 0 is reserved for a future endianness/compression
/// flag), so writers emit 0 and readers ignore it.
pub const FLAGS: u32 = 0;

/// Fixed header length, in bytes.
pub const HEADER_LEN: usize = 16;
/// One section-index entry: offset (u64) + length (u64) + id (u8) + 7 reserved bytes.
pub const INDEX_ENTRY_LEN: usize = 24;
/// Trailing checksum length, in bytes.
pub const CHECKSUM_LEN: usize = 8;

// Section ids (see `docs/project-file-format.md` → Sections).
pub const SECTION_META: u8 = 0x01;
pub const SECTION_SOURCE: u8 = 0x02;
pub const SECTION_DATA: u8 = 0x03;
pub const SECTION_SETUP: u8 = 0x04;
pub const SECTION_LAYOUT: u8 = 0x05;
pub const SECTION_RESULTS: u8 = 0x06;
pub const SECTION_ANNOTATIONS: u8 = 0x07;
/// Saved comparison snapshots (M25.C): one reference `AnalysisResult` per tool.
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
/// Sample-format tag for interleaved little-endian `f32` (the only format today).
pub const PCM_FORMAT_F32: u8 = 0;

/// Decode a **reference** project's file source again (a project saved with
/// `embedSource: false` has no `DATA` section; the `SOURCE` descriptor keeps the path).
/// Returns `None` when the source is not a file or the file cannot be decoded, so a
/// project with a missing external recording still opens (with an empty timeline).
pub fn decode_reference(source: Option<&SourceDescriptor>) -> Option<crate::state::SourceData> {
    let source = source?;
    if source.kind != SourceKind::File {
        return None;
    }
    let path = source.path.as_deref()?;
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
mod tests_data;
