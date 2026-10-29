//! Comparability between two project sides (M25).
//!
//! Each side may legitimately have a different window, filter or settings, so a diff
//! is **explicit about what can be compared**: a *grid signature* decides whether a
//! numeric delta exists, the two windows' absolute-time intersection is the overlap a
//! delta runs over, and every differing setting is reported (never silently
//! normalised). See `docs/comparison.md` → "Comparability".

use serde::Serialize;
use serde_json::{json, Value};

use crate::audio::analysis::{AnalysisResult, SharedParams, WindowKind};
use crate::audio::analyzers::family_of;

/// A `start..end` span in source seconds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start: f64,
    pub end: f64,
}

impl Span {
    /// The absolute-time intersection of two windows, or `None` when they do not overlap.
    pub fn overlap(a: Span, b: Span) -> Option<Span> {
        let start = a.start.max(b.start);
        let end = a.end.min(b.end);
        (end > start).then_some(Span { start, end })
    }

    /// Whether a source-second instant lies in the (closed) span.
    pub fn contains(&self, secs: f32) -> bool {
        f64::from(secs) >= self.start && f64::from(secs) <= self.end
    }
}

/// One differing setting, with both values.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mismatch {
    pub key: String,
    pub a: Value,
    pub b: Value,
}

impl Mismatch {
    fn new(key: &str, a: Value, b: Value) -> Self {
        Self {
            key: key.to_string(),
            a,
            b,
        }
    }
}

/// Whether two results can be diffed numerically, and if not, why not.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparability {
    /// The grids match, so a delta is computed (and the overlap, if any, is non-empty).
    pub aligned: bool,
    /// The absolute-time intersection of the two windows; absent = no common time base.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlap: Option<Span>,
    /// Every differing grid-shaping setting, by key.
    pub mismatches: Vec<Mismatch>,
    /// Both sides are compared **as processed**; a differing filter is listed, not fixed.
    pub filters_differ: bool,
}

/// The grid a tool's result sits on, as far as a numeric delta is concerned.
///
/// Built from the setup + the produced result: the **analysis rate** (after
/// `resampleTo`), the channel, the frame grid (FFT / hop / window), the band, the
/// result's bin-axis length, and the tool options that change the grid.
struct Grid {
    rate: u32,
    channel: Option<usize>,
    fft_size: usize,
    window_fn: &'static str,
    band: (f64, f64),
    bins: Option<usize>,
    options: Vec<(&'static str, f64)>,
}

/// One side of a comparison, as the comparability check sees it.
pub struct Side<'a> {
    pub setup: &'a super::CompareSetup,
    pub result: &'a AnalysisResult,
    /// The effective analysis rate (the source rate, or `resampleTo`).
    pub rate: u32,
}

/// Compare two sides and report what a delta may assume.
///
/// `filters_differ` is computed by the caller (the filter lives in the core state, not
/// in the result).
pub fn comparability(
    tool: &str,
    a: &Side<'_>,
    b: &Side<'_>,
    filters_differ: bool,
) -> Comparability {
    let overlap = Span::overlap(a.setup.span(), b.setup.span());
    let grid_a = grid_of(tool, a);
    let grid_b = grid_of(tool, b);
    let mut mismatches = Vec::new();

    if grid_a.rate != grid_b.rate {
        mismatches.push(Mismatch::new(
            "sampleRate",
            json!(grid_a.rate),
            json!(grid_b.rate),
        ));
    }
    if grid_a.channel != grid_b.channel {
        mismatches.push(Mismatch::new(
            "channel",
            json!(grid_a.channel),
            json!(grid_b.channel),
        ));
    }
    if uses_spectral_grid(tool) {
        push_difference(&mut mismatches, "fftSize", grid_a.fft_size, grid_b.fft_size);
        push_difference(&mut mismatches, "hop", hop_fraction(a), hop_fraction(b));
        if grid_a.window_fn != grid_b.window_fn {
            mismatches.push(Mismatch::new(
                "windowFn",
                json!(grid_a.window_fn),
                json!(grid_b.window_fn),
            ));
        }
    }
    if uses_band(tool) && grid_a.band != grid_b.band {
        mismatches.push(Mismatch::new(
            "band",
            json!([grid_a.band.0, grid_a.band.1]),
            json!([grid_b.band.0, grid_b.band.1]),
        ));
    }
    if let (Some(a_bins), Some(b_bins)) = (grid_a.bins, grid_b.bins) {
        push_difference(&mut mismatches, "bins", a_bins, b_bins);
    }
    for ((key, a_value), (_, b_value)) in grid_a.options.iter().zip(&grid_b.options) {
        if a_value != b_value {
            mismatches.push(Mismatch::new(key, json!(a_value), json!(b_value)));
        }
    }

    // A scalar readout has no grid; two scalars are always comparable.
    let needs_overlap = matches!(family_of(tool).as_str(), "series" | "events" | "notes");
    let aligned = mismatches.is_empty() && (!needs_overlap || overlap.is_some());
    Comparability {
        aligned,
        overlap,
        mismatches,
        filters_differ,
    }
}

fn push_difference(mismatches: &mut Vec<Mismatch>, key: &str, a: usize, b: usize) {
    if a != b {
        mismatches.push(Mismatch::new(key, json!(a), json!(b)));
    }
}

/// The hop as the user set it (a fraction of the FFT window), for the mismatch list.
///
/// Kept as a percentage so two hops that differ below the UI's granularity are equal.
fn hop_fraction(side: &Side<'_>) -> usize {
    // Two decimals is finer than the UI offers (¼, ½, ¾, 1) yet stable to compare.
    (side.setup.params.hop.clamp(0.0, 1.0) * 100.0).round() as usize
}

fn grid_of(tool: &str, side: &Side<'_>) -> Grid {
    let params = &side.setup.params;
    let channel = params.channel;
    let mut options = Vec::new();
    let effective = crate::audio::analyzers::effective_options(tool, Some(&side.setup.options));
    for key in grid_option_keys(tool) {
        if let Some(value) = effective.get(*key).and_then(Value::as_f64) {
            options.push((*key, value));
        }
    }
    Grid {
        rate: side.rate.max(1),
        channel,
        fft_size: params.fft_size(),
        window_fn: window_fn_name(params),
        band: params.band(side.rate.max(1)),
        bins: bin_count(side.result),
        options,
    }
}

/// The window function's wire name (`"hann"`, …).
pub fn window_fn_name(params: &SharedParams) -> &'static str {
    match params.window_fn {
        WindowKind::Hann => "hann",
        WindowKind::Hamming => "hamming",
        WindowKind::Blackman => "blackman",
        WindowKind::Rectangular => "rectangular",
    }
}

/// The length of a result's band/bin axis, when it has one.
pub fn bin_count(result: &AnalysisResult) -> Option<usize> {
    match result {
        AnalysisResult::Spectrum(r) => Some(r.freqs.len()),
        AnalysisResult::Spectrogram(r) => Some(r.bins),
        AnalysisResult::MelSpectrogram(r)
        | AnalysisResult::Mfcc(r)
        | AnalysisResult::Chromagram(r)
        | AnalysisResult::SpectralContrast(r) => Some(r.bins),
        AnalysisResult::Modulation(r) => Some(r.mod_freqs.len()),
        _ => None,
    }
}

/// Whether the tool's result depends on the shared FFT / hop / window grid.
fn uses_spectral_grid(tool: &str) -> bool {
    !matches!(
        tool,
        "levels"
            | "loudnessIntegrated"
            | "loudnessRange"
            | "waveform"
            | "frameRms"
            | "noteMetrics"
            | "modulation"
            | "loudnessMomentary"
    )
}

/// Whether the tool reads the shared frequency band.
fn uses_band(tool: &str) -> bool {
    matches!(
        tool,
        "spectrum"
            | "spectrogram"
            | "melSpectrogram"
            | "spectralCentroid"
            | "spectralFlux"
            | "spectralRolloff"
            | "spectralFlatness"
            | "spectralBandwidth"
            | "spectralEntropy"
            | "spectralCrest"
    )
}

/// The tool options that change the result's grid (not just its values).
fn grid_option_keys(tool: &str) -> &'static [&'static str] {
    match tool {
        "melSpectrogram" => &["nMels"],
        "mfcc" => &["nMels", "nMfcc"],
        "spectralContrast" => &["nBands"],
        "tempo" | "onsets" | "downbeats" => &["barLength"],
        "frameRms" => &["frameMs", "hopMs"],
        "modulation" => &["frameMs", "hopMs", "modMinHz", "modMaxHz"],
        "loudnessMomentary" => &["windowMs"],
        _ => &[],
    }
}

/// Canonical option keys whose value is a **count**, so it must be an integer on the
/// wire. The option catalog and every `f64` project map report defaults as floats, so a
/// value copied from `get_analyzer`, a peer setup, or a saved project has to be rounded
/// before it is deserialized into [`crate::audio::analysis::ToolOptions`].
const INTEGER_OPTION_KEYS: [&str; 8] = [
    "nMels",
    "nMfcc",
    "nBands",
    "barLength",
    "windowMs",
    "envelopePoints",
    "detrend",
    "topPeaks",
];

/// Round every count-valued option in `map` to a JSON integer (in place), so the object
/// can be deserialized into `ToolOptions` no matter where its numbers came from.
pub fn coerce_option_numbers(map: &mut serde_json::Map<String, Value>) {
    for key in INTEGER_OPTION_KEYS {
        if let Some(value) = map.get(key).and_then(Value::as_f64) {
            map.insert(key.to_string(), json!(value.round() as u64));
        }
    }
}

/// Effective per-tool options for the wire (`{ key: value }`, defaults included).
///
/// Count-valued options are emitted as integers: a caller may send this object straight
/// back as B's setup, and `ToolOptions` would reject a float there.
pub fn effective_options(tool: &str, options: &crate::audio::analysis::ToolOptions) -> Value {
    let mut map = crate::audio::analyzers::effective_options(tool, Some(options));
    coerce_option_numbers(&mut map);
    Value::Object(map)
}
