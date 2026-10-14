//! Project file reader — see `docs/project-file-format.md`.
//!
//! The reader verifies the header and the trailing checksum, then uses the section
//! index to read each payload. `DATA` is parsed via its own trailing chunk index,
//! so audio is read chunk-by-chunk and chunks can be seeked independently.

use std::io::{Read, Seek, SeekFrom};

use serde::de::DeserializeOwned;

use super::error::ProjectError;
use super::sections::{AnalysisSetup, Meta, Note, SourceDescriptor, StoredResult};
use super::{
    Crc32, CHECKSUM_LEN, DATA_FOOTER_LEN, DATA_HEADER_LEN, DATA_INDEX_ENTRY_LEN, HEADER_LEN,
    INDEX_ENTRY_LEN, MAGIC, PCM_FORMAT_F32, SECTION_DATA, SECTION_LAYOUT, SECTION_META,
    SECTION_NOTES, SECTION_RESULTS, SECTION_SETUP, SECTION_SOURCE, VERSION,
};
use crate::state::SourcePcm;

/// The parsed contents of a project file.
#[derive(Debug, Clone)]
pub struct LoadedProject {
    pub meta: Meta,
    pub source: Option<SourceDescriptor>,
    pub setup: AnalysisSetup,
    pub layout: serde_json::Value,
    pub results: Vec<StoredResult>,
    /// The project's notes (empty when the file has no `NOTES` section).
    pub notes: Vec<Note>,
    /// The embedded audio, if the file had a `DATA` section with samples.
    pub pcm: Option<SourcePcm>,
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
    if version != VERSION {
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

    let mut meta: Option<Meta> = None;
    let mut source: Option<SourceDescriptor> = None;
    let mut setup: Option<AnalysisSetup> = None;
    let mut layout = serde_json::Value::Null;
    let mut results: Vec<StoredResult> = Vec::new();
    let mut notes: Vec<Note> = Vec::new();
    let mut pcm: Option<SourcePcm> = None;

    for entry in &entries {
        match entry.id {
            SECTION_META => meta = Some(from_postcard(reader, entry)?),
            SECTION_SOURCE => source = from_postcard::<Option<SourceDescriptor>, _>(reader, entry)?,
            SECTION_DATA => {
                let data = read_data(reader, entry)?;
                pcm = if data.samples.is_empty() {
                    None
                } else {
                    Some(data)
                };
            }
            SECTION_SETUP => setup = Some(from_postcard(reader, entry)?),
            SECTION_LAYOUT => layout = from_json(reader, entry)?,
            SECTION_RESULTS => results = from_postcard(reader, entry)?,
            SECTION_NOTES => notes = from_postcard(reader, entry)?,
            // Forward compatibility: unknown sections are skipped.
            _ => {}
        }
    }

    let meta = meta.ok_or_else(|| ProjectError::Corrupt("missing META section".to_string()))?;

    Ok(LoadedProject {
        meta,
        source,
        setup: setup.unwrap_or_default(),
        layout,
        results,
        notes,
        pcm,
    })
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

/// Read one section's payload bytes into memory.
fn read_section<R: Read + Seek>(
    reader: &mut R,
    entry: &SectionEntry,
) -> Result<Vec<u8>, ProjectError> {
    let mut bytes = vec![0u8; entry.length as usize];
    reader.seek(SeekFrom::Start(entry.offset))?;
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn from_postcard<T: DeserializeOwned, R: Read + Seek>(
    reader: &mut R,
    entry: &SectionEntry,
) -> Result<T, ProjectError> {
    let bytes = read_section(reader, entry)?;
    postcard::from_bytes(&bytes).map_err(|err| ProjectError::Corrupt(format!("postcard: {err}")))
}

fn from_json<R: Read + Seek>(
    reader: &mut R,
    entry: &SectionEntry,
) -> Result<serde_json::Value, ProjectError> {
    let bytes = read_section(reader, entry)?;
    serde_json::from_slice(&bytes).map_err(|err| ProjectError::Corrupt(format!("layout: {err}")))
}

/// Parse the `DATA` section via its trailing chunk index.
fn read_data<R: Read + Seek>(
    reader: &mut R,
    entry: &SectionEntry,
) -> Result<SourcePcm, ProjectError> {
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
    let declared_chunks = u32::from_le_bytes(header[20..24].try_into().unwrap()) as usize;

    reader.seek(SeekFrom::Start(start + entry.length - DATA_FOOTER_LEN))?;
    let mut footer = [0u8; DATA_FOOTER_LEN as usize];
    reader.read_exact(&mut footer)?;
    let chunk_count = u64::from_le_bytes(footer[0..8].try_into().unwrap()) as usize;
    let index_offset = u64::from_le_bytes(footer[8..16].try_into().unwrap());

    if chunk_count != declared_chunks {
        return Err(ProjectError::Corrupt(
            "DATA chunk count mismatch".to_string(),
        ));
    }
    if index_offset < DATA_HEADER_LEN || index_offset > entry.length - DATA_FOOTER_LEN {
        return Err(ProjectError::Corrupt(
            "DATA index offset is out of bounds".to_string(),
        ));
    }

    reader.seek(SeekFrom::Start(start + index_offset))?;
    let mut index = vec![0u8; chunk_count * DATA_INDEX_ENTRY_LEN as usize];
    reader.read_exact(&mut index)?;

    let mut samples = Vec::with_capacity(frames as usize * channels as usize);
    let mut buffer: Vec<u8> = Vec::new();
    for i in 0..chunk_count {
        let base = i * DATA_INDEX_ENTRY_LEN as usize;
        let offset = u64::from_le_bytes(index[base..base + 8].try_into().unwrap());
        let length = u64::from_le_bytes(index[base + 8..base + 16].try_into().unwrap());
        if length % 4 != 0
            || offset < DATA_HEADER_LEN
            || offset + length > entry.length - DATA_FOOTER_LEN
        {
            return Err(ProjectError::Corrupt(
                "DATA chunk is out of bounds".to_string(),
            ));
        }
        buffer.resize(length as usize, 0);
        reader.seek(SeekFrom::Start(start + offset))?;
        reader.read_exact(&mut buffer)?;
        let (chunks, _) = buffer.as_chunks::<4>();
        for sample in chunks {
            samples.push(f32::from_le_bytes(*sample));
        }
    }

    Ok(SourcePcm {
        samples,
        sample_rate,
        channels,
    })
}
