//! Project file writer — see `docs/project-file-format.md`.
//!
//! Section offsets are computed up front (the `DATA` length is analytic), so the
//! file is written in one forward pass while a CRC-32 is accumulated over every
//! byte; the checksum is appended last.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use super::error::ProjectError;
use super::read::LoadedProject;
use super::sections::{AnalysisSetup, Annotation, Meta, SourceDescriptor, StoredResult};
use super::{
    Crc32, DATA_CHUNK_SAMPLES, DATA_FOOTER_LEN, DATA_HEADER_LEN, DATA_INDEX_ENTRY_LEN, FLAGS,
    HEADER_LEN, INDEX_ENTRY_LEN, MAGIC, PCM_FORMAT_F32, SECTION_ANNOTATIONS, SECTION_COMPARE,
    SECTION_DATA, SECTION_LAYOUT, SECTION_META, SECTION_RESULTS, SECTION_SETUP, SECTION_SOURCE,
    VERSION,
};
use crate::audio::analysis::compare::SavedComparison;
use crate::state::SourceData;

/// Everything a save needs: the frontend-supplied setup + layout, plus the
/// core-owned source PCM that becomes the `DATA` section. `META`'s timestamps and
/// version fields are filled in by [`write_project`].
pub struct SaveProject<'a> {
    pub name: String,
    /// Preserve the original creation time when re-saving; `None` means "now".
    pub created_ms: Option<u64>,
    pub source: Option<SourceDescriptor>,
    pub setup: AnalysisSetup,
    pub layout: serde_json::Value,
    pub results: Vec<StoredResult>,
    /// The project's annotations (M14).
    pub annotations: Vec<Annotation>,
    /// Saved comparison snapshots, one per comparison open at save time (M25.C).
    pub compare: Vec<SavedComparison>,
    pub pcm: Option<&'a SourceData>,
}

impl<'a> SaveProject<'a> {
    /// Write a **loaded** project back unchanged: the GUI's save, the CLI's in-place
    /// editors and `migrate` all reuse it, so there is one description of what a project
    /// file carries (ADR-32). The source version's payloads are already migrated in memory.
    pub fn from_loaded(loaded: &'a LoadedProject) -> Self {
        Self {
            name: loaded.meta.name.clone(),
            created_ms: Some(loaded.meta.created_ms),
            source: loaded.source.clone(),
            setup: loaded.setup.clone(),
            layout: loaded.layout.clone(),
            results: loaded.results.clone(),
            annotations: loaded.annotations.clone(),
            compare: loaded.compare.clone(),
            pcm: loaded.pcm.as_ref(),
        }
    }
}

/// Write a complete project file to `writer`. `now_ms` is the modification time
/// (passed in so callers and tests control it).
pub fn write_project<W: Write>(
    writer: W,
    save: &SaveProject,
    now_ms: u64,
) -> Result<(), ProjectError> {
    let meta = Meta {
        name: save.name.clone(),
        created_ms: save.created_ms.unwrap_or(now_ms),
        modified_ms: now_ms,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        format_version: VERSION,
    };

    let meta_bytes = postcard::to_stdvec(&meta).map_err(encode)?;
    let source_bytes = postcard::to_stdvec(&save.source).map_err(encode)?;
    let setup_bytes = postcard::to_stdvec(&save.setup).map_err(encode)?;
    let layout_bytes = serde_json::to_vec(&save.layout).map_err(encode)?;
    let results_bytes = postcard::to_stdvec(&save.results).map_err(encode)?;
    let annotations_bytes = postcard::to_stdvec(&save.annotations).map_err(encode)?;
    let compare_bytes = postcard::to_stdvec(&save.compare).map_err(encode)?;

    // The section plan, in id order. `DATA`'s length is analytic.
    let plan = [
        (SECTION_META, meta_bytes.len() as u64),
        (SECTION_SOURCE, source_bytes.len() as u64),
        (SECTION_DATA, data_len(save.pcm)),
        (SECTION_SETUP, setup_bytes.len() as u64),
        (SECTION_LAYOUT, layout_bytes.len() as u64),
        (SECTION_RESULTS, results_bytes.len() as u64),
        (SECTION_ANNOTATIONS, annotations_bytes.len() as u64),
        (SECTION_COMPARE, compare_bytes.len() as u64),
    ];
    let count = plan.len() as u32;

    // Resolve each section's absolute file offset.
    let mut entries = Vec::with_capacity(plan.len());
    let mut offset = HEADER_LEN as u64 + u64::from(count) * INDEX_ENTRY_LEN as u64;
    for &(id, length) in &plan {
        entries.push((id, offset, length));
        offset += length;
    }

    let mut hashing = HashingWriter::new(writer);

    // Header.
    hashing.write_all(&MAGIC)?;
    hashing.write_all(&VERSION.to_le_bytes())?;
    hashing.write_all(&FLAGS.to_le_bytes())?;
    hashing.write_all(&count.to_le_bytes())?;

    // Section index.
    for &(id, offset, length) in &entries {
        hashing.write_all(&offset.to_le_bytes())?;
        hashing.write_all(&length.to_le_bytes())?;
        hashing.write_all(&[id])?;
        hashing.write_all(&[0u8; 7])?;
    }

    // Section payloads.
    hashing.write_all(&meta_bytes)?;
    hashing.write_all(&source_bytes)?;
    write_data(&mut hashing, save.pcm)?;
    hashing.write_all(&setup_bytes)?;
    hashing.write_all(&layout_bytes)?;
    hashing.write_all(&results_bytes)?;
    hashing.write_all(&annotations_bytes)?;
    hashing.write_all(&compare_bytes)?;

    // Trailing checksum, over everything written so far.
    let checksum = hashing.checksum();
    let mut inner = hashing.into_inner();
    inner.write_all(&u64::from(checksum).to_le_bytes())?;
    inner.flush()?;
    Ok(())
}

/// Write a project to `path` **atomically**: a sibling temporary file is written,
/// flushed and synced, then renamed over the destination. A failure before the rename
/// leaves the previous project untouched (audit P1 #1).
///
/// Every save surface (the GUI command, the headless MCP session and the CLI's
/// `project` / `annotations` writers) goes through here, so none of them can truncate a
/// good file and then fail. Parent directories are created first.
pub fn write_project_atomic(
    path: &Path,
    save: &SaveProject,
    now_ms: u64,
) -> Result<(), ProjectError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    let temp = temp_sibling(path);
    let written = write_temp(&temp, save, now_ms);
    if let Err(err) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(err);
    }
    if let Err(err) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::Io(err));
    }
    Ok(())
}

/// Write the complete project to `temp`, then flush and sync it to disk.
fn write_temp(temp: &Path, save: &SaveProject, now_ms: u64) -> Result<(), ProjectError> {
    let mut writer = io::BufWriter::new(std::fs::File::create(temp)?);
    write_project(&mut writer, save, now_ms)?;
    writer.flush()?;
    let file = writer.into_inner().map_err(|err| err.into_error())?;
    file.sync_all()?;
    Ok(())
}

/// A unique sibling temporary path (same directory, so the rename stays on one file
/// system). Two concurrent saves must not share it.
fn temp_sibling(path: &Path) -> PathBuf {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".to_string());
    let temp_name = format!(".{name}.{}.{seq}.tmp", std::process::id());
    path.with_file_name(temp_name)
}

/// The `DATA` section length for a source, computed without touching the samples.
fn data_len(pcm: Option<&SourceData>) -> u64 {
    let total = pcm.map(|p| p.samples.len()).unwrap_or(0);
    let chunk_samples = DATA_CHUNK_SAMPLES.max(1) as u64;
    let chunk_count = if total == 0 {
        0
    } else {
        (total as u64).div_ceil(chunk_samples)
    };
    DATA_HEADER_LEN + total as u64 * 4 + chunk_count * DATA_INDEX_ENTRY_LEN + DATA_FOOTER_LEN
}

/// Write the `DATA` section: header, interleaved `f32` chunks, trailing chunk
/// index, and a footer pointing at the index.
fn write_data<W: Write>(writer: &mut W, pcm: Option<&SourceData>) -> Result<(), ProjectError> {
    let samples: &[f32] = pcm.map(|p| p.samples.as_slice()).unwrap_or(&[]);
    let sample_rate = pcm.map(|p| p.sample_rate).unwrap_or(0);
    let channels = pcm.map(|p| p.channels.max(1)).unwrap_or(1);
    let channels_usize = channels as usize;

    let total = samples.len();
    let chunk_samples = DATA_CHUNK_SAMPLES.max(1);
    let chunk_count = if total == 0 {
        0
    } else {
        total.div_ceil(chunk_samples)
    };
    let frames = (total / channels_usize) as u64;

    // Self-describing header.
    writer.write_all(&sample_rate.to_le_bytes())?;
    writer.write_all(&channels.to_le_bytes())?;
    writer.write_all(&[PCM_FORMAT_F32])?;
    writer.write_all(&[0u8])?; // reserved
    writer.write_all(&frames.to_le_bytes())?;
    writer.write_all(&(chunk_samples as u32).to_le_bytes())?;
    writer.write_all(&(chunk_count as u32).to_le_bytes())?;

    // Chunks + the index built alongside them.
    let mut index = Vec::with_capacity(chunk_count * DATA_INDEX_ENTRY_LEN as usize);
    let mut bytes = Vec::with_capacity(chunk_samples * 4);
    let mut offset = DATA_HEADER_LEN;
    for chunk in samples.chunks(chunk_samples) {
        bytes.clear();
        for &sample in chunk {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        writer.write_all(&bytes)?;
        index.extend_from_slice(&offset.to_le_bytes());
        index.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        offset += bytes.len() as u64;
    }
    writer.write_all(&index)?;

    // Footer: chunk count + the index offset.
    writer.write_all(&(chunk_count as u64).to_le_bytes())?;
    writer.write_all(&offset.to_le_bytes())?;
    Ok(())
}

fn encode(err: impl std::fmt::Display) -> ProjectError {
    ProjectError::Encode(err.to_string())
}

/// A `Write` adapter that accumulates a CRC-32 over every byte written.
struct HashingWriter<W: Write> {
    inner: W,
    crc: Crc32,
}

impl<W: Write> HashingWriter<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            crc: Crc32::new(),
        }
    }

    fn checksum(&self) -> u32 {
        self.crc.finish()
    }

    fn into_inner(self) -> W {
        self.inner
    }
}

impl<W: Write> Write for HashingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let written = self.inner.write(buf)?;
        self.crc.update(&buf[..written]);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}
