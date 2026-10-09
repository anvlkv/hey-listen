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

mod error;
mod read;
mod sections;
mod write;

pub use error::ProjectError;
pub use read::{read_project, LoadedProject};
pub use sections::{AnalysisSetup, Meta, SourceDescriptor, StoredResult};
pub use write::{write_project, SaveProject};

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

/// Interleaved samples per `DATA` chunk (~256 KiB at `f32`). Bounds per-chunk memory
/// and keeps the chunk index small.
pub const DATA_CHUNK_SAMPLES: usize = 64 * 1024;

// `DATA` section sub-layout: a self-describing header, the chunks, a trailing
// chunk index (offset + length per chunk, relative to the payload start), then a
// footer pointing at the index. Appending a chunk only rewrites the index/footer.
pub const DATA_HEADER_LEN: u64 = 24;
pub const DATA_INDEX_ENTRY_LEN: u64 = 16;
pub const DATA_FOOTER_LEN: u64 = 16;
/// Sample-format tag for interleaved little-endian `f32` (the only format today).
pub const PCM_FORMAT_F32: u8 = 0;

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
mod tests {
    use std::collections::BTreeMap;
    use std::io::Cursor;

    use super::sections::{AnalysisWindow, StoredResult};
    use super::*;
    use crate::state::SourcePcm;

    fn setup() -> AnalysisSetup {
        AnalysisSetup {
            shared: Default::default(),
            tool_options: BTreeMap::from([(
                "mfcc".to_string(),
                BTreeMap::from([("nMfcc".to_string(), 20.0)]),
            )]),
            open_tools: vec!["spectrum".to_string(), "filter".to_string()],
            window: AnalysisWindow {
                start_secs: 0.25,
                end_secs: 1.5,
            },
            view: AnalysisWindow {
                start_secs: 0.0,
                end_secs: 2.0,
            },
            filter_enabled: true,
        }
    }

    fn pcm(samples: usize) -> SourcePcm {
        let values: Vec<f32> = (0..samples).map(|i| (i as f32 * 0.001).sin()).collect();
        SourcePcm {
            samples: values,
            sample_rate: 48_000,
            channels: 2,
        }
    }

    fn write(save: &SaveProject, now_ms: u64) -> Cursor<Vec<u8>> {
        let mut cursor = Cursor::new(Vec::new());
        write_project(&mut cursor, save, now_ms).expect("write");
        cursor
    }

    #[test]
    fn round_trips_every_section() {
        let pcm = pcm(5_000);
        let save = SaveProject {
            name: "Test project".to_string(),
            created_ms: Some(1_000),
            source: Some(SourceDescriptor {
                kind: "file".to_string(),
                path: Some("/tmp/tone.wav".to_string()),
                ..Default::default()
            }),
            setup: setup(),
            layout: serde_json::json!({ "dockview": { "grid": {} }, "graphs": {} }),
            results: vec![StoredResult {
                tool: "spectrum".to_string(),
                start: 0.0,
                end: 1.0,
                params: Default::default(),
                options: BTreeMap::new(),
                result: vec![1, 2, 3],
            }],
            pcm: Some(&pcm),
        };

        let bytes = write(&save, 2_000).into_inner();
        let loaded = read_project(&mut Cursor::new(bytes)).expect("read");

        assert_eq!(loaded.meta.name, "Test project");
        assert_eq!(loaded.meta.created_ms, 1_000);
        assert_eq!(loaded.meta.modified_ms, 2_000);
        assert_eq!(loaded.setup.open_tools, vec!["spectrum", "filter"]);
        assert!(loaded.setup.filter_enabled);
        assert_eq!(loaded.layout["dockview"]["grid"], serde_json::json!({}));
        assert_eq!(loaded.results.len(), 1);
        assert_eq!(loaded.results[0].result, vec![1, 2, 3]);
        assert_eq!(loaded.meta.app_version, "0.1.0");
        assert_eq!(loaded.source.expect("source").kind, "file");

        let pcm = loaded.pcm.expect("pcm");
        assert_eq!(pcm.sample_rate, 48_000);
        assert_eq!(pcm.channels, 2);
        assert_eq!(pcm.samples.len(), 5_000);
        assert_eq!(pcm.samples[42], (42.0f32 * 0.001).sin());
    }

    #[test]
    fn streams_audio_across_chunks() {
        // More than one DATA chunk, and a sample count that is not a chunk multiple.
        let count = DATA_CHUNK_SAMPLES * 2 + 7;
        let pcm = pcm(count);
        let save = SaveProject {
            name: "big".to_string(),
            created_ms: None,
            source: None,
            setup: AnalysisSetup::default(),
            layout: serde_json::Value::Null,
            results: Vec::new(),
            pcm: Some(&pcm),
        };

        let bytes = write(&save, 5).into_inner();
        let loaded = read_project(&mut Cursor::new(bytes)).expect("read");
        let loaded_pcm = loaded.pcm.expect("pcm");
        assert_eq!(loaded_pcm.samples.len(), count);
        assert_eq!(loaded_pcm.samples, pcm.samples);
    }

    #[test]
    fn writes_a_project_without_audio() {
        let save = SaveProject {
            name: "empty".to_string(),
            created_ms: None,
            source: None,
            setup: AnalysisSetup::default(),
            layout: serde_json::Value::Null,
            results: Vec::new(),
            pcm: None,
        };

        let bytes = write(&save, 5).into_inner();
        let loaded = read_project(&mut Cursor::new(bytes)).expect("read");
        assert!(loaded.pcm.is_none());
    }

    #[test]
    fn rejects_a_corrupt_checksum() {
        let pcm = pcm(64);
        let save = SaveProject {
            name: "test".to_string(),
            created_ms: None,
            source: None,
            setup: AnalysisSetup::default(),
            layout: serde_json::Value::Null,
            results: Vec::new(),
            pcm: Some(&pcm),
        };

        let mut bytes = write(&save, 5).into_inner();
        let mid = bytes.len() / 2;
        bytes[mid] ^= 0xFF;
        assert!(matches!(
            read_project(&mut Cursor::new(bytes)),
            Err(ProjectError::Corrupt(_))
        ));
    }

    #[test]
    fn rejects_a_foreign_file() {
        let mut bytes = b"NOPE".to_vec();
        bytes.resize(64, 0);
        assert!(matches!(
            read_project(&mut Cursor::new(bytes)),
            Err(ProjectError::BadMagic)
        ));
    }
}
