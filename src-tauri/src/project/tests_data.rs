//! `DATA` loader/writer tests: the sample formats (`f32` / `i16`, D-20) and the
//! malformed-section cases (audit P1 #3), where a file with a valid checksum but an
//! inconsistent `DATA` header/index must be rejected before any allocation.

use std::io::Cursor;

use super::test_support::save_with;
use super::*;
use crate::state::SourceData;

fn pcm(samples: usize) -> SourceData {
    let values: Vec<f32> = (0..samples).map(|i| (i as f32 * 0.001).sin()).collect();
    SourceData {
        samples: values,
        sample_rate: 48_000,
        channels: 2,
    }
}

/// A stereo buffer whose amplitudes stay inside ±0.5, so a `× 32767` quantize and a
/// `÷ 32768` decode round-trip inside one `i16` step.
fn quiet_pcm(frames: usize) -> SourceData {
    let mut samples = Vec::with_capacity(frames * 2);
    for frame in 0..frames {
        let t = frame as f32 * 0.01;
        samples.push(0.5 * t.sin());
        samples.push(0.5 * (t * 1.7).cos());
    }
    SourceData {
        samples,
        sample_rate: 44_100,
        channels: 2,
    }
}

/// A valid project holding `audio` as `format`, ready to be tampered with.
fn project_bytes_with_format(audio: &SourceData, format: PcmFormat) -> Vec<u8> {
    let save = save_with("tamper", Some(audio));
    let mut cursor = Cursor::new(Vec::new());
    write_project_with_pcm_format(&mut cursor, &save, 5, format).expect("write");
    cursor.into_inner()
}

/// A valid project with `samples` of `f32` audio, ready to be tampered with.
fn project_bytes(samples: usize) -> Vec<u8> {
    project_bytes_with_format(&pcm(samples), PcmFormat::F32)
}

// --- `DATA` sample formats (D-20) -------------------------------------------

/// One `i16` decode step. The bound lets the `× 32767` / `÷ 32768` scale mismatch add
/// its share on top of the rounding, hence the 1 % margin.
const I16_STEP: f32 = 1.01 / 32768.0;

#[test]
fn an_i16_section_round_trips_within_one_quantization_step() {
    let audio = quiet_pcm(64);
    let bytes = project_bytes_with_format(&audio, PcmFormat::I16);
    let loaded = read_project(&mut Cursor::new(bytes)).expect("read");
    let decoded = loaded.pcm.expect("pcm");
    assert_eq!(decoded.sample_rate, audio.sample_rate);
    assert_eq!(decoded.channels, audio.channels);
    assert_eq!(decoded.samples.len(), audio.samples.len());
    for (read, original) in decoded.samples.iter().zip(&audio.samples) {
        assert!(
            (read - original).abs() <= I16_STEP,
            "{read} is more than one i16 step from {original}"
        );
    }
}

#[test]
fn an_i16_section_records_format_one_with_byte_width_two() {
    let audio = quiet_pcm(64);
    let bytes = project_bytes_with_format(&audio, PcmFormat::I16);
    let (offset, length) = data_section(&bytes);
    assert_eq!(bytes[offset + 6], PCM_FORMAT_I16, "the format byte is i16");
    // Chunks stay counted in samples, so only the samples halve: the section is the
    // header, one chunk of 2-byte samples, one index entry and the footer.
    let expected = DATA_HEADER_LEN
        + audio.samples.len() as u64 * PcmFormat::I16.byte_width()
        + DATA_INDEX_ENTRY_LEN
        + DATA_FOOTER_LEN;
    assert_eq!(length as u64, expected);
    // The section index and the checksum still validate around the narrower payload.
    read_project(&mut Cursor::new(bytes)).expect("the container round-trips");
}

#[test]
fn an_f32_section_matches_the_default_writer_exactly() {
    let audio = quiet_pcm(64);
    let explicit = project_bytes_with_format(&audio, PcmFormat::F32);

    let save = save_with("tamper", Some(&audio));
    let mut cursor = Cursor::new(Vec::new());
    write_project(&mut cursor, &save, 5).expect("write");
    assert_eq!(cursor.into_inner(), explicit, "f32 writing is unchanged");

    let (offset, _) = data_section(&explicit);
    assert_eq!(explicit[offset + 6], PCM_FORMAT_F32);
    let loaded = read_project(&mut Cursor::new(explicit)).expect("read");
    assert_eq!(loaded.pcm.expect("pcm").samples, audio.samples);
}

#[test]
fn rejects_an_unknown_pcm_format_byte() {
    let ProjectError::Corrupt(message) = corrupt_after(project_bytes(64), |data| data[6] = 2)
    else {
        panic!("an unknown DATA format must be corrupt");
    };
    assert!(message.contains("unsupported PCM format"), "{message}");
}

#[test]
fn rejects_an_i16_header_declaring_more_frames_than_the_section_holds() {
    let audio = quiet_pcm(64);
    let err = corrupt_after(project_bytes_with_format(&audio, PcmFormat::I16), |data| {
        // The payload holds 256 bytes; 128 frames over 2 channels is 512 bytes at i16.
        data[8..16].copy_from_slice(&128u64.to_le_bytes());
    });
    assert!(matches!(err, ProjectError::Corrupt(_)), "{err:?}");
}

#[test]
fn rejects_an_i16_chunk_that_is_not_whole_samples() {
    let audio = quiet_pcm(64);
    let err = corrupt_after(project_bytes_with_format(&audio, PcmFormat::I16), |data| {
        let footer = data.len() - DATA_FOOTER_LEN as usize;
        let index = u64::from_le_bytes(data[footer + 8..footer + 16].try_into().unwrap()) as usize;
        // An odd byte length cannot hold whole i16 samples.
        data[index + 8..index + 16].copy_from_slice(&3u64.to_le_bytes());
    });
    assert!(matches!(err, ProjectError::Corrupt(_)), "{err:?}");
}

// --- malformed `DATA` metadata (audit P1 #3) ---------------------------------

/// Recompute the trailing checksum after a test tampers with the body, so the loader
/// gets past the integrity check and reaches the `DATA` bounds checks.
fn rewrite_checksum(bytes: &mut [u8]) {
    let body_len = bytes.len() - CHECKSUM_LEN;
    let mut crc = Crc32::new();
    crc.update(&bytes[..body_len]);
    bytes[body_len..].copy_from_slice(&u64::from(crc.finish()).to_le_bytes());
}

/// The `DATA` section's (offset, length), read from the section index.
fn data_section(bytes: &[u8]) -> (usize, usize) {
    let mut offset = HEADER_LEN;
    for _ in 0..4 {
        let section_offset =
            u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap()) as usize;
        let length =
            u64::from_le_bytes(bytes[offset + 8..offset + 16].try_into().unwrap()) as usize;
        if bytes[offset + 16] == SECTION_DATA {
            return (section_offset, length);
        }
        offset += INDEX_ENTRY_LEN;
    }
    panic!("the project has no DATA section");
}

fn corrupt_after<F: FnOnce(&mut [u8])>(mut bytes: Vec<u8>, edit: F) -> ProjectError {
    let (offset, length) = data_section(&bytes);
    edit(&mut bytes[offset..offset + length]);
    rewrite_checksum(&mut bytes);
    match read_project(&mut Cursor::new(bytes)) {
        Ok(_) => panic!("a malformed DATA header must be rejected"),
        Err(err) => err,
    }
}

#[test]
fn rejects_a_data_header_declaring_more_samples_than_the_section_holds() {
    let err = corrupt_after(project_bytes(64), |data| {
        // A frame count far larger than the chunk data could ever hold.
        data[8..16].copy_from_slice(&u64::MAX.to_le_bytes());
    });
    assert!(matches!(err, ProjectError::Corrupt(_)), "{err:?}");
}

#[test]
fn rejects_a_data_chunk_count_that_cannot_fit_the_section() {
    let err = corrupt_after(project_bytes(64), |data| {
        // The header's chunk count and the footer's must agree; both claim 4 billion.
        let huge = u32::MAX.to_le_bytes();
        data[20..24].copy_from_slice(&huge);
        let footer = data.len() - DATA_FOOTER_LEN as usize;
        data[footer..footer + 8].copy_from_slice(&u64::from(u32::MAX).to_le_bytes());
    });
    assert!(matches!(err, ProjectError::Corrupt(_)), "{err:?}");
}

#[test]
fn rejects_a_chunk_extent_that_overflows() {
    let err = corrupt_after(project_bytes(64), |data| {
        let footer = data.len() - DATA_FOOTER_LEN as usize;
        let index_offset = u64::from_le_bytes(data[footer + 8..footer + 16].try_into().unwrap());
        let index = index_offset as usize;
        // A chunk length that overflows `offset + length`.
        data[index + 8..index + 16].copy_from_slice(&u64::MAX.to_le_bytes());
    });
    assert!(matches!(err, ProjectError::Corrupt(_)), "{err:?}");
}

#[test]
fn rejects_a_data_index_that_runs_past_the_section() {
    let err = corrupt_after(project_bytes(64), |data| {
        // Point the index at the footer (it must end before it).
        let footer = data.len() - DATA_FOOTER_LEN as usize;
        data[footer + 8..footer + 16].copy_from_slice(&(footer as u64).to_le_bytes());
    });
    assert!(matches!(err, ProjectError::Corrupt(_)), "{err:?}");
}

// --- atomic save (audit P1 #1) ----------------------------------------------

#[test]
fn an_atomic_save_replaces_the_previous_file() {
    let dir = std::env::temp_dir().join("hey_listen_atomic_ok");
    let _ = std::fs::remove_dir_all(&dir);
    let target = dir.join("project.heyl");
    let audio = pcm(64);
    write_project_atomic(&target, &save_with("first", Some(&audio)), 1).expect("first save");
    write_project_atomic(&target, &save_with("second", Some(&audio)), 2).expect("second save");

    let bytes = std::fs::read(&target).expect("read");
    let loaded = read_project(&mut Cursor::new(bytes)).expect("read back");
    assert_eq!(loaded.meta.name, "second");
    // No temporary sibling is left behind.
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .expect("list")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// A save that fails **before** the rename must leave the previous project intact: the
/// pre-fix GUI/headless writers opened the destination with `File::create`, so any
/// failure after truncation destroyed the last good file.
#[cfg(unix)]
#[test]
fn a_failed_atomic_save_keeps_the_previous_file() {
    use std::os::unix::fs::PermissionsExt;

    let dir = std::env::temp_dir().join("hey_listen_atomic_fail");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create dir");
    let target = dir.join("project.heyl");
    let audio = pcm(64);
    write_project_atomic(&target, &save_with("first", Some(&audio)), 1).expect("first save");
    let before = std::fs::read(&target).expect("read first");

    // The directory is read-only, so the sibling temp file cannot even be created.
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).expect("chmod");
    let failed = write_project_atomic(&target, &save_with("second", Some(&audio)), 2);
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).expect("chmod");

    assert!(failed.is_err(), "a read-only directory must fail the save");
    let after = std::fs::read(&target).expect("read after");
    assert_eq!(
        before, after,
        "the previous project must survive a failed save"
    );
    let loaded = read_project(&mut Cursor::new(after)).expect("the previous project still reads");
    assert_eq!(loaded.meta.name, "first");
    let _ = std::fs::remove_dir_all(&dir);
}

/// A writer that fails on the first byte reports the error instead of a partial success.
#[test]
fn a_failing_writer_reports_an_error() {
    let audio = pcm(16);
    let error = write_project(
        crate::test_support::FailingWriter,
        &save_with("fails", Some(&audio)),
        1,
    );
    assert!(error.is_err());
}
