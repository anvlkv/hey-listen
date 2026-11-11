//! The chronological pass that turns a window's samples into per-frame weighted
//! modulation, split out of `modulation.rs` for the source-size budget.
//!
//! Only the frame windows are retained, so an hour-long selection costs the same
//! memory as a short one and the envelope rate never has to be widened to fit — which
//! is what used to let a long selection alias real 70 Hz modulation down into the
//! slow-rate band.

use super::super::super::support::effective_hop;
use super::super::super::SharedParams;
use super::super::bands::critical_band_edges;
use super::super::scales::Scale;
use super::filters::{Channel, Config, Level};
use super::rates::{self, RateCells};
use super::{decimation, frame_value, FrameCells, Modulation, Weighting};

/// The frame grid and window geometry of one pass.
struct Grid {
    hop: usize,
    sample_rate: u32,
    envelope_rate: f64,
    window: usize,
    decim: usize,
    samples: usize,
    frames: usize,
}

/// The envelope-sample span `[low, high)` a frame's centred window covers.
fn frame_span(frame: usize, grid: &Grid) -> (usize, usize) {
    let seconds = (frame * grid.hop) as f64 / f64::from(grid.sample_rate.max(1));
    let centre = (seconds * grid.envelope_rate).round() as isize;
    let half = grid.window as isize / 2;
    let low = (centre - half).max(0) as usize;
    let high = ((centre + half) as usize).min(grid.samples);
    (low, high)
}

/// One frame's per-band windows, flattened as `band × count` (oldest first).
#[derive(Default)]
pub(super) struct Frame {
    count: usize,
    envelope: Vec<f32>,
    modulated: Vec<f32>,
}

impl Frame {
    /// Copy every band's most recent `count` samples out of `channels`.
    pub(super) fn fill(&mut self, channels: &mut [Channel], count: usize) {
        self.count = count;
        self.envelope.clear();
        self.modulated.clear();
        for channel in channels {
            let (envelope, modulated) = channel.window(count);
            self.envelope.extend_from_slice(envelope);
            self.modulated.extend_from_slice(modulated);
        }
    }

    pub(super) fn envelope(&self, band: usize) -> &[f32] {
        let start = band * self.count;
        &self.envelope[start..start + self.count]
    }

    pub(super) fn modulated(&self, band: usize) -> &[f32] {
        let start = band * self.count;
        &self.modulated[start..start + self.count]
    }
}

/// The streaming pass over one window: the band channels, the level reference and the
/// frame buffer, emitting a frame's value as soon as its window is complete.
pub(super) struct Pass<'a> {
    channels: Vec<Channel>,
    /// The channels' centre frequencies (Hz), the contribution grid's columns.
    bands: Vec<f32>,
    /// The modulation-rate axis (Hz); empty when the tool collects no rate matrix.
    rates: Vec<f32>,
    level: Level,
    frame: Frame,
    grid: Grid,
    weighting: &'a Weighting,
    calibration_db_spl: f32,
    /// Absolute index of the newest envelope sample (`-1` before the first).
    latest: isize,
    /// The next frame to emit.
    next: usize,
    values: Vec<Option<f32>>,
    /// Frame-major `frames × bands` per-band contributions (M36).
    contributions: Vec<f32>,
    /// Frame-major, then band-major, then rate `frames × bands × rates` depths (M36).
    rate_values: Vec<f32>,
}

impl<'a> Pass<'a> {
    pub(super) fn new(
        mono: &[f32],
        sample_rate: u32,
        params: &SharedParams,
        weighting: &'a Weighting,
        calibration_db_spl: f32,
    ) -> Self {
        let (min_hz, max_hz) = params.band(sample_rate);
        let rate = f64::from(sample_rate.max(1));
        let decim = decimation(rate);
        let envelope_rate = rate / decim as f64;
        let fft = params.fft_size();
        let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
        let window = (weighting.window_secs * envelope_rate).round().max(2.0) as usize;
        // The modulation filter settles over a few periods at the target rate; the
        // warm-up runs on the envelope's own start, as the whole-window pipeline did.
        let period = (envelope_rate / weighting.target_hz).max(1.0);
        let periods = (5.0 * weighting.q / std::f64::consts::PI).ceil();
        let settle = (periods * period).round().max(1.0) as usize;
        let config = Config {
            rate,
            envelope_rate,
            decim,
            capacity: window.max(settle),
            settle,
            modulation: (weighting.target_hz, weighting.q),
        };
        let channels: Vec<Channel> = critical_band_edges(Scale::Bark, min_hz as f32, max_hz as f32)
            .windows(2)
            .map(|pair| {
                let centre = (f64::from(pair[0]) * f64::from(pair[1])).sqrt().max(20.0);
                let width = (f64::from(pair[1]) - f64::from(pair[0])).max(20.0);
                Channel::new(centre, width, &config)
            })
            .collect();
        let grid = Grid {
            hop,
            sample_rate,
            envelope_rate,
            window,
            decim,
            samples: mono.len().div_ceil(decim),
            frames: mono.len().div_ceil(hop),
        };
        Self {
            bands: channels.iter().map(|channel| channel.hz as f32).collect(),
            rates: if weighting.collect_rates {
                rates::grid()
            } else {
                Vec::new()
            },
            channels,
            level: Level::new(window, decim),
            frame: Frame::default(),
            values: Vec::with_capacity(grid.frames),
            contributions: Vec::new(),
            rate_values: Vec::new(),
            grid,
            weighting,
            calibration_db_spl,
            latest: -1,
            next: 0,
        }
    }

    /// Source samples per envelope sample.
    pub(super) fn decimation(&self) -> usize {
        self.grid.decim
    }

    /// Feed one source sample, emitting every frame whose window is now complete.
    pub(super) fn push(&mut self, sample: f64) {
        let mut produced = false;
        for channel in &mut self.channels {
            produced |= channel.push(sample);
        }
        produced |= self.level.push(sample);
        if !produced {
            return;
        }
        self.latest += 1;
        self.emit();
    }

    /// Emit the tail (a selection shorter than the modulation filter's warm-up) and
    /// hand back the effective hop with the per-frame values and their per-band
    /// contributions.
    pub(super) fn finish(mut self) -> Modulation {
        for channel in &mut self.channels {
            channel.prime();
        }
        self.emit();
        Modulation {
            hop: self.grid.hop,
            values: self.values,
            bands: self.bands,
            contributions: self.contributions,
            rates: self.rates,
            rate_values: self.rate_values,
        }
    }

    fn emit(&mut self) {
        if self.channels.iter().any(|channel| !channel.primed()) {
            return;
        }
        while self.next < self.grid.frames {
            let (low, high) = frame_span(self.next, &self.grid);
            if (high as isize) - 1 > self.latest {
                break;
            }
            let level = self.level.rms(high.saturating_sub(low));
            let mut contributions = vec![0.0f32; self.bands.len()];
            let mut rate_cells = vec![0.0f32; self.bands.len() * self.rates.len()];
            let mut cells = FrameCells {
                contributions: &mut contributions,
                rates: RateCells::new(&self.rates, self.grid.envelope_rate, &mut rate_cells),
            };
            let value = frame_value(
                &mut self.channels,
                &mut self.frame,
                high.saturating_sub(low),
                level,
                self.weighting,
                self.calibration_db_spl,
                &mut cells,
            );
            if value.is_none() {
                // A frame with nothing to measure is a gap: a zero row keeps the grid
                // rectangular and aligned with `values`.
                contributions.fill(0.0);
                rate_cells.fill(0.0);
            }
            self.values.push(value);
            self.contributions.extend_from_slice(&contributions);
            self.rate_values.extend_from_slice(&rate_cells);
            self.next += 1;
        }
    }
}
