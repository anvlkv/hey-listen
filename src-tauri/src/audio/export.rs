//! Audio export (M43): slice the analysis window from the project source, optionally
//! apply the filter graph, shape the channels, and encode a lossless file.
//!
//! This module owns the whole pipeline and has no `tauri` types, so it is unit-testable;
//! the IPC adapter lives in [`crate::commands::audio_export`]. Encoding is done with
//! `oxiaudio` (`symphonia` is decode-only).
//!
//! The export never touches the project: it reads a copy of the source window and never
//! changes the source, the filter switch, or the analysis window.

use std::io::BufWriter;
use std::path::Path;

use oxiaudio::{
    AiffBitDepth, AiffStreamEncoder, AudioBuffer, ChannelLayout, FlacBitDepth, FlacConfig,
    SampleFormat, WavBitDepth,
};
use serde::{Deserialize, Serialize};

use crate::audio::graph::{self, GraphSpec};
use crate::audio::pcm;
use crate::state::SourceData;

/// A lower-case string id enum shared by the export wire types: `serde`, `strum` and
/// `ts-rs` spell every variant the same way, so the IPC, the dialog and a future CLI
/// agree without a second table.
macro_rules! export_id_enum {
    (
        $(#[$meta:meta])*
        pub enum $name:ident {
            $($(#[$variant_meta:meta])* $variant:ident),* $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(
            Debug,
            Clone,
            Copy,
            PartialEq,
            Eq,
            Default,
            Serialize,
            Deserialize,
            strum::EnumString,
            strum::Display,
            strum::AsRefStr,
            strum::IntoStaticStr,
            strum::VariantNames,
            ts_rs::TS,
        )]
        #[serde(rename_all = "lowercase")]
        #[strum(serialize_all = "lowercase")]
        #[ts(export, rename_all = "lowercase")]
        pub enum $name {
            $($(#[$variant_meta])* $variant),*
        }
    };
}

export_id_enum! {
    /// A lossless container the first cut can write. Adding one is this enum plus its
    /// encoder branch and its dialog filter.
    pub enum AudioExportFormat {
        /// 32-bit float / integer PCM WAV.
        #[default]
        Wav,
        /// FLAC (`I16` / `I24` only).
        Flac,
        /// AIFF (`I16` / `I24` only).
        Aiff,
    }
}

impl AudioExportFormat {
    /// The file extension and the native dialog's filter name.
    pub fn extension(self) -> (&'static str, &'static str) {
        match self {
            Self::Wav => ("wav", "WAV audio"),
            Self::Flac => ("flac", "FLAC audio"),
            Self::Aiff => ("aiff", "AIFF audio"),
        }
    }
}

export_id_enum! {
    /// A sample depth. Integer depths clamp to full scale; float WAV is exact.
    pub enum AudioExportDepth {
        /// 32-bit IEEE float (WAV only).
        #[default]
        F32,
        /// 16-bit signed integer.
        I16,
        /// 24-bit signed integer.
        I24,
        /// 32-bit signed integer (WAV only).
        I32,
    }
}

impl AudioExportDepth {
    /// Whether the depth quantises to an integer type (so clipping is reported).
    fn is_integer(self) -> bool {
        !matches!(self, Self::F32)
    }

    /// Whether `format` can write this depth.
    fn supported_by(self, format: AudioExportFormat) -> bool {
        match format {
            AudioExportFormat::Wav => true,
            AudioExportFormat::Flac | AudioExportFormat::Aiff => {
                matches!(self, Self::I16 | Self::I24)
            }
        }
    }
}

export_id_enum! {
    /// How the exported file's channels are chosen.
    pub enum AudioExportChannels {
        /// Every source / graph output channel.
        #[default]
        All,
        /// The [`pcm::mixdown`] of every channel.
        Mono,
        /// One channel, chosen by [`AudioExportRequest::channel`].
        Single,
    }
}

/// One export request. The path is where the file is written.
#[derive(Debug, Clone)]
pub struct AudioExportRequest {
    pub path: String,
    pub start: f64,
    pub end: f64,
    pub format: AudioExportFormat,
    pub depth: AudioExportDepth,
    pub channels: AudioExportChannels,
    /// The 0-based channel for [`AudioExportChannels::Single`].
    pub channel: Option<usize>,
    /// Apply the composed filter graph (independent of the app's filter switch).
    pub apply_filter: bool,
    pub filter: Option<GraphSpec>,
}

/// The written file, with what the panel reports.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportedAudio {
    pub path: String,
    pub format: AudioExportFormat,
    pub depth: AudioExportDepth,
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u64,
    pub duration: f64,
    /// The largest absolute sample before encoding.
    pub peak: f32,
    /// Whether an integer depth had to clamp samples above full scale.
    pub clipping: bool,
}

/// Why an export could not run.
#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("no audio source is loaded")]
    NoSource,
    #[error("the export window is empty")]
    EmptyWindow,
    #[error(
        "{count} channels cannot be named by an export format — choose mono or a single channel"
    )]
    UnsupportedChannels { count: u16 },
    #[error("no channel was chosen for a single-channel export")]
    MissingChannel,
    #[error("channel {requested} is not a channel of this export")]
    ChannelOutOfRange { requested: usize },
    #[error("{format} cannot write {depth} samples")]
    UnsupportedDepth { format: String, depth: String },
    #[error("filter graph failed to apply: {0}")]
    Filter(String),
    #[error("could not write {path}: {err}")]
    Io { path: String, err: String },
    #[error("encoding failed: {0}")]
    Encode(String),
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(ExportError);

/// Export `window` of `source` to `request.path`.
pub fn export_source(
    source: Option<&SourceData>,
    request: &AudioExportRequest,
) -> Result<ExportedAudio, ExportError> {
    let source = source.ok_or(ExportError::NoSource)?;
    if !request.depth.supported_by(request.format) {
        return Err(ExportError::UnsupportedDepth {
            format: request.format.as_ref().to_string(),
            depth: request.depth.as_ref().to_string(),
        });
    }

    let rate = source.sample_rate.max(1);
    let (shaped, channels) = shape(source, request)?;
    let frames = shaped.len() / channels as usize;
    if frames == 0 {
        return Err(ExportError::EmptyWindow);
    }
    let layout =
        channel_layout(channels).ok_or(ExportError::UnsupportedChannels { count: channels })?;

    let peak = peak(&shaped);
    let clipping = request.depth.is_integer() && peak > 1.0;
    let buffer = AudioBuffer {
        samples: shaped,
        sample_rate: rate,
        channels: layout,
        format: SampleFormat::F32,
    };
    write(
        &buffer,
        request.format,
        request.depth,
        Path::new(&request.path),
    )?;

    Ok(ExportedAudio {
        path: request.path.clone(),
        format: request.format,
        depth: request.depth,
        sample_rate: rate,
        channels,
        frames: frames as u64,
        duration: frames as f64 / f64::from(rate),
        peak,
        clipping,
    })
}

/// Slice the window, apply the graph when asked, and pick the output channels.
fn shape(
    source: &SourceData,
    request: &AudioExportRequest,
) -> Result<(Vec<f32>, u16), ExportError> {
    let source_channels = source.channels.max(1) as usize;
    let rate = source.sample_rate.max(1);
    let frames = source.samples.len() / source_channels;
    let first = ((request.start.max(0.0) * f64::from(rate)).floor() as usize).min(frames);
    let last = ((request.end.max(0.0) * f64::from(rate)).ceil() as usize)
        .min(frames)
        .max(first);
    if last <= first {
        return Err(ExportError::EmptyWindow);
    }
    let region = &source.samples[first * source_channels..last * source_channels];

    // The graph reads the source channels its `input` nodes name and may declare several
    // output channels — the same lanes the Timeline draws and analysis picks from.
    let (interleaved, channels) = match request.filter.as_ref().filter(|_| request.apply_filter) {
        Some(spec) => graph::apply_channels(spec, region, source_channels, rate)
            .map_err(|err| ExportError::Filter(err.to_string()))?,
        None => (region.to_vec(), source_channels),
    };

    let channels = channels.max(1);
    match request.channels {
        AudioExportChannels::All => Ok((interleaved, channels as u16)),
        AudioExportChannels::Mono => Ok((pcm::mixdown(&interleaved, channels, None), 1)),
        AudioExportChannels::Single => {
            let pick = request.channel.ok_or(ExportError::MissingChannel)?;
            if pick >= channels {
                return Err(ExportError::ChannelOutOfRange { requested: pick });
            }
            Ok((select_channel(&interleaved, channels, pick), 1))
        }
    }
}

/// One interleaved lane, de-interleaved.
fn select_channel(interleaved: &[f32], channels: usize, pick: usize) -> Vec<f32> {
    interleaved
        .chunks(channels)
        .map(|frame| frame[pick])
        .collect()
}

/// The formats that can name `channels` explicitly — never `ChannelLayout::from`, which
/// silently reports stereo for other counts.
fn channel_layout(channels: u16) -> Option<ChannelLayout> {
    match channels {
        1 => Some(ChannelLayout::Mono),
        2 => Some(ChannelLayout::Stereo),
        4 => Some(ChannelLayout::Quad),
        6 => Some(ChannelLayout::Surround51),
        8 => Some(ChannelLayout::Surround71),
        _ => None,
    }
}

/// The largest absolute sample in the buffer.
fn peak(samples: &[f32]) -> f32 {
    samples
        .iter()
        .fold(0.0f32, |peak, sample| peak.max(sample.abs()))
}

/// Encode `buffer` to `path` in `format` at `depth`.
fn write(
    buffer: &AudioBuffer<f32>,
    format: AudioExportFormat,
    depth: AudioExportDepth,
    path: &Path,
) -> Result<(), ExportError> {
    let failed = |err: oxiaudio::OxiAudioError| ExportError::Encode(err.to_string());
    match format {
        AudioExportFormat::Wav => {
            let bit_depth = match depth {
                AudioExportDepth::F32 => WavBitDepth::F32,
                AudioExportDepth::I16 => WavBitDepth::I16,
                AudioExportDepth::I24 => WavBitDepth::I24,
                AudioExportDepth::I32 => WavBitDepth::I32,
            };
            oxiaudio::encode_wav_with_config(buffer, path, bit_depth).map_err(failed)
        }
        AudioExportFormat::Flac => {
            let config = FlacConfig {
                compression: 5,
                bit_depth: match depth {
                    AudioExportDepth::I24 => FlacBitDepth::I24,
                    _ => FlacBitDepth::I16,
                },
            };
            oxiaudio::encode_flac_with_config(buffer, path, &config).map_err(failed)
        }
        AudioExportFormat::Aiff => {
            let file = std::fs::File::create(path).map_err(|err| ExportError::Io {
                path: path.to_string_lossy().into_owned(),
                err: err.to_string(),
            })?;
            let mut encoder = AiffStreamEncoder::new(
                BufWriter::new(file),
                buffer.sample_rate,
                buffer.channels,
                match depth {
                    AudioExportDepth::I24 => AiffBitDepth::I24,
                    _ => AiffBitDepth::I16,
                },
            )
            .map_err(failed)?;
            encoder.encode_chunk(buffer).map_err(failed)?;
            encoder.finalize().map_err(failed)
        }
    }
}

#[cfg(test)]
mod tests;
