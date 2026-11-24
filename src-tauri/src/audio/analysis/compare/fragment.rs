//! Reference audio for a saved comparison (M23 Phase 3 slice 2).
//!
//! A saved snapshot is normally result-only, so its grid can differ from the owner's
//! and a numeric delta has to wait for the grids to match. When the snapshot carries
//! the reference's **window audio**, the comparison can re-run the reference on the
//! owner's grid instead — exactly what a live reference does.
//!
//! The fragment is interleaved and `i16`-quantised at the reference source's own rate,
//! the convention the project file's `DATA` section already uses, so it costs little
//! next to the stored result. [`ReferenceAudio`] pairs it with the reference's file
//! path, which `SavedComparisonInfo` exposes so "Open reference" still works.

use serde::{Deserialize, Serialize};

use crate::audio::pcm;
use crate::project::{SourceDescriptor, SourceKind};
use crate::state::{SourceData, WindowState};

use super::align::Span;

/// One reference window's PCM, ready to be re-analysed on another grid.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFragment {
    /// The first source second the samples cover (frame-aligned, not the requested span).
    pub start_secs: f64,
    /// The source second just past the last sample.
    pub end_secs: f64,
    pub sample_rate: u32,
    pub channels: u16,
    /// Interleaved, i16-quantised, at the reference source's own rate. The same
    /// convention the project file's `DATA` i16 format uses.
    pub samples: Vec<i16>,
}

impl SavedFragment {
    /// Capture `span` of `pcm`, clamped to the source. `None` when the clamp is empty.
    ///
    /// The stored span is the **frame-aligned** one the samples actually cover, so
    /// [`span`](Self::span) is where the rebuilt result begins in source seconds.
    pub fn capture(pcm: &SourceData, span: Span) -> Option<Self> {
        let channels = pcm.channels.max(1) as usize;
        let sample_rate = pcm.sample_rate.max(1);
        let frames = pcm.samples.len() / channels;
        let first = ((span.start.max(0.0) * f64::from(sample_rate)).floor() as usize).min(frames);
        let last = ((span.end.max(0.0) * f64::from(sample_rate)).ceil() as usize)
            .min(frames)
            .max(first);
        if last <= first {
            return None;
        }
        let samples = pcm.samples[first * channels..last * channels]
            .iter()
            .map(|&sample| pcm::quantize_i16(sample))
            .collect();
        Some(Self {
            start_secs: first as f64 / f64::from(sample_rate),
            end_secs: last as f64 / f64::from(sample_rate),
            sample_rate,
            channels: pcm.channels.max(1),
            samples,
        })
    }

    /// Dequantise the fragment into an analysable source (times begin at 0).
    pub fn to_source(&self) -> SourceData {
        SourceData {
            samples: self
                .samples
                .iter()
                .map(|&value| pcm::dequantize_i16(value))
                .collect(),
            sample_rate: self.sample_rate.max(1),
            channels: self.channels.max(1),
        }
    }

    /// The source span the samples cover.
    pub fn span(&self) -> Span {
        Span {
            start: self.start_secs,
            end: self.end_secs,
        }
    }
}

/// The audio a snapshot needs to re-grid its reference: the window PCM and the
/// reference's own file, when it had one.
#[derive(Debug, Clone, Default)]
pub struct ReferenceAudio {
    /// The captured window, or `None` when the source was empty at capture time.
    pub fragment: Option<SavedFragment>,
    /// The reference's source file (canonicalised), so the snapshot can reopen it.
    pub source_path: Option<String>,
}

impl ReferenceAudio {
    /// Capture the audio a **live** reference runs on, from its project state.
    pub fn from_state(state: &WindowState, span: Span) -> Self {
        let fragment = state
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_ref()
            .and_then(|pcm| SavedFragment::capture(pcm, span));
        let source = state.project_snapshot().source;
        Self {
            fragment,
            source_path: source.as_ref().and_then(file_source_path),
        }
    }

    /// Capture from an explicitly loaded source and its saved descriptor.
    pub fn capture(pcm: &SourceData, span: Span, source: Option<&SourceDescriptor>) -> Self {
        Self {
            fragment: SavedFragment::capture(pcm, span),
            source_path: source.and_then(file_source_path),
        }
    }
}

/// The reference's own file when its source is a decoded file. Canonicalised, so it
/// still opens from another working directory.
fn file_source_path(source: &SourceDescriptor) -> Option<String> {
    if source.kind != SourceKind::File {
        return None;
    }
    let path = source.path.as_deref()?;
    Some(
        std::fs::canonicalize(path)
            .map(|resolved| resolved.to_string_lossy().into_owned())
            .unwrap_or_else(|_| path.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::super::tests::{compare_pair, setup, state_with, tone};
    use super::super::{
        compare_saved, CompareSetup, Comparison, ComparisonDiff, SavedComparison, SideInput,
    };
    use super::*;
    use crate::audio::analysis::AnalysisResult;
    use crate::audio::analyzers::AnalyzerId;
    use crate::audio::graph::GraphSpec;

    fn sine(secs: f64) -> SourceData {
        let sample_rate = 8_000u32;
        let frames = (secs * f64::from(sample_rate)) as usize;
        SourceData {
            samples: (0..frames)
                .map(|frame| {
                    let t = frame as f32 / sample_rate as f32;
                    0.9 * (std::f32::consts::TAU * 440.0 * t).sin()
                })
                .collect(),
            sample_rate,
            channels: 1,
        }
    }

    #[test]
    fn capture_clamps_the_span_and_refuses_an_empty_one() {
        let pcm = sine(0.5);
        let fragment = SavedFragment::capture(
            &pcm,
            Span {
                start: -1.0,
                end: 10.0,
            },
        )
        .expect("fragment");
        assert_eq!(
            fragment.span(),
            Span {
                start: 0.0,
                end: 0.5
            }
        );
        assert_eq!(fragment.samples.len(), pcm.samples.len());
        assert!(SavedFragment::capture(
            &pcm,
            Span {
                start: 0.4,
                end: 0.4
            }
        )
        .is_none());
    }

    #[test]
    fn a_fragment_survives_postcard_with_bounded_error() {
        let pcm = sine(0.5);
        let fragment = SavedFragment::capture(
            &pcm,
            Span {
                start: 0.0,
                end: 0.5,
            },
        )
        .expect("fragment");
        let bytes = postcard::to_stdvec(&fragment).expect("encode");
        let back: SavedFragment = postcard::from_bytes(&bytes).expect("decode");
        let restored = back.to_source();
        assert_eq!(restored.sample_rate, pcm.sample_rate);
        assert_eq!(restored.channels, pcm.channels);
        assert_eq!(restored.samples.len(), pcm.samples.len());
        for (before, after) in pcm.samples.iter().zip(&restored.samples) {
            // One quantisation step, plus the 32767 / 32768 asymmetry.
            assert!(
                (before - after).abs() < 1.0 / 16_000.0,
                "{before} vs {after}"
            );
        }
    }

    #[test]
    fn a_source_path_is_recorded_only_for_a_file_source() {
        let pcm = sine(0.05);
        let span = Span {
            start: 0.0,
            end: 0.05,
        };
        let file = SourceDescriptor {
            kind: SourceKind::File,
            path: Some("/tmp/hey-listen-missing.wav".to_string()),
            ..Default::default()
        };
        let audio = ReferenceAudio::capture(&pcm, span, Some(&file));
        assert!(audio.fragment.is_some());
        assert!(audio.source_path.is_some());

        let mic = SourceDescriptor {
            kind: SourceKind::Mic,
            path: Some("/tmp/hey-listen-missing.wav".to_string()),
            ..Default::default()
        };
        assert!(ReferenceAudio::capture(&pcm, span, Some(&mic))
            .source_path
            .is_none());
    }

    /// Freeze the live comparison's reference side, with `audio` already captured.
    fn frozen_b(
        live: &Comparison,
        audio: ReferenceAudio,
        filter: Option<String>,
    ) -> SavedComparison {
        SavedComparison::from_side(
            AnalyzerId::Spectrum,
            SavedComparison::new_id(1_000),
            &setup(0.0, 1.0),
            &live.b,
            filter,
            0.0,
            1_000,
            None,
            audio,
        )
    }

    /// Compare the owner against `snapshot` on its current setup.
    fn saved_from(
        owner: &WindowState,
        owner_setup: &CompareSetup,
        snapshot: &SavedComparison,
    ) -> Comparison {
        compare_saved(
            AnalyzerId::Spectrum,
            SideInput {
                project: Some("A".to_string()),
                state: owner,
                setup: owner_setup.clone(),
            },
            snapshot,
            0.0,
        )
        .expect("saved comparison")
    }

    /// A spectrum delta's `B − A` values, in dB.
    fn spectrum_values(diff: &Option<ComparisonDiff>) -> &[f32] {
        match diff {
            Some(ComparisonDiff::Spectrum(delta)) => &delta.values,
            _ => panic!("expected a spectrum delta"),
        }
    }

    /// Assert the re-gridded delta matches a live one over the bins that carry the tone.
    ///
    /// Every bin of a scaled tone's spectrum scales with it, so the delta is flat across the
    /// whole leakage skirt; only the bins near the peak's level are informative. A deep skirt
    /// bin sits on the i16 fragment's own noise floor, where quantisation legitimately moves
    /// it by whole dB.
    fn assert_spectrum_match(saved: &Comparison, reference: &Comparison) {
        let (got, want) = (
            spectrum_values(&saved.diff),
            spectrum_values(&reference.diff),
        );
        assert_eq!(got.len(), want.len());
        let spectrum = match &reference.b.result {
            AnalysisResult::Spectrum(result) => result,
            _ => panic!("expected a spectrum result"),
        };
        let floor = spectrum.peak_db - 40.0;
        let mut compared = 0;
        for (index, (got, want)) in got.iter().zip(want).enumerate() {
            if spectrum.mag_db[index] > floor {
                assert!((got - want).abs() < 0.1, "bin {index}: {got} vs {want}");
                compared += 1;
            }
        }
        assert!(compared > 0, "expected the tone's bins in the delta");
    }

    #[test]
    fn a_stored_fragment_regrids_the_reference_onto_the_owners_grid() {
        let a = state_with(tone(2.0, 440.0, 1.0));
        let b = state_with(tone(2.0, 440.0, 0.5));
        let live = compare_pair(
            AnalyzerId::Spectrum,
            (&a, setup(0.0, 1.0)),
            (&b, setup(0.0, 1.0)),
        );
        let mut a_setup = setup(0.0, 1.0);
        a_setup.params.fft_size = 2048;
        a_setup.params.hop = 0.25;
        let audio = ReferenceAudio::from_state(&b, live.b.setup.span());

        let saved = saved_from(&a, &a_setup, &frozen_b(&live, audio, None));
        assert!(saved.comparability.regridded && saved.comparability.aligned);
        let reference = compare_pair(
            AnalyzerId::Spectrum,
            (&a, a_setup.clone()),
            (&b, setup(0.0, 1.0)),
        );
        assert_spectrum_match(&saved, &reference);

        // Without the fragment the old grid is authoritative: no delta across grids.
        let stored = saved_from(
            &a,
            &a_setup,
            &frozen_b(&live, ReferenceAudio::default(), None),
        );
        assert!(!stored.comparability.regridded && !stored.comparability.aligned);
        assert!(stored.diff.is_none());
    }

    #[test]
    fn a_filtered_reference_regrids_with_its_stored_filter() {
        let a = state_with(tone(2.0, 440.0, 1.0));
        let b = state_with(tone(2.0, 440.0, 0.5));
        let filter: GraphSpec = serde_json::from_value(serde_json::json!({
            "nodes": [
                {"id": "in", "kind": "input"},
                {"id": "gain", "kind": "gain", "params": [0.5]},
                {"id": "out", "kind": "output"},
            ],
            "edges": [{"from": "in", "to": "gain"}, {"from": "gain", "to": "out"}],
        }))
        .expect("filter spec");
        b.audio.set_filter(Some(filter.clone()));
        let live = compare_pair(
            AnalyzerId::Spectrum,
            (&a, setup(0.0, 1.0)),
            (&b, setup(0.0, 1.0)),
        );
        let audio = ReferenceAudio::from_state(&b, live.b.setup.span());
        let fingerprint = Some(serde_json::to_string(&filter).expect("fingerprint"));
        let snapshot = frozen_b(&live, audio, fingerprint);
        let mut a_setup = setup(0.0, 1.0);
        a_setup.params.fft_size = 2048;

        let saved = saved_from(&a, &a_setup, &snapshot);
        assert!(saved.comparability.regridded && saved.comparability.filters_differ);
        let reference = compare_pair(AnalyzerId::Spectrum, (&a, a_setup), (&b, setup(0.0, 1.0)));
        assert_spectrum_match(&saved, &reference);
    }
}
