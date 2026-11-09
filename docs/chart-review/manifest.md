# Hey Listen — chart-review screenshot manifest

Screenshots live in `shots/`, named `<analyzerId>--<theme>.png` (and `-c0`/`-c1` when a
tool draws two canvases). `dark` = `builtin:dark`, `light` = `builtin:light`. Every PNG
is the analyzer's chart canvas exactly as rendered by the app's real renderer (uPlot /
custom canvas), captured from the preview shell over the deterministic 4 s fixture
(220 Hz tremolo tone → 300–920 Hz vibrato chirp → gated noise bursts → 440+660 Hz dyad).

The fixture is **mono**, so `spatial` (stereo-only) has no result and is not captured.
Three tools (`levels`, `loudnessIntegrated`, `loudnessRange`) are **readout cards**, not
charts — they render DOM cards, not a canvas, so they have no PNG.

## Time

| id | Title | View | Chart style |
| --- | --- | --- | --- |
| waveform | Waveform | waveform | custom canvas: peak/RMS envelope over time |
| levels | Level meters | readouts | *(readout cards — no chart)* |
| frameRms | Amplitude envelope | series | area, `level (dBFS)` over time |

## Spectral

| id | Title | View | Chart style |
| --- | --- | --- | --- |
| spectrum | Spectrum | spectrum | mean/min/max level vs frequency (log-freq toggle, optional equal-loudness contour) |
| spectrogram | Spectrogram | spectrogram | time × frequency dB heatmap (centroid/rolloff contour overlays) |
| melSpectrogram | Mel spectrogram | matrix | time × mel-band heatmap |
| mfcc | MFCC | matrix | time × cepstral-coefficient heatmap |
| chromagram | Chromagram | matrix | time × pitch-class heatmap (note gridlines) |
| spectralCentroid | Spectral centroid | series | area, `centroid (Hz)`, **log y** |
| spectralFlux | Spectral flux | series | **stems**, `flux` |
| spectralRolloff | Spectral rolloff | series | area, `rolloff (Hz)`, **log y** |
| spectralFlatness | Spectral flatness | series | area, `flatness`, y ∈ [0,1] |
| spectralContrast | Spectral contrast | matrix | time × octave-band heatmap |
| spectralBandwidth | Spectral bandwidth | series | area, `bandwidth (Hz)`, **log y** |
| spectralEntropy | Spectral entropy | series | area, `entropy (bits)` |
| spectralCrest | Spectral crest factor | series | **stepped**, `crest factor` |
| harmonicRatio | Harmonic ratio | series | area, `harmonic ratio`, y ∈ [0,1] |
| zeroCrossingRate | Zero-crossing rate | series | area, `zero-crossing rate`, y ∈ [0,1] |
| modulation | AM/FM modulation | modulation | AM + FM spectra over one modulation-rate axis (readouts) |

## Pitch / melody

| id | Title | View | Chart style |
| --- | --- | --- | --- |
| pitchPyin | Pitch (pYIN) | series | **points**, `pitch (Hz)`, **log y**, semitone grid |
| pitchYin | Pitch (YIN) | series | **points**, `pitch (Hz)`, **log y**, semitone grid |
| pitchAutocorr | Pitch (autocorrelation) | series | **points**, `pitch (Hz)`, **log y**, semitone grid |
| noteMetrics | Note segments | noteMetrics | summary cards + per-note table + note-segment chart |

## Rhythm / tempo

| id | Title | View | Chart style |
| --- | --- | --- | --- |
| tempo | Tempo | rhythm | onset-strength envelope + beat markers |
| onsets | Onsets | rhythm | onset-strength envelope + onset markers |
| downbeats | Downbeats | rhythm | onset-strength envelope + beat + downbeat markers |

## Loudness

| id | Title | View | Chart style |
| --- | --- | --- | --- |
| loudnessIntegrated | Integrated LUFS | readouts | *(readout cards — no chart)* |
| loudnessMomentary | Loudness (momentary) | series | area, `loudness (LUFS)`, −14 LUFS reference line |
| loudnessRange | Loudness range | readouts | *(readout cards — no chart)* |

## Perception (psychoacoustic)

| id | Title | View | Chart style |
| --- | --- | --- | --- |
| criticalBands | Critical bands | matrix | time × critical-band (Bark/ERB) heatmap, band-centre Hz labels |
| loudness | Loudness (sone/phon) | loudness | sones/phons readouts + loudness-over-time chart |
| specificLoudness | Specific loudness | matrix | time × ERB-band specific-loudness heatmap |
| sharpness | Sharpness | series | area, `sharpness (acum)` |
| roughness | Roughness | series | area, `roughness (asper)` |
| fluctuationStrength | Fluctuation strength | series | area, `fluctuation (vacil)` |
| masking | Masking | masking | spectrum + threshold-in-quiet + masking-threshold + SMR bands |
| tonality | Tonality | series | area, `tonality`, y ∈ [0,1] |
| spatial | Spatial | series | area, `correlation`, y ∈ [−1,1] — **stereo-only, not captured** |
