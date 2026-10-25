# Analysis tools

Every oxiaudio analysis capability is exposed as a **tool** that can be opened
as a tab in the Workbench.

## Tool model

- Stable `tool id` (string). **No duplicate tabs** per tool.
- Each tool has a **params popover** (per-tool config).
- Each tool has an **about popover** (what it shows, and when to use it). The copy
  is **markdown** — short paragraphs with bold or italic lead-ins — rendered in the
  panel; the Sidebar's hover hint is a plain-text preview of it.
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
| Frequency range (min/max Hz) | spectral | band-limit the STFT / mel tools; pitch tools have their own `minF0Hz` / `maxF0Hz` range |

Per-tool params (not shared) stay in each tool's params popover and cross IPC in a
`ToolOptions` object alongside the shared params: the spectrum/spectrogram's
**min / max / mean** magnitude layers, mel band count, MFCC coefficient count,
chroma bins, onset threshold, etc.

**Option integrity (M16).** Engine options use canonical **camelCase** keys
(`nMels`, `yinThreshold`, `minF0Hz`, `maxF0Hz`, …); the snake_case aliases
(`n_mels`, `min_f0_hz`, …) are accepted at the MCP / CLI boundary. An unknown key is
**an error** on every path — GUI MCP, headless MCP, and `hey-listen analyze -o` — rather
than being silently ignored. Chart-display toggles (the spectrum layers, dB scale,
contour overlays) are marked `target: "view"` in the registry and never cross IPC.
`list_analyzers` reports each tool's compact option keys and defaults; the full
label/min/max/help metadata is stored in the Rust catalog and returned by M21's
`get_analyzer`.

## Tool inventory (oxiaudio)

**Time domain**

| Tool | oxiaudio |
| --- | --- |
| Waveform | `AudioBuffer` samples (peak/rms via `peak_amplitude`/`rms_amplitude`, `PeakMeter`/`RmsMeter`) |
| Level meters | `peak_db`, `rms_db` |
| Amplitude envelope | core frame-RMS helper (`audio/analysis/support.rs`) — plain amplitude, not EBU R128 (M17) |

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
| AM/FM modulation | core envelope + YIN residual spectra with a bounded radix-2 FFT (`audio/analysis/tools/modulation*`) — M20 |

**Pitch / melody**

| Tool | oxiaudio |
| --- | --- |
| Pitch (pYIN) | `dsp::detect_pitch` (default pYIN) |
| Pitch (YIN) | `dsp::detect_pitch_yin` |
| Pitch (autocorr) | `dsp::detect_pitch_autocorr` |
| Note segments | core frame-RMS gate + segmentation (`audio/analysis/tools/notes.rs`) — M18 |

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
**Filter** switch in the Timeline toolbar. It reads **off** while the graph is still
its identity seed (nothing to apply).

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

## Analysis depth (M16–M20)

The pitch-range fix, the **frame-RMS amplitude envelope**, **note segmentation**, the
per-note **voice-quality proxies**, and **AM/FM modulation spectra** are delivered
(M16–M20). See [`analysis-metrics.md`](analysis-metrics.md) for the designs, result
shapes, option defaults, and test plan. **M21** delivered the shared MCP/CLI contract —
per-result summaries, compact previews, tool annotations, and analyzer discovery — see
[`mcp-cli-ergonomics.md`](mcp-cli-ergonomics.md).

## Implementation status

All tools above are implemented (M5) in `src-tauri/src/audio/analysis/` and
dispatched by the single `run_analysis` command. The frontend registry
(`state/analyzer/`) declares each tool's title, description, about copy,
keywords, sidebar section, view (series / matrix / rhythm / readouts / events), and
per-tool params, so adding a tool is a registry entry plus its Rust function — no
bespoke component. **No duplicate tabs** per tool, and **zoom/cursor are synced**
across tabs (`state/chartSync.ts`). The **spectrum** tool returns per-bin
**min / max / mean** magnitudes and exposes each as a toggleable layer. The shared
params now live in the app **Toolbar** (an “Analysis params” popover); a tool's own
params popover holds only its non-shared options.

**Pitch ranges (M16).** The three pitch tools expose an f0 range as a per-tool option:
YIN and autocorrelation honour `minF0Hz`/`maxF0Hz` directly, and harmonic ratio does
too. pYIN cannot — `oxiaudio 0.2.1` hardcodes it to **50–2000 Hz** — so its result
reports the effective window instead of pretending a wider request took effect. Every
pitch result carries `effectiveMinF0Hz`/`effectiveMaxF0Hz`, drawn as an **f0 range**
readout on the chart and named in its empty-state copy. Use YIN or autocorrelation
above 2 kHz.

**Amplitude envelope (M17).** `frameRms` returns a plain frame-centred RMS series in
dBFS (`frameMs` 10 / `hopMs` 5 by default), independent of EBU R128 loudness. Its
`SeriesResult` carries an optional `frameSize` in samples, so the chart, the readouts
(which add a **Frame** card), a note's values line, and an agent all see the resolution
it was computed at. The frame count is capped (the hop widens for long windows, and the
effective hop is reported). In MCP/CLI it is a normal series result: the compacted
form keeps `{length, min, max, argmin, argmax}` (plus `frameSize`), and
`includeData: true` / `--full` returns the full `values` array.

**Note segments (M18).** `noteMetrics` gates the frame-RMS envelope (absolute floor +
threshold relative to the window peak + hysteresis), merges short gaps, drops short
notes, and returns per-note spans, gaps, RMS/peak levels, levels relative to the loudest
note, and a normalized envelope. The **Note segments** view is summary cards, a segment
chart over the analysis window (each note as a **peak/RMS block** over its envelope, a
**voiced** split ruler, **gap** bands with durations, a **gate** rule, and a per-note
**f0** overlay on a right-hand axis), and a scrollable table; hovering a note highlights
its row. These are **detected audio notes**, not the project's user-authored
**annotations** (M14) — see [`notes.md`](notes.md) → Terminology. In MCP/CLI the result
is compacted by the normal rules: the summary counts (`noteCount`, `gapCount`, …) always
survive, while the `notes` / `gaps` arrays collapse to `{length}` when long; request
`includeData: true` / `--full` for the records.

**Note voice-quality proxies (M19).** Every `noteMetrics` note also carries
`voicedFraction`, `f0MedianHz`, `jitterProxyCents`, `shimmerProxyDb`, and `hnrProxy`,
measured on the note's own fine YIN grid (`pitchFrameMs` 40 / `pitchHopMs` 5 by
default). Jitter is the spread of the linearly detrended f0 track in cents; shimmer is
the spread of the note's frame RMS in dB; the HNR figure is the mean 0–1
`harmonic_ratio` — an **autocorrelation periodicity proxy**, not HNR in dB. They are
**proxies**, not clinical measures, and are `null` when a note is too short (or too
unvoiced) to measure. The table shows all five, the segment chart's hover card shows
voiced, f0, jitter, shimmer, and the HNR proxy for the note under the pointer (and the
per-note median f0 is also drawn on a right-hand axis), and the per-tool `minF0Hz` /
`maxF0Hz` bound the proxy grid just as they do for the pitch tools.

**AM/FM modulation (M20).** `modulation` returns the AM spectrum of the linear
frame-RMS envelope and the FM spectrum of the longest voiced run's pitch residual
(cents), on **one shared modulation-rate axis** and in dB relative to each spectrum's
strongest bin. Each spectrum carries its top `topPeaks` (default 3) with relative level
and prominence; the summary adds the AM depth and peak-to-trough range, the FM run's
span and top rate, and its peak-to-peak / standard deviation in cents. The band is
clamped to ~45% of the **lower** of the two analysis rates and the effective range is
reported, so an aliased request is visible instead of silent. A spectrum is only
reported when the modulation is meaningful (AM depth ≥ 2%, FM spread ≥ 2 cents), so a
steady carrier (or silence) shows small depth readouts and **empty** spectra rather
than an invented rate; the FM half is also empty when no voiced run reaches
`minVoicedSecs`. The **AM/FM modulation** view draws the two spectra with readouts and
syncs on its own `mod` group.
In MCP/CLI a spectrum array is compacted to its stats by the normal rules; the ranked
peaks and depth fields survive compaction, and `includeData: true` / `--full` returns
the full spectra.

> The rhythm tools (tempo / onsets / downbeats) return the **onset-strength
> envelope** plus their event times, so their tabs draw the envelope with the
> detected beats / onsets / downbeats marked on top, rather than a list of numbers.
> Long-window analysis is kept interactive by padding short windows (so the
> library's frame-based features always yield a frame) and by bounding the
> frame count of the O(frames × lags) pitch / harmonic-ratio tools.

## Chart rendering (M11.A)

Each view kind renders its data for its semantics, driven by the tool's registry
entry — no per-tool chart component.

**Every time a chart draws is source seconds.** The engine analyses the analysis
window as a slice, so a tool's frames are laid out from the window's start; the
engine re-bases each result onto source seconds before it leaves (`windowStart`
records the origin — see [`data-model.md`](data-model.md) → `AnalysisResult`). A
result's `times`, its hover readouts, the axis labels, and a note's anchor therefore
all speak the same units, whatever the window is, and a consumer that needs a *frame*
from a time (the heatmaps, a note's values line) maps it back through `windowStart`.

- **series** — one scalar per frame over time. Declarative options pick a line /
  area / step / impulse (**stems**) path; pitch tracks use a **log-frequency y-axis
  with semitone gridlines**; bounded ratios fix `0…1`; momentary loudness adds a
  **−14 LUFS reference line**.
- **waveform** — the min/max envelope; the **dB scale** toggle collapses it to a
  |peak| curve in dBFS with a 0 dBFS line.
- **spectrum** — layered magnitudes; the **Log frequency** toggle (default on)
  switches the axis between linear and octave spacing.
- **spectrogram** — the magnitude heatmap; the **Centroid** / **Rolloff** toggles
  (default on) overlay those tracks.
- **matrix** — a frame × band heatmap; the chromagram adds a pitch-class note grid.
- **rhythm** — the onset-strength envelope with beat / onset / downbeat markers, plus
  a **tempo-salience** panel (the envelope's autocorrelation over BPM) on the tempo
  and downbeat tools.
- **note segments** — the detected notes over the analysis window, drawn as
  **blocks** whose height is the note's **peak** with a stronger fill up to its **RMS**
  (the cap between them is the crest), over its frame-RMS envelope line. A **segment
  ruler** along the top edge is the note's extent split by its **voiced** share, the
  loudest note takes the reference colour, and each note is numbered above its peak
  when the span can hold it. **Gaps** are banded and labelled with their duration; the
  **gate** is drawn when it falls in view; the per-note median **f0** is a flat dashed
  segment on a right-hand axis. It joins the `"time"` sync group, hovering a note
  highlights its table row, and the hover card shows the whole record (span, gaps,
  RMS/peak, levels versus the loudest note, voiced, f0, jitter, shimmer, HNR proxy).
- **modulation** — the **AM** and **FM** spectra as two lines against a
  **modulation-rate** (Hz) x-axis, with a fixed relative-dB y-range so the two are
  directly comparable and readout cards for the top rates, depths, and the FM run.
  It joins its own `"mod"` sync group, because its x-unit is neither source time nor
  audio frequency; the floor bins are drawn as gaps, so silence is not a flat line.
- **readouts** — scalar cards; the `levels` tool draws **peak / RMS meter bars**.
- **notes** — every time-axis chart also draws its project notes as anchors in a thin
  strip along the bottom (its own at full strength, other charts' muted, the focused
  one as a full-height rule with a label). See [`notes.md`](notes.md) → Surfacing.

**Cursors and overlays** are theme roles, not per-tool constants (see
[`theming.md`](theming.md) → the `ChartTheme` role list): `hover` is where the pointer
is (the uPlot crosshair **and** the canvas cross, so both charts agree), `mirror` is the
same cursor mirrored in from another chart in the group (dashed), `playhead` is the
preview transport (solid), `reference` is a target/threshold rule, and `note` the
annotation anchors. Each is held at a distinct hue in every bundled theme, so several
can be on a chart at once. Over a **heatmap** the background *is* the data, so the
cross, cursor, playhead and contours are stroked with a background-coloured **halo**
(`chartCanvas.strokeOverRamp`) — the halo separates the line from whatever band of the
ramp it crosses, which no single stroke colour could do.
