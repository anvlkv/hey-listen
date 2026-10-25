//! Per-analyzer engine-option metadata.
//!
//! `list_analyzers` carries the compact keys + defaults; the remaining fields are the
//! full detail M21's `get_analyzer` returns, kept here so the catalog stays the one
//! source of truth. Split out of [`super`] to keep each file small.

/// One per-tool **engine** option's metadata.
#[allow(dead_code)] // the descriptive fields are read by `get_analyzer` (M21)
pub struct OptionInfo {
    /// Canonical camelCase key (matching `ToolOptions`).
    pub key: &'static str,
    pub label: &'static str,
    pub default: f64,
    pub min: f64,
    pub max: f64,
    pub help: &'static str,
}

/// Per-analyzer engine-option metadata, keyed by analyzer id. Analyzers without
/// their own options are absent (the `list_analyzers` option map is then empty).
pub(super) const OPTIONS: &[(&str, &[OptionInfo])] = &[
    (
        "frameRms",
        &[
            OptionInfo {
                key: "frameMs",
                label: "Frame",
                default: 10.0,
                min: 0.1,
                max: 1_000.0,
                help: "RMS frame length in ms — the envelope's time smoothing.",
            },
            OptionInfo {
                key: "hopMs",
                label: "Hop",
                default: 5.0,
                min: 0.05,
                max: 1_000.0,
                help: "Step between frames in ms; smaller values give a denser envelope.",
            },
        ],
    ),
    (
        "noteMetrics",
        &[
            OptionInfo {
                key: "frameMs",
                label: "Frame",
                default: 10.0,
                min: 0.1,
                max: 1_000.0,
                help: "RMS frame length in ms — the segmentation's time smoothing.",
            },
            OptionInfo {
                key: "hopMs",
                label: "Hop",
                default: 5.0,
                min: 0.05,
                max: 1_000.0,
                help: "Step between frames in ms; smaller values resolve shorter notes.",
            },
            OptionInfo {
                key: "gateDb",
                label: "Gate",
                default: 35.0,
                min: 0.0,
                max: 120.0,
                help: "How far below the window's loudest frame a note must rise.",
            },
            OptionInfo {
                key: "gateFloorDb",
                label: "Gate floor",
                default: -60.0,
                min: -120.0,
                max: 0.0,
                help: "Absolute floor in dBFS; anything quieter is never a note.",
            },
            OptionInfo {
                key: "hysteresisDb",
                label: "Hysteresis",
                default: 3.0,
                min: 0.0,
                max: 24.0,
                help: "A note ends this far below the gate, so it does not chatter on noise.",
            },
            OptionInfo {
                key: "minNoteMs",
                label: "Min note",
                default: 20.0,
                min: 0.0,
                max: 10_000.0,
                help: "Notes shorter than this are discarded.",
            },
            OptionInfo {
                key: "minGapMs",
                label: "Min gap",
                default: 30.0,
                min: 0.0,
                max: 10_000.0,
                help: "Gaps shorter than this merge two runs into one note.",
            },
            OptionInfo {
                key: "envelopePoints",
                label: "Envelope points",
                default: 7.0,
                min: 3.0,
                max: 16.0,
                help: "Envelope samples kept per note, at normalized positions.",
            },
            OptionInfo {
                key: "pitchFrameMs",
                label: "Pitch frame",
                default: 40.0,
                min: 5.0,
                max: 500.0,
                help: "Window for the note's own YIN pitch track (jitter / f0); raised to ~3 periods of the lowest f0.",
            },
            OptionInfo {
                key: "pitchHopMs",
                label: "Pitch hop",
                default: 5.0,
                min: 1.0,
                max: 1_000.0,
                help: "Step between those pitch frames in ms; fine values resolve intra-note jitter.",
            },
            OptionInfo {
                key: "minF0Hz",
                label: "Min f0",
                default: 50.0,
                min: 20.0,
                max: 5_000.0,
                help: "Lowest expected fundamental for the per-note pitch track and periodicity.",
            },
            OptionInfo {
                key: "maxF0Hz",
                label: "Max f0",
                default: 2_000.0,
                min: 40.0,
                max: 8_000.0,
                help: "Highest expected fundamental for the per-note pitch track and periodicity.",
            },
        ],
    ),
    (
        "modulation",
        &[
            OptionInfo {
                key: "frameMs",
                label: "Frame",
                default: 10.0,
                min: 0.1,
                max: 1_000.0,
                help: "RMS frame length in ms for the amplitude envelope.",
            },
            OptionInfo {
                key: "hopMs",
                label: "Hop",
                default: 2.5,
                min: 0.05,
                max: 1_000.0,
                help: "Step between envelope frames; also sets the highest usable modulation rate.",
            },
            OptionInfo {
                key: "modMinHz",
                label: "Min rate",
                default: 0.5,
                min: 0.0,
                max: 10_000.0,
                help: "Bottom of the modulation-rate band, in Hz.",
            },
            OptionInfo {
                key: "modMaxHz",
                label: "Max rate",
                default: 100.0,
                min: 0.01,
                max: 20_000.0,
                help: "Top of the modulation-rate band; clamped to ~45% of the sample rate.",
            },
            OptionInfo {
                key: "detrend",
                label: "Detrend",
                default: 1.0,
                min: 0.0,
                max: 1.0,
                help: "0 removes the mean only; 1 (default) removes a linear trend first.",
            },
            OptionInfo {
                key: "pitchFrameMs",
                label: "Pitch frame",
                default: 40.0,
                min: 5.0,
                max: 500.0,
                help: "Upper bound on the YIN window for the FM run; capped at ~3 periods of the run's f0.",
            },
            OptionInfo {
                key: "pitchHopMs",
                label: "Pitch hop",
                default: 5.0,
                min: 1.0,
                max: 1_000.0,
                help: "Step between the FM run's pitch frames; also sets its usable rate.",
            },
            OptionInfo {
                key: "minVoicedSecs",
                label: "Min voiced run",
                default: 0.2,
                min: 0.0,
                max: 60.0,
                help: "The shortest voiced run the FM half analyses; shorter windows return no FM spectrum.",
            },
            OptionInfo {
                key: "topPeaks",
                label: "Top peaks",
                default: 3.0,
                min: 1.0,
                max: 12.0,
                help: "How many ranked modulation rates each spectrum reports.",
            },
            OptionInfo {
                key: "minF0Hz",
                label: "Min f0",
                default: 50.0,
                min: 20.0,
                max: 5_000.0,
                help: "Lowest expected fundamental for the FM track.",
            },
            OptionInfo {
                key: "maxF0Hz",
                label: "Max f0",
                default: 2_000.0,
                min: 40.0,
                max: 8_000.0,
                help: "Highest expected fundamental for the FM track.",
            },
        ],
    ),
    (
        "melSpectrogram",
        &[OptionInfo {
            key: "nMels",
            label: "Mel bands",
            default: 64.0,
            min: 8.0,
            max: 256.0,
            help: "Number of mel bands; more bands give finer frequency detail.",
        }],
    ),
    (
        "mfcc",
        &[
            OptionInfo {
                key: "nMfcc",
                label: "Coefficients",
                default: 13.0,
                min: 1.0,
                max: 64.0,
                help: "Cepstral coefficients (rows); ~13 captures the spectral envelope.",
            },
            OptionInfo {
                key: "nMels",
                label: "Mel bands",
                default: 64.0,
                min: 8.0,
                max: 256.0,
                help: "Mel bands fed to the cepstral transform.",
            },
        ],
    ),
    (
        "spectralRolloff",
        &[OptionInfo {
            key: "rolloffPercent",
            label: "Energy share",
            default: 0.85,
            min: 0.01,
            max: 0.99,
            help: "Share of spectral energy below the rolloff frequency.",
        }],
    ),
    (
        "spectralContrast",
        &[OptionInfo {
            key: "nBands",
            label: "Bands",
            default: 6.0,
            min: 2.0,
            max: 16.0,
            help: "Number of octave-spaced bands compared peak-to-valley.",
        }],
    ),
    (
        "harmonicRatio",
        &[
            OptionInfo {
                key: "minF0Hz",
                label: "Min f0",
                default: 50.0,
                min: 20.0,
                max: 4_000.0,
                help: "Lowest expected fundamental — the bottom of the autocorrelation search.",
            },
            OptionInfo {
                key: "maxF0Hz",
                label: "Max f0",
                default: 4_000.0,
                min: 40.0,
                max: 8_000.0,
                help: "Highest expected fundamental — the top of the autocorrelation search.",
            },
        ],
    ),
    (
        "pitchYin",
        &[
            OptionInfo {
                key: "yinThreshold",
                label: "YIN threshold",
                default: 0.12,
                min: 0.01,
                max: 0.9,
                help: "Voiced/unvoiced threshold; lower is stricter.",
            },
            OptionInfo {
                key: "minF0Hz",
                label: "Min f0",
                default: 50.0,
                min: 20.0,
                max: 5_000.0,
                help: "Lowest expected fundamental — the bottom of the YIN search.",
            },
            OptionInfo {
                key: "maxF0Hz",
                label: "Max f0",
                default: 2_000.0,
                min: 40.0,
                max: 8_000.0,
                help: "Highest expected fundamental — YIN can search above 2 kHz.",
            },
        ],
    ),
    (
        "pitchAutocorr",
        &[
            OptionInfo {
                key: "minF0Hz",
                label: "Min f0",
                default: 60.0,
                min: 20.0,
                max: 2_000.0,
                help: "Lowest expected fundamental — the bottom of the autocorrelation search.",
            },
            OptionInfo {
                key: "maxF0Hz",
                label: "Max f0",
                default: 1_200.0,
                min: 40.0,
                max: 5_000.0,
                help: "Highest expected fundamental — the top of the autocorrelation search.",
            },
        ],
    ),
    (
        "downbeats",
        &[OptionInfo {
            key: "barLength",
            label: "Beats per bar",
            default: 4.0,
            min: 2.0,
            max: 12.0,
            help: "Beats per bar — the time-signature numerator.",
        }],
    ),
    (
        "loudnessMomentary",
        &[OptionInfo {
            key: "windowMs",
            label: "Window",
            default: 0.0,
            min: 0.0,
            max: 1_000.0,
            help: "Momentary window in ms; 0 uses the EBU R128 400 ms block.",
        }],
    ),
];

/// The engine options declared for `id` (empty for a tool without options).
pub(super) fn options_for(id: &str) -> &'static [OptionInfo] {
    OPTIONS
        .iter()
        .find(|(tool, _)| *tool == id)
        .map(|(_, options)| *options)
        .unwrap_or(&[])
}
