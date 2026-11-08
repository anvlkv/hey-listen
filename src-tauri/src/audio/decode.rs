//! File decoding via `symphonia` (demux + decode).
//!
//! A file source is decoded to **interleaved `f32`** and handed out in fixed-size
//! chunks (see [`decode_file`]); the full sample data backs the timeline. This
//! module has no `tauri` dependency so it can be unit-tested and reused by the
//! analysis engine later.

use std::fs::File;
use std::path::Path;

use serde::Serialize;
use symphonia::core::codecs::audio::AudioCodecParameters;
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::default::{get_codecs, get_probe};

use super::STREAM_CHUNK_SAMPLES;

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
    #[error("the source was replaced before this file finished decoding")]
    Superseded,
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(DecodeError);

/// Metadata for a probed file source.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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

/// The container's audio track: the default one, else the first (some containers set no
/// default flag, and `default_track` can otherwise pick a non-audio track).
fn audio_track(
    format: &dyn symphonia::core::formats::FormatReader,
) -> Result<&symphonia::core::formats::Track, DecodeError> {
    format
        .default_track(TrackType::Audio)
        .or_else(|| format.first_track(TrackType::Audio))
        .ok_or(DecodeError::NoAudioTrack)
}

/// Build the audio decoder for the container's **current** audio track, returning the
/// decoder, the track id it decodes, and the codec parameters.
///
/// Used both at the start of [`decode_file`] and again after a chained-stream reset, when
/// the container's track list has changed.
fn open_audio_decoder(
    format: &dyn symphonia::core::formats::FormatReader,
) -> Result<(Box<dyn AudioDecoder>, u32, AudioCodecParameters), DecodeError> {
    let track = audio_track(format)?;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or(DecodeError::NoAudioTrack)?;
    let decoder = get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .map_err(|_| DecodeError::UnsupportedCodec)?;
    Ok((decoder, track.id, params.clone()))
}

/// Inspect a file's container/codec metadata without decoding it.
pub fn probe(path: &str) -> Result<ProbeInfo, DecodeError> {
    let format = open_format(path)?;

    let track = audio_track(format.as_ref())?;
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

    let (mut decoder, mut track_id, track_params) = open_audio_decoder(format.as_ref())?;

    let mut sample_rate = track_params.sample_rate.unwrap_or(0);
    let mut channels = track_params
        .channels
        .as_ref()
        .map(|c| c.count())
        .unwrap_or(0) as u16;

    // Reused per-packet scratch buffer for the decoded interleaved samples.
    let mut interleaved: Vec<f32> = Vec::new();
    // Accumulates samples until a full chunk is ready to hand off.
    let mut pending: Vec<f32> = Vec::with_capacity(STREAM_CHUNK_SAMPLES * 2);
    let mut frames_total: u64 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break, // end of stream
            Err(SymphoniaError::ResetRequired) => {
                // A chained stream (e.g. a second Ogg logical stream) changed the track
                // list. Rebuild the decoder for the updated list and keep going; a stream
                // we cannot decode is an explicit error, never silent truncation
                // (audit P2 #5).
                let (next, id, params) = open_audio_decoder(format.as_ref())?;
                decoder = next;
                track_id = id;
                // A chained stream may change the rate / channel count; the decoded
                // buffers update these anyway, but keep the defaults in step.
                sample_rate = params.sample_rate.unwrap_or(sample_rate);
                channels = params
                    .channels
                    .as_ref()
                    .map(|c| c.count() as u16)
                    .unwrap_or(channels);
                continue;
            }
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
                while pending.len() >= STREAM_CHUNK_SAMPLES {
                    on_chunk(&pending[..STREAM_CHUNK_SAMPLES])?;
                    pending.drain(..STREAM_CHUNK_SAMPLES);
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

    mod wav {
        include!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/support/wav.rs"));
    }
    use wav::write_sine_wav_channels;

    const RATE: u32 = 8_000;
    const FRAMES: usize = 4_000;

    /// Write half a second of a mono sine as Ogg/Vorbis (a complete logical stream).
    ///
    /// oxiaudio's Vorbis encoder accepts only 44.1 / 48 kHz.
    fn write_vorbis(path: &Path, hz: f32) {
        use oxiaudio::{AudioBuffer, ChannelLayout, SampleFormat};
        const OGG_RATE: u32 = 44_100;
        let samples: Vec<f32> = (0..OGG_RATE / 2)
            .map(|i| (std::f32::consts::TAU * hz * i as f32 / OGG_RATE as f32).sin() * 0.5)
            .collect();
        let buffer = AudioBuffer {
            samples,
            sample_rate: OGG_RATE,
            channels: ChannelLayout::Mono,
            format: SampleFormat::F32,
        };
        oxiaudio::encode_vorbis_file(&buffer, path).expect("encode vorbis");
    }

    /// A chained Ogg stream (two complete logical streams back to back) must decode
    /// **both** streams. The pre-fix reader treated the container's `ResetRequired` as
    /// end-of-audio, so everything after the first stream vanished without an error
    /// (audit P2 #5).
    #[test]
    fn decodes_a_chained_ogg_stream() {
        let dir = std::env::temp_dir();
        let first = dir.join("hey_listen_chain_a.ogg");
        let second = dir.join("hey_listen_chain_b.ogg");
        let chained = dir.join("hey_listen_chained.ogg");
        write_vorbis(&first, 440.0);
        write_vorbis(&second, 660.0);
        let mut bytes = std::fs::read(&first).expect("read first");
        bytes.extend_from_slice(&std::fs::read(&second).expect("read second"));
        std::fs::write(&chained, bytes).expect("write chained");

        let once = decode_file(first.to_str().unwrap(), |_| Ok(())).expect("first stream");
        let twice = decode_file(chained.to_str().unwrap(), |_| Ok(())).expect("chained");
        assert!(once.frames > 0, "the first stream decoded nothing");
        assert!(
            twice.frames > once.frames,
            "the second logical stream was dropped ({} frames vs {})",
            twice.frames,
            once.frames
        );
        assert!(
            twice.frames >= once.frames * 3 / 2,
            "only part of the chained stream decoded ({} frames vs {})",
            twice.frames,
            once.frames
        );

        let _ = std::fs::remove_file(&first);
        let _ = std::fs::remove_file(&second);
        let _ = std::fs::remove_file(&chained);
    }

    #[test]
    fn probe_and_decode_wav() {
        let path = std::env::temp_dir().join("hey_listen_decode_test.wav");
        write_sine_wav_channels(&path, RATE, FRAMES, 1);
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
        write_sine_wav_channels(&path, RATE, FRAMES, 2);
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
