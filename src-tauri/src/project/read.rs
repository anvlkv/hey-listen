//! Project file reader — see `docs/project-file-format.md`.
//!
//! The reader verifies the header and the trailing checksum, then uses the section
//! index to read each payload. `DATA` is parsed via its own trailing chunk index,
//! so audio is read chunk-by-chunk and chunks can be seeked independently.

use std::io::{Read, Seek, SeekFrom};

use super::error::ProjectError;
use super::migrate::{self, Sections};
use super::sections::{AnalysisSetup, Annotation, Meta, SourceDescriptor, StoredResult};
use super::{
    Crc32, DroppedSection, CHECKSUM_LEN, DATA_FOOTER_LEN, DATA_HEADER_LEN, DATA_INDEX_ENTRY_LEN,
    HEADER_LEN, INDEX_ENTRY_LEN, MAGIC, MIN_READ_VERSION, PCM_FORMAT_F32, SECTION_ANNOTATIONS,
    SECTION_COMPARE, SECTION_DATA, SECTION_LAYOUT, SECTION_META, SECTION_RESULTS, SECTION_SETUP,
    SECTION_SOURCE, VERSION,
};
use crate::audio::analysis::compare::{SavedComparison, SavedComparisonV1};
use crate::state::SourceData;

/// The parsed contents of a project file.
#[derive(Debug, Clone)]
pub struct LoadedProject {
    pub meta: Meta,
    pub source: Option<SourceDescriptor>,
    pub setup: AnalysisSetup,
    pub layout: serde_json::Value,
    pub results: Vec<StoredResult>,
    /// The project's annotations (empty when the file has no `ANNOTATIONS` section).
    pub annotations: Vec<Annotation>,
    /// Saved comparison snapshots (empty when the file has no `COMPARE` section).
    pub compare: Vec<SavedComparison>,
    /// The embedded audio, if the file had a `DATA` section with samples.
    pub pcm: Option<SourceData>,
    /// Whether the file carried its audio (`DATA`) rather than referencing the source —
    /// `false` is a **reference** project (see `docs/project-file-format.md`).
    pub embedded: bool,
    /// The container version the file was written with (see [`VERSION`]).
    pub format_version: u32,
    /// `Some(version)` when the file was migrated forward to [`VERSION`] (ADR-32).
    pub upgraded_from: Option<u32>,
    /// Analysis output this load dropped; never user data (see [`DroppedSection`]).
    pub dropped: Vec<DroppedSection>,
}

/// One entry from the section index.
struct SectionEntry {
    id: u8,
    offset: u64,
    length: u64,
}

/// Read and validate a project file.
pub fn read_project<R: Read + Seek>(reader: &mut R) -> Result<LoadedProject, ProjectError> {
    let len = reader.seek(SeekFrom::End(0))?;
    if len < (HEADER_LEN + CHECKSUM_LEN) as u64 {
        return Err(ProjectError::Corrupt("file is too small".to_string()));
    }

    reader.seek(SeekFrom::Start(0))?;
    let mut header = [0u8; HEADER_LEN];
    reader.read_exact(&mut header)?;
    if header[0..4] != MAGIC {
        return Err(ProjectError::BadMagic);
    }
    let version = u32::from_le_bytes(header[4..8].try_into().unwrap());
    if !(MIN_READ_VERSION..=VERSION).contains(&version) {
        return Err(ProjectError::UnsupportedVersion(version));
    }
    // header[8..12] is `flags`; unknown flags are ignored today.
    let count = u32::from_le_bytes(header[12..16].try_into().unwrap()) as usize;
    if count as u64 * INDEX_ENTRY_LEN as u64 > len - (HEADER_LEN + CHECKSUM_LEN) as u64 {
        return Err(ProjectError::Corrupt(
            "section index is out of bounds".to_string(),
        ));
    }

    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let mut buf = [0u8; INDEX_ENTRY_LEN];
        reader.read_exact(&mut buf)?;
        entries.push(SectionEntry {
            offset: u64::from_le_bytes(buf[0..8].try_into().unwrap()),
            length: u64::from_le_bytes(buf[8..16].try_into().unwrap()),
            id: buf[16],
        });
    }

    let body_len = len - CHECKSUM_LEN as u64;
    for entry in &entries {
        if entry.offset > body_len || entry.length > body_len - entry.offset {
            return Err(ProjectError::Corrupt(
                "a section lies outside the file".to_string(),
            ));
        }
    }

    verify_checksum(reader, len)?;

    let mut sections = Sections {
        version,
        ..Sections::default()
    };

    for entry in &entries {
        match entry.id {
            SECTION_META => sections.meta = Some(read_section(reader, entry)?),
            SECTION_SOURCE => sections.source = Some(read_section(reader, entry)?),
            SECTION_DATA => {
                let data = read_data(reader, entry)?;
                sections.pcm = if data.samples.is_empty() {
                    None
                } else {
                    Some(data)
                };
            }
            SECTION_SETUP => sections.setup = Some(read_section(reader, entry)?),
            SECTION_LAYOUT => sections.layout = from_json(reader, entry)?,
            SECTION_RESULTS => sections.results = Some(read_section(reader, entry)?),
            SECTION_ANNOTATIONS => sections.annotations = Some(read_section(reader, entry)?),
            SECTION_COMPARE => sections.compare = Some(read_section(reader, entry)?),
            // Forward compatibility: unknown sections are skipped.
            _ => {}
        }
    }

    // The payloads are decoded only after the migration chain has brought them up to
    // `VERSION` — an old file's struct shape is not today's (ADR-32).
    migrate::run(sections)
}

/// CRC-32 over everything before the trailing 8-byte checksum.
fn verify_checksum<R: Read + Seek>(reader: &mut R, len: u64) -> Result<(), ProjectError> {
    let body_len = len - CHECKSUM_LEN as u64;
    reader.seek(SeekFrom::Start(0))?;
    let mut crc = Crc32::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut remaining = body_len;
    while remaining > 0 {
        let take = (remaining.min(buffer.len() as u64)) as usize;
        reader.read_exact(&mut buffer[..take])?;
        crc.update(&buffer[..take]);
        remaining -= take as u64;
    }

    reader.seek(SeekFrom::Start(body_len))?;
    let mut stored = [0u8; CHECKSUM_LEN];
    reader.read_exact(&mut stored)?;
    if u64::from_le_bytes(stored) != u64::from(crc.finish()) {
        return Err(ProjectError::Corrupt("checksum mismatch".to_string()));
    }
    Ok(())
}

/// The `COMPARE` section, tolerating a file written before `referencePath` existed.
///
/// This is **in-version** tolerance (both payloads are version 1), not a migration: an old
/// build omitted a trailing field, so the reader retries with the shorter snapshot type.
pub(crate) fn compare_from_bytes(bytes: &[u8]) -> Result<Vec<SavedComparison>, ProjectError> {
    if let Ok(current) = postcard::from_bytes::<Vec<SavedComparison>>(bytes) {
        return Ok(current);
    }
    postcard::from_bytes::<Vec<SavedComparisonV1>>(bytes)
        .map(|old| old.into_iter().map(SavedComparison::from).collect())
        .map_err(|err| ProjectError::Corrupt(format!("postcard: {err}")))
}

/// Read one section's payload bytes into memory.
fn read_section<R: Read + Seek>(
    reader: &mut R,
    entry: &SectionEntry,
) -> Result<Vec<u8>, ProjectError> {
    let length = usize::try_from(entry.length)
        .map_err(|_| ProjectError::Corrupt("a section is too large".to_string()))?;
    let mut bytes = vec![0u8; length];
    reader.seek(SeekFrom::Start(entry.offset))?;
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn from_json<R: Read + Seek>(
    reader: &mut R,
    entry: &SectionEntry,
) -> Result<serde_json::Value, ProjectError> {
    let bytes = read_section(reader, entry)?;
    serde_json::from_slice(&bytes).map_err(|err| ProjectError::Corrupt(format!("layout: {err}")))
}

/// Parse the `DATA` section via its trailing chunk index.
///
/// Every allocation is validated against the section's actual length **before** it is
/// made, with checked arithmetic: a crafted header with a valid checksum (a huge frame
/// count, an index that runs past the section, a chunk extent that overflows) is a
/// `Corrupt` error, never an oversized allocation or an overflow panic (audit P1 #3).
fn read_data<R: Read + Seek>(
    reader: &mut R,
    entry: &SectionEntry,
) -> Result<SourceData, ProjectError> {
    if entry.length < DATA_HEADER_LEN + DATA_FOOTER_LEN {
        return Err(ProjectError::Corrupt(
            "DATA section is too small".to_string(),
        ));
    }
    let start = entry.offset;

    reader.seek(SeekFrom::Start(start))?;
    let mut header = [0u8; DATA_HEADER_LEN as usize];
    reader.read_exact(&mut header)?;
    let sample_rate = u32::from_le_bytes(header[0..4].try_into().unwrap());
    let channels = u16::from_le_bytes(header[4..6].try_into().unwrap()).max(1);
    if header[6] != PCM_FORMAT_F32 {
        return Err(ProjectError::Corrupt(format!(
            "unsupported PCM format {}",
            header[6]
        )));
    }
    let frames = u64::from_le_bytes(header[8..16].try_into().unwrap());
    let declared_chunks = u32::from_le_bytes(header[20..24].try_into().unwrap());

    reader.seek(SeekFrom::Start(start + entry.length - DATA_FOOTER_LEN))?;
    let mut footer = [0u8; DATA_FOOTER_LEN as usize];
    reader.read_exact(&mut footer)?;
    let chunk_count = u64::from_le_bytes(footer[0..8].try_into().unwrap());
    let index_offset = u64::from_le_bytes(footer[8..16].try_into().unwrap());

    if chunk_count != u64::from(declared_chunks) {
        return Err(ProjectError::Corrupt(
            "DATA chunk count mismatch".to_string(),
        ));
    }
    // The chunks and the index live between the header and the footer.
    let payload_end = entry.length - DATA_FOOTER_LEN;
    let index_bytes = chunk_count
        .checked_mul(DATA_INDEX_ENTRY_LEN)
        .ok_or_else(|| ProjectError::Corrupt("DATA index is out of bounds".to_string()))?;
    let index_end = index_offset
        .checked_add(index_bytes)
        .ok_or_else(|| ProjectError::Corrupt("DATA index is out of bounds".to_string()))?;
    if index_offset < DATA_HEADER_LEN || index_end > payload_end {
        return Err(ProjectError::Corrupt(
            "DATA index offset is out of bounds".to_string(),
        ));
    }

    // The declared sample count must fit the space before the index, so a malformed
    // header cannot make the reader reserve more than the section actually holds.
    let sample_count = frames
        .checked_mul(u64::from(channels))
        .ok_or_else(|| ProjectError::Corrupt("DATA sample count overflows".to_string()))?;
    let sample_bytes = sample_count
        .checked_mul(4)
        .ok_or_else(|| ProjectError::Corrupt("DATA sample bytes overflow".to_string()))?;
    if sample_bytes > index_offset - DATA_HEADER_LEN {
        return Err(ProjectError::Corrupt(
            "DATA declares more samples than the section holds".to_string(),
        ));
    }

    let chunk_count = usize::try_from(chunk_count)
        .map_err(|_| ProjectError::Corrupt("DATA has too many chunks".to_string()))?;
    let mut index = vec![
        0u8;
        usize::try_from(index_bytes).map_err(|_| ProjectError::Corrupt(
            "DATA index is too large".to_string()
        ))?
    ];
    reader.seek(SeekFrom::Start(start + index_offset))?;
    reader.read_exact(&mut index)?;

    let capacity = usize::try_from(sample_count)
        .map_err(|_| ProjectError::Corrupt("DATA is too large for this platform".to_string()))?;
    let mut samples = Vec::with_capacity(capacity);
    let mut buffer: Vec<u8> = Vec::new();
    for i in 0..chunk_count {
        let base = i * DATA_INDEX_ENTRY_LEN as usize;
        let offset = u64::from_le_bytes(index[base..base + 8].try_into().unwrap());
        let length = u64::from_le_bytes(index[base + 8..base + 16].try_into().unwrap());
        let end = offset
            .checked_add(length)
            .ok_or_else(|| ProjectError::Corrupt("DATA chunk is out of bounds".to_string()))?;
        // Chunks must end before the index (never inside it or the footer).
        if length % 4 != 0 || offset < DATA_HEADER_LEN || end > index_offset {
            return Err(ProjectError::Corrupt(
                "DATA chunk is out of bounds".to_string(),
            ));
        }
        buffer.resize(
            usize::try_from(length)
                .map_err(|_| ProjectError::Corrupt("DATA chunk is too large".to_string()))?,
            0,
        );
        reader.seek(SeekFrom::Start(start + offset))?;
        reader.read_exact(&mut buffer)?;
        let (chunks, _) = buffer.as_chunks::<4>();
        for sample in chunks {
            samples.push(f32::from_le_bytes(*sample));
        }
    }

    Ok(SourceData {
        samples,
        sample_rate,
        channels,
    })
}
