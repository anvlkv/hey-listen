//! The per-family delta shapes (M25; thinning in the follow-up fixes).
//!
//! Split from [`super`] to keep each file inside the source-size budget. The shapes are
//! plain serializable records; [`super::ComparisonDiff`] owns the family dispatch and
//! the `maxPoints` thinning entry point.

use serde::Serialize;

use crate::audio::analysis::shape::indices;

use super::super::stats::{DeltaHeader, DeltaStats};

/// A series delta over the matched frames in the common span.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub stats: DeltaStats,
    /// Matched frame times on the relative axis (A's frame times).
    pub times: Vec<f32>,
    /// `B − A` per matched frame (`null` where either side is a gap).
    pub values: Vec<Option<f32>>,
    pub a: Vec<Option<f32>>,
    pub b: Vec<Option<f32>>,
}

impl SeriesDelta {
    /// Thin every parallel array by the same evenly spaced indices.
    pub(crate) fn thin(&mut self, max: usize) {
        if self.times.len() <= max {
            return;
        }
        let keep = indices(self.times.len(), max);
        self.times = keep.iter().map(|&index| self.times[index]).collect();
        self.values = keep.iter().map(|&index| self.values[index]).collect();
        self.a = keep.iter().map(|&index| self.a[index]).collect();
        self.b = keep.iter().map(|&index| self.b[index]).collect();
    }
}

/// A spectrum delta, one value per shared bin.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub stats: DeltaStats,
    /// Bin centre frequencies (Hz), shared by both sides.
    pub freqs: Vec<f32>,
    /// `B − A` per bin, in dB.
    pub values: Vec<f32>,
}

/// A frame × band delta over the matched frames in the common span.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub stats: DeltaStats,
    /// Frame times on the relative axis (A's frame times).
    pub times: Vec<f32>,
    /// One flag per column: `false` means A has a frame there but B has no counterpart
    /// within tolerance, so the column is a **null** column (M25.B).
    pub columns: Vec<bool>,
    pub bins: usize,
    /// Frame-major `frames × bins` delta (`0` in a null column; ignored by the stats).
    pub values: Vec<f32>,
}

impl MatrixDelta {
    /// Thin by whole frames, keeping `times`, `columns` and `values` in step.
    pub(crate) fn thin(&mut self, max: usize) {
        let frames = self.times.len();
        if self.bins == 0 || frames <= max || self.values.len() != frames * self.bins {
            return;
        }
        let stride = frames.div_ceil(max);
        let keep: Vec<usize> = (0..frames).step_by(stride).collect();
        self.times = keep.iter().map(|&frame| self.times[frame]).collect();
        self.columns = keep.iter().map(|&frame| self.columns[frame]).collect();
        let mut values = Vec::with_capacity(keep.len() * self.bins);
        for &frame in &keep {
            let start = frame * self.bins;
            values.extend_from_slice(&self.values[start..start + self.bins]);
        }
        self.values = values;
    }
}

/// A modulation-spectrum delta, aligned by modulation-rate bin.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModulationDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    /// The shared modulation-rate axis (Hz).
    pub rate_hz: Vec<f32>,
    pub am: LineDelta,
    pub fm: LineDelta,
}

/// One modulation line's per-bin delta.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineDelta {
    pub stats: DeltaStats,
    /// `B − A` per rate bin; empty when one side has no spectrum.
    pub values: Vec<f32>,
}

/// A waveform envelope delta over the common span (M25.B).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    /// Buckets present in `times` / `values` (A's bucket times sampled against B).
    pub buckets: usize,
    /// The original bucket count when `maxPoints` thinned the arrays (provenance,
    /// mirroring `sourceFrames` on a decimated result).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_buckets: Option<usize>,
    /// The sampled bucket times on the relative axis.
    pub times: Vec<f32>,
    /// `B − A` per sampled bucket of the upper envelope.
    pub values: Vec<f32>,
}

impl WaveformDelta {
    /// Thin `times` and `values` together; `buckets` follows the kept array.
    pub(crate) fn thin(&mut self, max: usize) {
        if self.times.len() <= max {
            return;
        }
        let keep = indices(self.times.len(), max);
        self.source_buckets = Some(self.buckets);
        self.times = keep.iter().map(|&index| self.times[index]).collect();
        self.values = keep.iter().map(|&index| self.values[index]).collect();
        self.buckets = self.times.len();
    }
}

/// A scalar readout's field-by-field delta.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScalarDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub fields: Vec<FieldDelta>,
}

/// One numeric field of a scalar result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDelta {
    pub key: String,
    pub a: f64,
    pub b: f64,
    pub delta: f64,
}
