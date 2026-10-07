//! File decoding via `symphonia` (demux + decode).
//!
//! A file source is decoded to **interleaved `f32`** and handed out in fixed-size
//! chunks (see [`decode_file`]); the full sample data backs the timeline. This
//! module has no `tauri` dependency so it can be unit-tested and reused by the
//! analysis engine later.

use std::fs::File;
use std::path::Path;

use serde::Serialize;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::default::{get_codecs, get_probe};

/// Number of interleaved samples per streamed chunk (256 KiB at 4 bytes/sample).
/// Chosen to keep `Channel` messages amortized while bounding per-message latency.
const CHUNK_SAMPLES: usize = 64 * 1024;

/// Errors produced while probing or decoding a file source.
#[derive(Debug, thiserror::Error)]
pub enum DecodeError {
    #[error("could not open file: {0}")]
    Io(#[from] std::io::Error),
    #[error("unsupported or unrecognized audio format")]
    UnsupportedFormat,
    #[error("the file contains no audio track")]
    NoAudioTrack,
    #[error("unsupported audio codec")]
    UnsupportedCodec,
    #[error("the audio track does not declare a sample rate")]
    UnknownSampleRate,
    #[error("decode error: {0}")]
    Decode(String),
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
impl Serialize for DecodeError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Metadata for a probed file source.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    /// Absolute or user-supplied path the file was opened from.
    pub path: String,
    /// Base file name, for display.
    pub name: String,
    /// Codec identifier (e.g. `flac`, `mp3`).
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: Option<u32>,
    /// Playable frame count, when the container reports it.
    pub num_frames: Option<u64>,
    /// Duration in seconds, derived from `num_frames` when available.
    pub duration_secs: Option<f64>,
}

/// Summary returned once a file has been fully decoded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSummary {
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u64,
}

fn open_format(path: &str) -> Result<Box<dyn symphonia::core::formats::FormatReader>, DecodeError> {
    let file = File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|_| DecodeError::UnsupportedFormat)
}

/// Inspect a file's container/codec metadata without decoding it.
pub fn probe(path: &str) -> Result<ProbeInfo, DecodeError> {
    let format = open_format(path)?;

    // Prefer the default audio track; fall back to the first audio track (some
    // containers set no default flag, and `default_track` can otherwise pick a
    // non-audio track).
    let track = format
        .default_track(TrackType::Audio)
        .or_else(|| format.first_track(TrackType::Audio))
        .ok_or(DecodeError::NoAudioTrack)?;

    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or(DecodeError::NoAudioTrack)?;

    let sample_rate = params.sample_rate.ok_or(DecodeError::UnknownSampleRate)?;
    let channels = params
        .channels
        .as_ref()
        .map(|c| c.count() as u16)
        .ok_or(DecodeError::NoAudioTrack)?;

    Ok(ProbeInfo {
        path: path.to_string(),
        name: Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path)
            .to_string(),
        codec: params.codec.to_string(),
        sample_rate,
        channels,
        bits_per_sample: params.bits_per_sample,
        num_frames: track.num_frames,
        duration_secs: track.num_frames.map(|n| n as f64 / f64::from(sample_rate)),
    })
}

/// Decode a file to interleaved `f32`, invoking `on_chunk` with successive
/// slices of samples (each a multiple of the channel count).
///
/// Returns the exact sample rate, channel count, and frame count of the decoded
/// audio, which may differ slightly from [`probe`]'s estimate.
pub fn decode_file(
    path: &str,
    mut on_chunk: impl FnMut(&[f32]) -> Result<(), DecodeError>,
) -> Result<StreamSummary, DecodeError> {
    let mut format = open_format(path)?;

    let track = format
        .default_track(TrackType::Audio)
        .or_else(|| format.first_track(TrackType::Audio))
        .ok_or(DecodeError::NoAudioTrack)?;
    let track_id = track.id;
    let track_params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or(DecodeError::NoAudioTrack)?;

    let mut decoder = get_codecs()
        .make_audio_decoder(track_params, &AudioDecoderOptions::default())
        .map_err(|_| DecodeError::UnsupportedCodec)?;

    let mut sample_rate = track_params.sample_rate.unwrap_or(0);
    let mut channels = track_params
        .channels
        .as_ref()
        .map(|c| c.count())
        .unwrap_or(0) as u16;

    // Reused per-packet scratch buffer for the decoded interleaved samples.
    let mut interleaved: Vec<f32> = Vec::new();
    // Accumulates samples until a full chunk is ready to hand off.
    let mut pending: Vec<f32> = Vec::with_capacity(CHUNK_SAMPLES * 2);
    let mut frames_total: u64 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break, // end of stream
            Err(SymphoniaError::ResetRequired) => break,
            // Skip the offending packet and keep going.
            Err(SymphoniaError::IoError(_)) | Err(SymphoniaError::DecodeError(_)) => continue,
            Err(err) => return Err(DecodeError::Decode(err.to_string())),
        };

        // Ignore non-audio packets (e.g. video/cover art in a container).
        if packet.track_id != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = audio_buf.spec();
                sample_rate = spec.rate();
                channels = spec.channels().count() as u16;

                audio_buf.copy_to_vec_interleaved(&mut interleaved);
                frames_total += audio_buf.frames() as u64;

                pending.extend_from_slice(&interleaved);
                while pending.len() >= CHUNK_SAMPLES {
                    on_chunk(&pending[..CHUNK_SAMPLES])?;
                    pending.drain(..CHUNK_SAMPLES);
                }
            }
            Err(SymphoniaError::DecodeError(_)) | Err(SymphoniaError::IoError(_)) => continue,
            Err(err) => return Err(DecodeError::Decode(err.to_string())),
        }
    }

    if !pending.is_empty() {
        on_chunk(&pending)?;
    }

    Ok(StreamSummary {
        sample_rate,
        channels,
        frames: frames_total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 8_000;
    const FRAMES: usize = 4_000;

    /// Write a minimal 16-bit PCM mono WAV with a 440 Hz sine at half scale.
    fn write_sine_wav(path: &Path, channels: u16) {
        let bits = 16u16;
        let block_align = channels * bits / 8;
        let byte_rate = RATE * u32::from(block_align);
        let data_len = FRAMES as u32 * u32::from(block_align);

        let mut buf = Vec::new();
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&(36 + data_len).to_le_bytes());
        buf.extend_from_slice(b"WAVE");
        buf.extend_from_slice(b"fmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
        buf.extend_from_slice(&channels.to_le_bytes());
        buf.extend_from_slice(&RATE.to_le_bytes());
        buf.extend_from_slice(&byte_rate.to_le_bytes());
        buf.extend_from_slice(&block_align.to_le_bytes());
        buf.extend_from_slice(&bits.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_len.to_le_bytes());

        for f in 0..FRAMES {
            let t = f as f32 / RATE as f32;
            let sample = (t * 440.0 * std::f32::consts::TAU).sin() * 0.5;
            let value = (sample * f32::from(i16::MAX)) as i16;
            for _ in 0..channels {
                buf.extend_from_slice(&value.to_le_bytes());
            }
        }

        std::fs::write(path, buf).unwrap();
    }

    #[test]
    fn probe_and_decode_wav() {
        let path = std::env::temp_dir().join("hey_listen_decode_test.wav");
        write_sine_wav(&path, 1);
        let path_str = path.to_str().unwrap();

        let info = probe(path_str).expect("probe");
        assert_eq!(info.sample_rate, RATE);
        assert_eq!(info.channels, 1);
        if let Some(num_frames) = info.num_frames {
            assert_eq!(num_frames, FRAMES as u64);
        }

        let mut total = 0usize;
        let mut max_abs = 0f32;
        let summary = decode_file(path_str, |chunk| {
            total += chunk.len();
            for &sample in chunk {
                max_abs = max_abs.max(sample.abs());
            }
            Ok(())
        })
        .expect("decode");

        assert_eq!(summary.sample_rate, RATE);
        assert_eq!(summary.channels, 1);
        assert_eq!(summary.frames, FRAMES as u64);
        assert_eq!(total, FRAMES);
        assert!(
            (0.3..=0.51).contains(&max_abs),
            "expected half-scale sine, got max_abs = {max_abs}"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn decode_respects_channel_count() {
        let path = std::env::temp_dir().join("hey_listen_decode_test_stereo.wav");
        write_sine_wav(&path, 2);
        let path_str = path.to_str().unwrap();

        let mut total = 0usize;
        let summary = decode_file(path_str, |chunk| {
            total += chunk.len();
            Ok(())
        })
        .expect("decode");

        assert_eq!(summary.channels, 2);
        assert_eq!(summary.frames, FRAMES as u64);
        assert_eq!(total, FRAMES * 2);

        let _ = std::fs::remove_file(&path);
    }
}
