# Analysis tools

Every oxiaudio analysis capability is exposed as a **tool** that can be opened
as a tab in the Workbench.

## Tool model

- Stable `tool id` (string). **No duplicate tabs** per tool.
- Each tool has a **params popover** (per-tool config).
- Each tool has an **about popover** (when/how to use it).
- Each tool carries **keywords** (search terms) for the Sidebar search box, which
  filters analyzers by title and keywords.
- Each **choice** (window function, hop/overlap, FFT size, analyzer) carries an
  explanatory tooltip ("when to use which").
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
| Channel selection | all tools | downmix (mono) / Left / Right / Channel N (0-based) |
| Analysis sample rate | all tools | optional resample before analysis |
| Frequency range (min/max Hz) | spectral, pitch | band-limit before spectral/pitch |

Per-tool params (not shared) stay in each tool's params popover and cross IPC in a
`ToolOptions` object alongside the shared params: the spectrum/spectrogram's
**min / max / mean** magnitude layers, mel band count, MFCC coefficient count,
chroma bins, onset threshold, etc.

## Tool inventory (oxiaudio)

**Time domain**

| Tool | oxiaudio |
| --- | --- |
| Waveform | `AudioBuffer` samples (peak/rms via `peak_amplitude`/`rms_amplitude`, `PeakMeter`/`RmsMeter`) |
| Level meters | `peak_db`, `rms_db` |

**Spectral**

| Tool | oxiaudio |
| --- | --- |
| Spectrum | `dsp::spectral::stft` (magnitude, averaged per bin) |
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

## Exporting results (M12, planned)

Each analyzer tab can export its **data** — JSON (a provenance envelope around the typed
`AnalysisResult`) or CSV (a **wide matrix** for the 2D tools) — and its **chart** (PNG),
and can copy either to the clipboard; an *Export all open analyses…* action writes every
open tab. Data exports are also available headless (MCP `export_analysis`, batch CLI
`--format` / `--out`). See [`exports.md`](exports.md).

## Analysis templates (M13, planned)

A **template** is a named, source-less preset — the shared params, per-tool options,
open tools, filter / synth graphs, optional Workbench layout, and a **window policy** —
that can be applied to any source so the same analysis setup is reused across different
audio (the window moves to fit the new source). See [`templates.md`](templates.md).

## Implementation status

All tools above are implemented (M5) in `src-tauri/src/audio/analysis.rs` and
dispatched by the single `run_analysis` command. The frontend registry
(`state/analyzer.ts`) declares each tool's title, description, about copy,
keywords, sidebar section, view (series / matrix / rhythm / readouts / events), and
per-tool params, so adding a tool is a registry entry plus its Rust function — no
bespoke component. **No duplicate tabs** per tool, and **zoom/cursor are synced**
across tabs (`state/chartSync.ts`). The **spectrum** tool returns per-bin
**min / max / mean** magnitudes and exposes each as a toggleable layer. The shared
params now live in the app **Toolbar** (an “Analysis params” popover); a tool's own
params popover holds only its non-shared options.

> The rhythm tools (tempo / onsets / downbeats) return the **onset-strength
> envelope** plus their event times, so their tabs draw the envelope with the
> detected beats / onsets / downbeats marked on top, rather than a list of numbers.
> Long-window analysis is kept interactive by padding short windows (so the
> library's frame-based features always yield a frame) and by bounding the
> frame count of the O(frames × lags) pitch / harmonic-ratio tools.
