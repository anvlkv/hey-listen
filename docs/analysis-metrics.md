# Analysis metrics: pitch range, envelope, note metrics, modulation

Design for **M16–M20**, the analysis-depth track that closes the gaps found while
driving the app through MCP on a bioacoustic session. **Status: planned — none of this
is implemented yet.** The milestones are ordered so each one is a self-contained,
testable unit:

| MCP-session item | Milestone | Delivered by |
| --- | --- | --- |
| Pitch range at 50–4000 Hz | **M16** | Range-limited YIN, per-tool f0 options, option-key validation, effective-range reporting |
| 2. Real amplitude envelope + per-note level | **M17** + **M18** | Frame-RMS tool; per-note RMS/peak and normalized envelope points |
| 9. Intra-syllable gaps + note count | **M18** | Note segmentation with explicit gaps and counts |
| 20. Jitter + shimmer + HNR per note | **M19** | Per-note proxy metrics over the M18 segments |
| 8. AM/FM modulation spectra | **M20** | Envelope and pitch-residual spectra with ranked peaks |

Implementation order: **M16 → M17 → M18 → M19**; M20 needs M16 + M17 and can ship
after M19.

## Goal

Make the analysis engine able to answer these questions directly, reproducibly, and
through every surface (GUI, MCP, batch CLI):

- What is the amplitude envelope, and what are the per-note levels?
- Where are the notes, the gaps between them, and how many are there?
- How stable are pitch and amplitude within a note (jitter / shimmer proxies), and how
  periodic is it (HNR proxy)?
- What modulation rates and depths are present — is the AM/FM spectrum showing slow
  breathing, a fast trill, or both?

## Scope and constraints

- **In this repo:** new analyzers, shared DSP helpers, result types, chart views,
  option validation, MCP/CLI catalogs, docs, and tests.
- **Not in this repo:** pYIN's own frequency range. `oxiaudio 0.2.1` hardcodes pYIN to
  **50–2000 Hz** and quantizes its output to semitone bins. The repo can expose the
  limit honestly and offer range-limited YIN/autocorrelation as the alternative; a
  configurable pYIN is an upstream change.
- **No project-file schema break.** `AnalysisSetup.shared` is `postcard`-encoded, so
  adding fields to `SharedParams` would need a format-version bump and a migration. New
  per-tool options live in the existing flexible `tool_options` map
  (`tool id → key → number`) and are therefore safe: the Rust `ToolOptions` request
  struct gains optional fields, but the project file stores the map, so old files remain
  valid. The pitch range stays a per-tool option (`minF0Hz` / `maxF0Hz`); the existing
  shared `freqMinHz` / `freqMaxHz` remains a **spectral band limit**. A convenience
  control that fans a shared pitch range out to the per-tool options can be added later
  without a schema change.
- **Results are not persisted yet** (`RESULTS` is written empty), so new
  `AnalysisResult` variants need no container change. They do regenerate
  `src/bindings/**` via `cargo test`.
- **Proxies are named as proxies.** The per-note measures are not clinical jitter,
  shimmer, or HNR. `harmonic_ratio` is a 0–1 autocorrelation periodicity ratio, not HNR
  in dB. The UI and docs must say so.
- **Keep the maid green:** split new Rust and frontend modules to stay under the
  400-line budget, reuse the existing chart/DSP helpers, and add no duplicate logic.

## Shared building blocks

These helpers keep the three new tools from re-implementing the same DSP:

- `frame_rms(mono, sample_rate, frame_ms, hop_ms) -> (times, values_db, frame, hop)` —
  frame-centred RMS in dBFS, floored at `DB_FLOOR`. Used by `frameRms`, `noteMetrics`,
  and the AM half of `modulation`.
- `pitch_track(mono, sample_rate, frame_ms, hop_ms, range) -> Vec<PitchFrame>` — a thin
  wrapper over `oxiaudio::dsp::PitchTracker` (YIN) with a range. The frame size is
  raised to at least ~3 periods of the lowest f0, capped, so low-frequency calls still
  have enough cycles.
- `segment_notes(frame_db, frame_ms, hop_ms, gate) -> (notes, gaps)` — the hysteresis
  gate, short-gap merge, and short-note drop used by `noteMetrics`.
- `modulation_spectrum(values, hop_ms, detrend, min_hz, max_hz) -> (freqs, db, peaks)` —
  detrend, Hann window, zero-pad, FFT, peak picking. Used by both AM and FM.

Caps: bound the number of frames (existing `MAX_*` style), the number of notes
(proposed 2048), and the modulation bins (proposed 512) so an IPC result stays small.

## M16 — Pitch range + analyzer option integrity (planned)

**Problem.** `pitchYin` and `pitchPyin` call the oxiaudio detectors without an f0
range (`tools/dispatch.rs`), while `pitchAutocorr` and `harmonicRatio` accept
`minF0Hz` / `maxF0Hz`. The GUI MCP path silently accepts unknown option keys, and the
`set_tool_options` description shows snake_case examples (`n_mels`, `yin_threshold`)
while the real keys are camelCase. A caller can therefore set a range that never takes
effect. The shared `freqMinHz` / `freqMaxHz` is documented as applying to pitch, but it is
really a spectral band limit; the docs and the shared-params tooltip are corrected.

One nuance: 75 Hz is already inside pYIN/YIN's 50–2000 Hz and harmonicRatio's old
60–1200 Hz, so a 75 Hz miss is not explained by the range alone; the M16 regression test
pins it. 3 kHz is outside pYIN/YIN and outside the old harmonic-ratio default, which is
why the wide `harmonicRatio` default and range-limited YIN matter.

**Changes.**

- Add `minF0Hz` / `maxF0Hz` params to `pitchYin` and call
  `PitchTracker::new(...).with_threshold(...).with_range(...)`.
- Expose the same `minF0Hz` / `maxF0Hz` options on every pitch-related tool
  (`pitchYin`, `pitchAutocorr`, `harmonicRatio`, and the new note / modulation tools).
  There is no new shared param: `freqMinHz` / `freqMaxHz` stays spectral-only, and each
  tool falls back to its own default when its options are absent.
- Add `effectiveMinF0Hz` / `effectiveMaxF0Hz` to `PitchResult`. pYIN reports the
  intersection of its fixed **50–2000** window with the request; YIN/autocorrelation
  report the resolved range. This makes a clamped pYIN range visible instead of a silent
  lie.
- pYIN: clamp to 50–2000 (and report the effective range). Do **not** fall back to
  another detector silently. The About/empty-state copy says to use YIN or
  autocorrelation above 2 kHz; the UI's existing 50–2000 message is corrected.
- Align `harmonicRatio` defaults with the intended use (proposed **50–4000**) and keep
  the per-tool override.
- Fix option-key handling:
  - canonical camelCase keys, with snake_case aliases accepted at the IPC/headless
    boundary;
  - reject unknown keys in the GUI path with the same clarity the headless path already
    has (`mcp/dispatch/args.rs`);
  - correct the `set_tool_options` / `run_analysis` descriptions to camelCase.
- Add per-tool option metadata (key, label, default, min/max, help) to the analyzer
  catalogs. `list_analyzers` carries a compact option map (keys + defaults); M21's
  `get_analyzer` returns the full labels/ranges/help so an agent can discover keys
  without guessing.

**Tests.** A 75 Hz sine is detected with `minF0Hz: 50`; a 3 kHz sine is detected by
range-limited YIN and by `harmonicRatio` with `maxF0Hz: 4000`; pYIN reports 50–2000;
snake_case aliases work; unknown keys fail; the shared spectral range does not change a
pitch tool's f0 search.

## M17 — Frame-RMS amplitude envelope (planned)

**Problem.** The app has a min/max waveform envelope and window-level peak/RMS, but no
frame-RMS series. `loudnessMomentary` is EBU R128 (K-weighted, 400 ms blocks) and is the
wrong tool for short calls; it is not changed by this milestone.

**Changes.**

- New `frameRms` analyzer under **Time domain**.
- Options: `frameMs` (default 10) and `hopMs` (default 5).
- Returns a `SeriesResult` (values in dBFS) extended with an optional `frameSize` (in
  samples) so the result is self-describing. The existing `SeriesView` and
  `seriesReadouts` render it with no new chart component.
- Available in the GUI, headless MCP, and `hey-listen analyze` through the normal catalog
  and dispatcher.

**Tests.** A half-scale sine reads about −9 dBFS per frame; a silent frame floors at
−120 dBFS; a window shorter than the frame still yields one value; the configured frame
and hop are echoed.

## M18 — Note segmentation, gaps, and per-note level (planned)

**Problem.** `onsets` returns start times only, so note ends, gaps, and note count are
implicit. There is no per-note level or envelope summary.

**Changes.**

- New `noteMetrics` analyzer (the name avoids colliding with project **Notes**).
- Segmentation:
  - frame RMS from the shared helper;
  - gate at `max(gateFloorDb, windowPeakDb − gateDb)` with `hysteresisDb`;
  - merge active runs separated by less than `minGapMs`;
  - drop runs shorter than `minNoteMs`.
- Options: `frameMs` (10), `hopMs` (5), `gateDb` (default 35 dB below the window
  peak), `gateFloorDb` (default −60 dBFS), `hysteresisDb` (3), `minNoteMs` (20),
  `minGapMs` (30), `envelopePoints` (7).
- Result: per-note `startSecs`, `endSecs`, `durationSecs`, `gapBeforeSecs`,
  `gapAfterSecs`, `rmsDb`, `peakDb`, `rmsDbRelLoudest`, `peakDbRelLoudest`, and
  `envelopeDb` (5–7 points at normalized positions). Summary: `noteCount`, `gapCount`,
  `totalGapSecs`, `longestGapSecs`, `medianNoteSecs`, `medianGapSecs`, the reference
  note, and the threshold used. Gaps between notes are also returned explicitly.
  Leading/trailing silence is reflected in the first note's `gapBeforeSecs` and the last
  note's `gapAfterSecs`, but is not counted in `gapCount`.
- New `noteMetrics` table view: summary cards plus a scrollable per-note table. A chart
  overlay/timeline spans can come later.
- MCP note: a long `notes` array of objects is compacted to `{ length }` by default;
  callers use `includeData: true` to read the records. The summary counts make that
  discoverable.

**Result sketch.**

```rust
struct GapMetric { start_secs: f32, end_secs: f32, duration_secs: f32 }

struct NoteMetric {
    start_secs: f32,
    end_secs: f32,
    duration_secs: f32,
    gap_before_secs: f32,
    gap_after_secs: f32,
    rms_db: f32,
    peak_db: f32,
    rms_db_rel_loudest: f32,
    peak_db_rel_loudest: f32,
    envelope_db: Vec<f32>, // length = envelopePoints
    // added by M19:
    voiced_fraction: Option<f32>,
    f0_median_hz: Option<f32>,
    jitter_proxy_cents: Option<f32>,
    shimmer_proxy_db: Option<f32>,
    hnr_proxy: Option<f32>,
}

struct NoteMetricsResult {
    window_start: f64,
    note_count: usize,
    gap_count: usize,
    total_gap_secs: f32,
    longest_gap_secs: f32,
    median_note_secs: f32,
    median_gap_secs: f32,
    threshold_db: f32,
    envelope_positions: Vec<f32>, // 0..1, length = envelopePoints
    reference_note_index: Option<usize>,
    notes: Vec<NoteMetric>,
    gaps: Vec<GapMetric>,
}
```

**Tests.** Tone → gap → tone yields 2 notes, 1 gap, and the right count; a continuous
tone yields 1 note and 0 gaps; a gap shorter than `minGapMs` merges; levels relative to
the loudest note are correct; empty/silent input yields 0 notes.

## M19 — Note voice-quality proxies (planned)

**Problem.** Jitter, shimmer, and HNR are only available by post-processing raw pitch
and level series outside the app.

**Changes.** Extend `noteMetrics` with per-note:

- `jitterProxyCents` — range-limited **YIN** f0 inside the note, converted to cents,
  linearly detrended, and reduced to the population standard deviation of the residual.
  YIN is required: pYIN's semitone bins would impose a large quantization floor.
- `shimmerProxyDb` — population standard deviation of the note's frame RMS in dB.
- `hnrProxy` — mean `harmonic_ratio` over the note, 0–1. Label it as the
  autocorrelation periodicity proxy, not HNR in dB.
- `voicedFraction` and `f0MedianHz` for context.
- Options: `pitchFrameMs` (default 40), `pitchHopMs` (default 5), and the per-tool
  `minF0Hz` / `maxF0Hz`.

The note slice gets its own fine pitch grid, so the global pitch-frame cap does not
force a coarse jitter hop. Short notes with too few voiced frames return `null` for the
affected proxy.

**Tests.** A constant-pitch, constant-amplitude note has near-zero jitter/shimmer; a
vibrato note raises jitter; an AM note raises shimmer; a noisy/unvoiced note lowers the
HNR proxy; short notes return `null` rather than a misleading number.

## M20 — AM/FM modulation spectra (planned)

**Problem.** There is no modulation-spectrum tool. A single rate is not enough: a call
can contain slow breathing (e.g. 3 Hz) and a fast trill (e.g. 40 Hz) at the same time.

**Changes.**

- New `modulation` analyzer under **Spectral**.
- **AM:** frame RMS over the analysis window (`frameMs` 10, `hopMs` 2.5), detrend
  (default linear), Hann window, zero-pad, FFT over `modMinHz`–`modMaxHz`
  (default 0.5–100 Hz). Return the full spectrum and the top `topPeaks` (default 3).
  `amDepth` = `(max − min) / (max + min)` of the linear envelope; also return
  peak-to-trough dB.
- **FM:** range-limited YIN on the **longest voiced run** (bridge short unvoiced gaps;
  require `minVoicedSecs`, default 0.2 s), convert to cents, detrend, FFT on the same
  modulation-frequency grid. Return the run's start/end, `fmRateHz`,
  `fmPeakToPeakCents`, `fmStdCents`, and the top peaks. Returning the run span makes it
  clear what was analyzed.
- Clamp the usable modulation frequency to ~45% of the envelope sample rate to avoid
  aliasing; the result reports the effective range.
- New `modulation` view with two spectra on one x-axis (AM and FM), plus readouts for
  the top rates/depths and the FM run span. Use its own chart-sync group (`mod`), not
  the audio-frequency `freq` group.

**Result sketch.**

```rust
struct ModulationPeak { rate_hz: f32, relative_db: f32, prominence_db: f32 }

struct ModulationResult {
    window_start: f64,
    mod_freqs: Vec<f32>,
    am_db: Vec<f32>,
    fm_db: Vec<f32>,             // empty when no voiced run is long enough
    am_peaks: Vec<ModulationPeak>,
    fm_peaks: Vec<ModulationPeak>,
    am_depth: Option<f32>,
    am_peak_to_trough_db: Option<f32>,
    fm_run_start_secs: Option<f32>,
    fm_run_end_secs: Option<f32>,
    fm_peak_to_peak_cents: Option<f32>,
    fm_std_cents: Option<f32>,
    voiced_fraction: f32,
}
```

**Tests.** A 10 Hz AM sine produces an AM peak near 10 Hz; a 3 Hz AM plus a 40 Hz AM
produces both peaks; a 30 Hz FM sweep produces an FM peak near 30 Hz; a window with no
voiced run returns no FM spectrum; alias clamping is honored.

## Options summary

| Tool | Options (proposed defaults) |
| --- | --- |
| `pitchYin` | `minF0Hz` / `maxF0Hz` (tool default when absent), `yinThreshold` 0.12 |
| `harmonicRatio` | `minF0Hz` 50, `maxF0Hz` 4000 (overridable) |
| `frameRms` | `frameMs` 10, `hopMs` 5 |
| `noteMetrics` | `frameMs` 10, `hopMs` 5, `gateDb` 35, `gateFloorDb` −60, `hysteresisDb` 3, `minNoteMs` 20, `minGapMs` 30, `envelopePoints` 7, `minF0Hz` / `maxF0Hz` |
| `modulation` | `frameMs` 10, `hopMs` 2.5, `modMinHz` 0.5, `modMaxHz` 100, `detrend` 1, `pitchFrameMs` 40, `pitchHopMs` 5, `minVoicedSecs` 0.2, `topPeaks` 3, `minF0Hz` / `maxF0Hz` |

`noteMetrics` gains its pitch options in M19; M18 uses only the RMS/segmentation options.

## Surfaces

- **Sidebar sections:** `frameRms` → **Time domain**, `noteMetrics` → **Pitch / melody**
  (the jitter/shimmer/HNR proxies are voice-quality metrics), `modulation` →
  **Spectral**.
- **GUI:** `frameRms` reuses the series view; `noteMetrics` gets a table view;
  `modulation` gets a two-spectrum view. All three get the standard params/about
  popovers from the registry.
- **MCP:** add the ids to `list_analyzers` (GUI and Rust catalog), expose option
  metadata, and document `includeData` for `noteMetrics` / the full modulation
  spectra. `get_state` already reports tool-option defaults.
- **CLI:** the new ids are available through `hey-listen analyze` automatically once
  they are in the Rust catalog; options use the existing `-o <tool>.<key>=<value>`
  form.
- **Notes:** add `valuesText` cases in `src/state/notes/format.ts` for `noteMetrics` and
  `modulation` (`frameRms` uses the generic series path).

### Where the MCP work lives

MCP ergonomics is split between the generic option mechanism and the cross-cutting
contract:

- **M16 owns the generic mechanism:** option-key normalization/validation, canonical
  camelCase descriptions, compact `list_analyzers` option keys/defaults, and the effective
  f0 range in `PitchResult`.
- **M17–M20 each own their analyzer's MCP surface:** the catalog entry, its option
  metadata, its compaction / `includeData` behavior, the CLI `-o` keys, and the tests
  that pin them.
- **M21 owns the cross-cutting contract:** per-result summaries, result-aware compact
  previews, MCP tool titles/annotations, `get_analyzer`, and the CLI `analyzers <ID>` /
  `--summary` discovery path. It depends on M16's option metadata and can land before or
  after M17–M20. See [`mcp-cli-ergonomics.md`](mcp-cli-ergonomics.md).

## Validation

- Rust unit tests for every behavior above, placed beside the tool modules so
  `tests.rs` stays under the line budget.
- `scripts/notes.test.ts` cases for the new values-line formatters.
- `npm run typecheck`, `npm run build`, `cargo check`, `cargo test`, `npm run maid`.
- Regenerate `src/bindings/**` with `cargo test`; never hand-edit it.
- Optional e2e: render a synthetic AM/FM source with the synth graph, run the three
  tools, and assert the tabs render.

## Risks and deferred work

- Segmentation is heuristic; defaults are starting points, not species-specific
  tuning. Expose the gate/duration options and validate against real clips.
- AM/FM results depend on what the analysis window contains. If the window includes
  silence, the AM spectrum also contains the note/gap pattern; select the call, or add a
  gate/mask (and a per-note modulation option reusing the M18 segments) in a follow-up.
  The FM result reports its run span; the UI should make the window obvious.
- pYIN remains 50–2000 Hz until `oxiaudio` exposes a range; M16 reports the effective
  range and points callers to YIN/autocorrelation.
- A shared **pitch range** control (one setting for every pitch tool) is a UX
  convenience, not part of M16: it can fan out to the per-tool `minF0Hz` / `maxF0Hz`
  options without a schema change. Revisit after M16 if the per-tool settings feel
  repetitive.
- Export of the new results rides M12; the data model is already export-shaped.
