# Milestone proposal — informative, telling charts

**Status:** proposal (not started). **Proposed id:** `M36`.
**Inputs:** [`chart-review.md`](chart-review.md) (visual evaluation against the ideation
doc), [`chart-recommendations.md`](chart-recommendations.md) (code-level how-to),
[`manifest.md`](manifest.md), and the captured screenshots in [`shots/`](shots/).

## Why this milestone

The ideation document (`../improved-charts-ideation.md`) treats visualisation as part of
the analysis, not a display layer. The visual review found the current charts are
**structurally sound but not yet "telling"**: they show *that* a value changed, not *why*,
and several perceptual charts (`specificLoudness`, `masking`) are effectively blank or
misleading on the standard fixture. This milestone closes that gap with a small number of
shared mechanisms rather than per-chart one-offs.

The review's 12-item gap list is the scope; the recommendations doc turns each into a
concrete change. Nothing here adds new analyzers — it makes the 38 that exist (see
`AnalyzerId`) explain their results.

## Scope

Make every analyzer chart **truthful** (units, model, calibration, uncertainty),
**inspectable** (contribution drill-downs and overlays), and **legible** (colour scales,
labels, theme contrast). The work is ordered by the review's priority list; the
recommendations doc is the implementation reference and is **linked, not restated** here.

### Non-goals

- No new analyzers or analysis math. Where an overlay needs data the engine does not
  produce (frame-aligned RMS, pitch-on-spectrogram, harmonic positions, masking maskers),
  the recommendation lists the Rust-side addition; otherwise it is pure frontend.
- No second synchronization path. Reuse the existing `syncView("time")` /
  `mirrorCursor("time")` / `playheadRule()` / annotation overlays.
- No layout changes to the fixed regions (Timeline, Sidebar, Workbench, Source,
  Annotations). Chart work stays inside the analyzer tabs.

## Phases

Each phase is self-contained and committable; later phases reuse the helpers the earlier
ones extract.

### Phase 1 — Primary diagnostic + shared coordinates

Covers recommendation items **1, 5, 6**.

- Stack `waveform` + `spectrogram` as a linked primary pair, keep peak/RMS distinction,
  add a clipping marker, and put F0/harmonics on the spectrogram (reusing the existing
  haloed overlay renderer).
- Add frequency-scale controls to `spectrum` / `spectrogram` (log-Hz default, linear
  Hz/Bark/ERB where appropriate, optional band boundaries).
- Make `spectrum` explanatory: label mean/min/max traces, detect and label peaks, mark F0
  and harmonic positions, optional octave/Bark/ERB bands.

### Phase 2 — Perceptual truthfulness

Covers items **2, 3, 8**.

- Repair `specificLoudness` (visible ERB/Cam map, unit/colour scale) and `masking`
  (spectrum, ATH, individual + combined maskers, shaded threshold relationship, SMR
  margin, calibration labels).
- Turn pYIN into an auditable pitch view: F0 over the log-frequency spectrogram, a
  voicing/confidence track with threshold, semitone/note grid, and ambiguity disclosure;
  give YIN / autocorrelation the same reliability disclosure.
- Make `loudness` self-describing (model/calibration, phon context, overall/max/N5/N50/N95,
  optional RMS/SPL comparison) and state `loudnessMomentary`'s measurement window/model.

### Phase 3 — Psychoacoustic inspectability

Covers item **7**.

- Sharpness gets specific-loudness + weighting function + high-Bark shading.
- Roughness / fluctuation strength get modulation-strength contributions, sensitive
  regions, and peak/4 Hz annotations.
- Tonality gets a tonal-prominence/TNR spectrum and marked tonal peaks.

### Phase 4 — Legibility and encodings

Covers items **4, 9, 10, 11, 12, 13, 14**.

- Declare colour scale, value unit and range for every matrix heatmap; label octave bands
  and all pitch classes at usable zoom.
- Label onset/beat/downbeat marker types and thresholds; give the shallow BPM canvases a
  legend/result label; label AM vs FM, modulation units, sensitive regions and peaks.
- Rework `noteMetrics` at the default canvas size (height, dual-axis clarity, pitch/semitone
  context, note boundaries/durations).
- Tune the light-theme heatmap colour map and grid contrast; verify reference-line contrast.
- Make aggregate feature timelines explicit about sampling (frame samples vs filled
  continuity) and bounded-ratio meaning, and link them to their spectra.
- Make chart gutters, stacked-panel gaps, and Workbench tab chrome compact at the baseline
  UI scale, with semantic spacing tokens that grow proportionally at larger UI scales.

## Validation

- The full quality gate stays green: `npm run typecheck`, `npm run build`, `cargo check`
  in `src-tauri/`, and `npm run maid` (prettier, eslint, 400-line budget, jscpd, knip,
  Rust fmt + clippy). Shared overlay/plugin/colour-map helpers are extracted once — the
  no-duplication gate is a ratchet, so shared mechanisms go through
  `chartCommon.tsx` / `seriesPlugins.ts` / `colormap.ts` / `syncPlugins.ts` /
  `chartImage.ts` rather than being copied.
- Re-capture the chart matrix (dark + light, the deterministic fixture) with the same
  preview loop used to produce this review, and confirm each gap item's visual evidence is
  now present. A `spatial` result still needs a stereo fixture; see the follow-up below.

## Follow-ups surfaced by this review (own the fixture, not the milestone)

- `src/preview/fixtures/analysis.json` was **stale** — 29 tools, missing the nine
  perception analyzers. It has been regenerated to 37 tools (the deterministic 4 s mono
  fixture); `spatial` is stereo-only and correctly excluded. Re-run
  `npm run lighthouse:fixtures` after any engine/result-shape change.
- `scripts/lighthouse/generate-fixtures.ts` previously **aborted** on the mono fixture:
  the CLI's `--all` includes stereo-only `spatial`, which exits non-zero. It now derives the
  catalog from `hey-listen-cli analyzers --json`, excludes the stereo-only `spatial`, runs
  `-t` per remaining tool, and asserts every requested tool wrote a result — so a *real*
  failure still aborts loudly. Re-run `npm run lighthouse:fixtures` after any
  engine/result-shape change.

## Dependencies and fit

- Fits after the delivered `M26–M31` psychoacoustic analyzers (the charts being repaired
  are those tools) and is independent of `M22`/`M23`/`M24` (synth, timeline ergonomics,
  keyboard) and `M34`/`M35` (docs, landing page). It can be scheduled without waiting on
  those; Phases 2–3 overlap the psychoacoustic work already delivered, and Phase 1's
  shared-coordinate work also benefits the planned timeline ergonomics in `M23`.
