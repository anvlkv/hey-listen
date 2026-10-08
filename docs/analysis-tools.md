# Analysis tools

Every oxiaudio analysis capability is exposed as a **tool** that can be opened
as a tab in the Workbench.

## Tool model

- Stable `tool id` (string). **No duplicate tabs** per tool.
- Each tool has a **params popover** (per-tool config).
- Each tool has an **about popover** (when/how to use it).
- Each tool carries **keywords** (search terms) for the Sidebar search box, which
  filters analyzers by title and keywords.
- Results are computed over the analysis window by the Rust backend
  (`oxiaudio`), respecting shared params.

## Shared parameters (synced across tools)

Shared params live in one frontend store; changing one updates every tool that
uses it. Each `run_analysis` call carries them.

| Param | Applies to | Notes |
| --- | --- | --- |
| FFT window size | spectral, pitch, onset, tempo | 512 / 1024 / 2048 / 4096 / 8192 |
| Hop / overlap | all frame-based tools | fraction of window or explicit frames |
| Randomized overlap | all frame-based tools | optional; synced too |
| Window function | spectral, pitch | Hann / Hamming / Blackman / rectangular |
| Channel selection | all tools | mono-mix / L / R / mid / side |
| Analysis sample rate | all tools | optional resample before analysis |
| Frequency range (min/max Hz) | spectral, pitch | band-limit before spectral/pitch |

Per-tool params (not shared) stay in each tool's params popover: mel band count,
MFCC coefficient count, chroma bins, onset threshold, etc.

## Tool inventory (oxiaudio)

**Time domain**

| Tool | oxiaudio |
| --- | --- |
| Waveform | `AudioBuffer` samples (peak/rms via `peak_amplitude`/`rms_amplitude`, `PeakMeter`/`RmsMeter`) |
| Level meters | `peak_db`, `rms_db` |

**Spectral**

| Tool | oxiaudio |
| --- | --- |
| Spectrogram | `dsp::spectral::stft` |
| Mel spectrogram | `dsp::spectral::melspectrogram` |
| MFCC | `dsp::mfcc` |
| Chromagram | `dsp::chromagram` |
| Spectral centroid | `dsp::spectral_centroid` |
| Spectral flux | `dsp::spectral_flux` |
| Spectral rolloff | `dsp::spectral_rolloff` |
| Spectral flatness | `dsp::spectral_flatness` |
| Spectral contrast | `dsp::spectral_contrast` |
| Spectral bandwidth | `dsp::spectral_bandwidth` |
| Spectral entropy | `dsp::spectral_entropy` |
| Spectral crest factor | `dsp::spectral_crest_factor` |
| Harmonic ratio | `dsp::harmonic_ratio` |
| Zero-crossing rate | `dsp::zero_crossing_rate` |

**Pitch / melody**

| Tool | oxiaudio |
| --- | --- |
| Pitch (pYIN) | `dsp::detect_pitch` (default pYIN) |
| Pitch (YIN) | `dsp::detect_pitch_yin` |
| Pitch (autocorr) | `dsp::detect_pitch_autocorr` |

**Rhythm / tempo**

| Tool | oxiaudio |
| --- | --- |
| Tempo | `dsp::detect_tempo` / `estimate_tempo` |
| Onsets | `dsp::detect_onsets`, `complex_domain_onset` |
| Downbeats | `dsp::detect_downbeats` |

**Loudness**

| Tool | oxiaudio |
| --- | --- |
| Integrated LUFS | `dsp::loudness_lufs` (EBU R128) |
| Momentary / windowed | `dsp::loudness_momentary`, `loudness_momentary_windowed` |
| Loudness range | `dsp::loudness_range` |

## Filtering before analysis

Audio can be filtered before analysis: the user builds a **fundsp graph** in the
Filter graph Workbench tab (see [`graph-editor.md`](graph-editor.md)). The graph is
applied upstream of preview playback and all analysis, and can be bypassed with the
Toolbar **Filter** toggle.

The node palette is a focused subset of fundsp today; covering the full node set is
tracked in the [roadmap](roadmap.md) backlog.
