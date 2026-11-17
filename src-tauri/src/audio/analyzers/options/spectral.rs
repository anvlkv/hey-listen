//! The spectral analyzers' option metadata (M16/M21), split out of [`super::table`]
//! so each file stays inside the source-size budget.

use super::OptionInfo;
use crate::audio::analyzers::AnalyzerId;

/// Per-analyzer engine-option metadata for the spectral tools.
pub(crate) const OPTIONS: &[(AnalyzerId, &[OptionInfo])] = &[
    (
        AnalyzerId::MelSpectrogram,
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
        AnalyzerId::Mfcc,
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
        AnalyzerId::SpectralRolloff,
        &[
            OptionInfo {
                key: "rolloffPercent",
                label: "Energy share",
                default: 0.85,
                min: 0.01,
                max: 0.99,
                help: "Share of spectral energy below the rolloff frequency.",
            },
            super::GATE_DB,
            super::GATE_FLOOR_DB,
        ],
    ),
    (
        AnalyzerId::SpectralCentroid,
        &[super::GATE_DB, super::GATE_FLOOR_DB],
    ),
    (
        AnalyzerId::SpectralFlatness,
        &[super::GATE_DB, super::GATE_FLOOR_DB],
    ),
    (
        AnalyzerId::ZeroCrossingRate,
        &[super::GATE_DB, super::GATE_FLOOR_DB],
    ),
    (
        AnalyzerId::SpectralContrast,
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
        AnalyzerId::HarmonicRatio,
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
            super::GATE_DB,
            super::GATE_FLOOR_DB,
        ],
    ),
];
