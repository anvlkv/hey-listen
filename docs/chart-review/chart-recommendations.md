# Chart implementation recommendations

This document follows the twelve-item work order in [`chart-review.md`](chart-review.md). The recommendations are grounded in the current SolidJS/uPlot implementation and generated IPC result types. Shared mechanisms should be implemented once and reused; in particular, gaps 1/3 share time synchronization and pitch overlays, gaps 2/4/11 share heatmap scales and colour maps, and gaps 5/6 share frequency-axis transforms and annotations.

## 1. Make `waveform` + `spectrogram` a linked primary diagnostic pair

### Goal

Provide one primary time-aligned diagnostic in which waveform level/transients and spectral content can be inspected together. Preserve the existing shared time zoom, cursor, playhead, selected range, and annotation overlays instead of creating a second synchronization path.

### Where

- `src/components/analyzer/WaveformTab.tsx`: `WaveformTab`, its `data()` columns, and `SolidUplot` `series`/`bands`.
- `src/components/analyzer/SpectrogramTab.tsx`: `SpectrogramTab`, `draw()`, and its controls/readouts.
- `src/components/analyzer/spectrogramRender.ts`: extend `SpectrogramOverlays` and the overlay renderer.
- `src/components/analyzer/syncPlugins.ts`: extend the existing `"time"`-group bus mechanism only if a common selected range is not already represented by annotations.
- `src/state/chartSync.ts`: add a typed selection message beside `view`/`cursorSync` if arbitrary chart drag selections must mirror before becoming an annotation.
- Prefer a new small `src/components/analyzer/SignalDiagnostic.tsx` composition rather than growing either tab beyond the 400-line budget.

### How (concrete)

The current charts already synchronize x ranges through `syncView("time")`, cursor positions through `mirrorCursor("time")`, and playback through `playheadRule()`. Canvas heatmaps already mirror these via `createChartInteraction`, `drawMirrorCursor`, `drawPlayhead`, and `drawAnnotationOverlay`. Reuse those facilities when rendering a stacked pair; do not introduce `uPlot.sync()` in parallel with `analyzerBus`.

Make the waveform half expose distinct peak and RMS tracks. The payload currently has a min/max envelope but only one window-wide RMS scalar, so the first frontend-only step is to retain the min/max band and name it explicitly:

```tsx
series={[
  {},
  { label: "Positive peak", stroke: chartTheme().seriesMax, width: 1 },
  { label: "Negative peak", stroke: chartTheme().seriesMin, width: 1 },
]}
bands={[{ series: [1, 2], fill: chartTheme().waveFill }]}
```

For a real RMS-over-time overlay, add an aligned envelope column and draw it as a third series with its own label. Add a clipping plugin in a shared overlay module that marks buckets where `max >= 1` or `min <= -1`; use a `draw` hook and `u.valToPos()` so the marks respect zoom.

For the spectrogram, extend `SpectrogramOverlays` with an optional pitch track and harmonic multiples. Draw them through the same clipped, haloed path mechanism used by `drawContours()`/`strokeOverRamp()`. Label centroid, rolloff, F0, and harmonics in a compact shared overlay legend rather than relying on colour alone.

If “selected range” means a transient drag rectangle rather than a persisted annotation, add one `SelectionMessageBus` key and a plugin using uPlot’s `setSelect` hook. Publish source seconds and mirror with `u.setSelect({ left, top, width, height }, false)` after converting through `valToPos`; canvas charts should consume the same message in `drawAnnotationOverlay` or a sibling `drawSharedSelection` helper.

### Data required

- Already available: waveform min/max buckets, overall `peakDb`/`rmsDb`; spectrogram `magDb`, frequency bins, time extent; frontend-derived centroid/rolloff; all existing view/cursor/playhead/annotation synchronization.
- Not available: frame-aligned waveform RMS, clipping bucket flags/counts, a pitch track in `SpectrogramResult`, and harmonic positions. Add these Rust-side or compose the primary diagnostic from a concurrently cached `PitchResult`; do not infer F0 from centroid/rolloff.
- A non-persisted shared drag selection is not currently in `AnalyzerBus`; annotations already carry persisted ranges.

### Risk / effort

Medium-to-large. Stacking and synchronization are frontend work, but truthful RMS/F0/harmonic overlays require result composition or Rust payload changes. Split composition and overlay drawing into focused files; do not duplicate the existing bus or chart-image registration.

## 2. Repair and complete `specificLoudness` and `masking`

### Goal

Make both perceptual diagnostics numerically legible and calibrated: a visible ERB/Cam specific-loudness map and a masking plot whose spectrum, thresholds, masked relationship, and SMR can be audited.

### Where

- `src/components/analyzer/MatrixView.tsx`: `image`, `draw`, `drawBands`, and matrix readouts.
- `src/components/analyzer/MaskingView.tsx`: `data()`, `maskedBands`, series configuration, and readouts.
- `src/components/analyzer/FrequencyChart.tsx`: permit labelled multiple scales/axes or a companion panel without duplicating the chart stack.
- `src/components/analyzer/colormap.ts` and a new shared `HeatmapColorScale.tsx`/canvas helper.
- `src/state/analyzer/defs/perception.ts`: `specificLoudness` and `masking` descriptors/options.

### How (concrete)

For `specificLoudness`, do not normalize a near-zero linear range with a hard-coded epsilon and then leave the result unexplained. Add descriptor-driven colour-domain policy (see gap 4), render a visible colourbar, and label the vertical coordinate as ERB rate/Cam while retaining centre-frequency tooltips. Its generated `MatrixResult` already carries `bandEdges`, `unit`, `minValue`, `maxValue`, and calibration fields; use them instead of only `formatValue`.

For masking, keep the spectrum and `Tq`/`Tg` curves in one level panel, but add a separate aligned SMR panel rather than forcing unlike meanings into one y scale. The existing masking fill is a custom stem path; replace or supplement it with an explicit band between adjacent spectrum and threshold series where appropriate:

```tsx
bands={[{ series: [spectrumSeriesIdx, thresholdSeriesIdx], fill: maskedFill }]}
```

A plain uPlot band fills the whole interval, so negative-SMR-only shading still needs gap-masked columns (`null` outside `smrDb < 0`) or a custom `paths` builder. Keep the current `maskedBands` mechanism in a shared masking plugin if sparse vertical indication is preferred.

Render the SMR as a second `SolidUplot` with `[freqs, smrDb]`, fixed `0 dB` `referenceLine`, and synchronized `"freq"` zoom/cursor. Label the primary y-axis dynamically as `level (dB SPL)` when calibrated and `relative level (dB)` when not. Do not display `Tq` as directly comparable in an uncalibrated run; the payload documentation already warns that absolute audibility requires calibration.

Add a visible legend. A wrapper-based option is:

```tsx
const bus = analyzerBus;
<SolidUplot
  pluginBus={bus}
  plugins={[cursor(), tooltip(Tooltip), legend(MaskingLegend, { placement: "top-right" })]}
  /* ... */
/>
```

`FrequencyChart` currently owns its plugin list, so expose a `legend`/`plugins` extension point or a generic overlay slot rather than copying it into `MaskingView`.

### Data required

- Already available: `specificLoudness` matrix values, unit (`sone/Cam`), band centres/edges, calibration; masking `spectrumDb`, `thresholdQuietDb`, `globalMaskDb`, `smrDb`, and calibration.
- Not available: individual tonal/non-tonal masker curves or masker classifications/locations. The review’s “individual maskers” requirement needs a Rust-side addition to `MaskingResult`.
- The existing payload is enough for spectrum, ATH, combined threshold, negative-SMR shading, and a margin panel.

### Risk / effort

Medium for the visible map/colourbar/SMR panel; large if individual masker contributions are added. Calibration semantics are the main correctness risk. Keep `MaskingView.tsx` below budget by extracting the SMR panel and masking overlay plugin.

## 3. Turn pYIN into an auditable pitch view

### Goal

Show pitch estimates against spectral evidence and expose estimator reliability rather than presenting all pitch methods as equally certain point tracks.

### Where

- `src/state/analyzer/types.ts`: extend the pitch view descriptor rather than branching on string prefixes.
- `src/state/analyzer/defs/pitch.ts`: declare reliability/overlay capabilities per detector.
- `src/components/analyzer/SeriesView.tsx`: replace `isPitch(id)` behavior with descriptor fields and render supporting tracks.
- `src/components/analyzer/TimeSeriesChart.tsx`: support multiple aligned y columns and per-series styling, or introduce a focused `PitchDiagnosticView.tsx`.
- `src/components/analyzer/SpectrogramTab.tsx` and `spectrogramRender.ts`: F0/candidate overlays shared with gap 1.
- `src/components/analyzer/seriesPlugins.ts`: improve semitone labels/grid and add reliability threshold rendering.

### How (concrete)

Add declarative fields such as `pitchDisplay?: { confidence: "voicing" | "periodicity" | "none"; spectrogramOverlay: boolean; noteLabels: boolean }` to `SeriesView`, and set them in `defs/pitch.ts`. Do not continue inferring semantics with `id.startsWith("pitch")`.

Use separate scales for Hz and confidence when both are present:

```tsx
series={[
  {},
  { label: "f0", scale: "f0", stroke: chartTheme().series, points: { show: true, size: 4 } },
  { label: "Voicing probability", scale: "confidence", stroke: chartTheme().seriesMax },
]}
scales={{
  x: { time: false },
  f0: { distr: 3, log: 10, range: logYRange },
  confidence: { auto: false, range: [0, 1] },
}}
axes={[
  timeAxis,
  { ...pitchAxis, scale: "f0", label: "f0 (Hz / note)" },
  { ...confidenceAxis, scale: "confidence", side: 1, label: "confidence", grid: { show: false } },
]}
```

Draw a confidence threshold with a generalized `referenceLine({ scale: "confidence", ... })`; the current helper is hard-coded to `"y"`. For note context, make `semitoneGrid` draw all visible semitone rules at sufficient zoom and label octave Cs (or adapt `frequencyAxisValues` to return note name plus Hz). Avoid spline interpolation; retain null gaps and points.

For pYIN candidate ambiguity, use a second matrix/canvas layer only when candidate probabilities exist. It should be time × candidate-frequency with probability as colour, sharing the heatmap colour-scale helper from gap 4.

### Data required

- Already available: per-frame f0 gaps, effective search range, `voicedFrames`, `voicedFraction`, and window-level `f0Reliable`.
- Not available: per-frame pYIN voicing probability, confidence, decision threshold, candidate frequencies/probabilities, octave-ambiguity flags, and analogous per-frame YIN/autocorrelation reliability. These require Rust analyzer/result changes.
- The current `voicedFraction` is a window summary and must not be plotted as a per-frame confidence track.

### Risk / effort

Large because the central reliability requirements are absent from `PitchResult`. Descriptor/refactor work is moderate. Keep candidate rendering separate from generic `SeriesView` so ordinary scalar tools remain simple.

## 4. Add colour scales and complete labels to every matrix

### Goal

Give every heatmap a declared value domain, unit, and model/axis meaning, with a colourbar that uses exactly the same mapping as the pixels.

### Where

- `src/state/analyzer/types.ts`: `MatrixView` fields.
- `src/state/analyzer/defs/spectralFrames.ts`, `spectralSeries.ts`, and `perception.ts`: per-tool colour/axis declarations.
- `src/components/analyzer/MatrixView.tsx`: image domain, colourbar, complete band labels, and readouts.
- `src/components/analyzer/SpectrogramTab.tsx`: dB colourbar tied to `maxDb - dbRange … maxDb`.
- `src/components/analyzer/colormap.ts`: shared ramp sampling.
- New shared `heatmapScale.ts` and `HeatmapColorScale.tsx` rather than separate matrix/spectrogram implementations.

### How (concrete)

Extend `MatrixView` with data semantics, not arbitrary per-tool rendering callbacks:

```ts
interface MatrixView {
  // existing fields...
  valueLabel: string;
  colorDomain?: "result" | "symmetric" | { min: number; max: number };
  colorTransform?: "linear" | "log1p";
  axisModel?: string;
  labelEveryBand?: boolean;
}
```

Resolve one `HeatmapScale` object (`min`, `max`, transform, formatter, stops) and pass it to both `buildHeatmapImage()` and the colourbar. MFCC should use a zero-centred symmetric diverging map because coefficients are signed; energy/loudness maps should use sequential maps. Chromagram should declare whether values are raw energy or normalized chroma rather than implying a universal 0–1 range.

For the spectrogram, the colourbar endpoints are already known:

```ts
const colorMin = result.maxDb - dbRange();
const colorMax = result.maxDb;
```

Render ticks from those exact values and label `dBFS`. For matrices, prefer `result.unit` from generated `MatrixResult`; use the descriptor only for model/axis copy and unitless matrices.

Replace the fixed five-row loop in `drawBands()` with density-aware labels. `chromagram` has only twelve rows and should draw all pitch classes when height permits. `spectralContrast` needs actual octave centres/bounds rather than `band 1…N`.

### Data required

- Already available: every matrix’s min/max, values, bands, optional band edges, unit, and calibration; spectrogram min/max dB and selected display range.
- Not available: octave-band centres/bounds for `spectralContrast` (`bandEdges` is documented as absent for contrast), explicit normalization metadata for chroma/Mel/MFCC, and a model identifier in `MatrixResult`. Add Rust metadata or make invariant model labels descriptor-owned.

### Risk / effort

Medium. Most work is frontend/shared plumbing; spectral-contrast labels need a payload change. A diverging MFCC map may require extending theme files beyond one sequential `colormap`, so preserve theme import compatibility.

## 5. Provide frequency-scale controls on `spectrum` and `spectrogram`

### Goal

Offer physical linear/log Hz and auditory Bark/ERB coordinates without duplicating analyzer tabs or mislabelling transformed positions as Hz.

### Where

- `src/state/analyzer/defs/spectralFrames.ts`: replace/extend `logFreq` with one view-only scale selector and optional boundary toggle.
- `src/components/analyzer/FrequencyChart.tsx`: generalized x-coordinate transform and axis formatter.
- `src/components/analyzer/SpectrumTab.tsx`: transform the x column and peak/boundary overlays.
- `src/components/analyzer/SpectrogramTab.tsx`, `spectrogramRender.ts`: transformed vertical coordinate, picking, axis labels, and image sampling.
- `src/components/analyzer/axisFormat.ts`: Bark/ERB tick formatters.
- A shared `frequencyScale.ts` containing forward/inverse conversions and labels.

### How (concrete)

Represent the mode as a typed frontend union (`"linearHz" | "logHz" | "bark" | "erb"`) in component code while the existing numeric `ToolParamField` select remains the persisted boundary value. Transform values before passing them to uPlot; uPlot’s `distr: 3` only implements logarithmic numeric spacing, not Bark/ERB.

For log Hz:

```ts
scales: { x: { time: false, distr: 3, log: 10, range: logXRange } }
```

For Bark/ERB, pass transformed x values and use `distr: 1`; axis `values` should format Bark/ERB units, while tooltips invert the coordinate to report both scale position and Hz. `AxisTransform` in `syncPlugins.ts` already supports conversion to a shared bus coordinate—use `toBus = inverseToHz`, `fromBus = forwardFromHz` so spectrum charts in different modes still synchronize on physical Hz.

Canvas spectrograms need the same transform in `drawFrequencyAxis`, pointer picking, zoom clamping, contour placement, and source-row selection. Because FFT rows are uniform in Hz but not in Bark/ERB/log Hz, a simple rectangular `drawImage` stretch is not correct; resample rows into an offscreen image in display coordinates or draw row strips with transformed boundaries.

Band boundaries should be a shared overlay helper fed by octave/Bark/ERB edge values, theme grid roles, and a toggle.

### Data required

- Already available: physical Hz bin centres and limits for spectrum/spectrogram; transforms and standard auditory edges can be computed in the frontend.
- Not available: analyzer-specific critical-band integration edges on these physical views. If boundaries are merely reference guides, frontend formulas suffice; if they must exactly match `criticalBands`, expose/reuse the same Rust model parameters/edges.

### Risk / effort

Medium for spectrum; large for spectrogram because non-linear row resampling and hit-testing must agree. Test cursor inversion and zoom synchronization carefully.

## 6. Make `spectrum` explanatory

### Goal

Identify each spectrum statistic and annotate physically meaningful peaks, F0/harmonics, and optional frequency bands.

### Where

- `src/components/analyzer/SpectrumTab.tsx`: `LAYERS`, data columns, overlays, and readouts.
- `src/components/analyzer/FrequencyChart.tsx`: legend and plugin extension points.
- New `src/components/analyzer/frequencyOverlays.ts`: peak labels, harmonics, and band boundaries shared with gaps 1/5.
- `src/state/analyzer/defs/spectralFrames.ts`: toggles for peaks/harmonics/bands.

### How (concrete)

Expose the existing `LAYERS` through a shared Solid legend. The wrapper disables uPlot’s native legend, so use `legend(Component, options)` with `cursor()` and the common plugin bus, or a reusable DOM legend outside the canvas. Do not reproduce the manual swatches from `ModulationView.tsx`.

Draw peak/harmonic labels in a plugin `draw` hook. Convert values using `u.valToPos(freq, "x", true)` and `u.valToPos(db, "y", true)`, clip to `u.bbox`, and run a simple label-spacing pass to prevent overlap. Peak detection should operate on linear power or dB local maxima with a prominence/min-distance criterion—not label every FFT-bin fluctuation.

Use `uPlot.paths.linear()` for traces and retain the current dash/width distinction. If min/max are intended as an uncertainty envelope, add a band between their adjacent columns:

```tsx
bands={[{ series: [minSeriesIdx, maxSeriesIdx], fill: chartTheme().waveFill }]}
```

Keep the mean drawn last as it is now.

### Data required

- Already available: mean/min/max arrays, strongest-bin `peakHz`/`peakDb`, FFT metadata.
- Frontend-derivable: local spectral peaks from `magDb`; octave/Bark/ERB guides.
- Not available: F0, harmonic assignments, prominence/confidence, or per-peak tonal classification. For trustworthy harmonic labels, compose with a pitch result for the same window/settings or add these fields to `SpectrumResult`.

### Risk / effort

Small for legend and min/max band; medium for peak labels; larger for trustworthy F0/harmonics. Keep peak detection outside the component and avoid duplicating masking’s tonal-line detector if Rust already owns that definition.

## 7. Add contribution drill-downs for psychoacoustics

### Goal

Pair aggregate sharpness, roughness, fluctuation strength, and tonality timelines with the frequency/rate contributions that produce each value.

### Where

- `src/state/analyzer/types.ts`: add explicit contribution-capable view descriptors or new result/view variants; do not overload generic `SeriesResult` invisibly.
- `src/state/analyzer/defs/perception.ts`: declare supporting panels and model labels.
- `src/components/analyzer/SeriesView.tsx`: dispatch to a composed psychoacoustic view when contribution payloads exist.
- Reuse `MatrixView.tsx`, `FrequencyChart.tsx`, `ModulationView.tsx`, heatmap scales, and frequency overlays rather than cloning chart stacks.
- Rust analyzer result types and generated bindings for all contribution arrays.

### How (concrete)

Use a two-panel view: the existing aggregate timeline on top and a contribution panel below that follows the shared cursor time. Selecting/hovering a frame should choose the contribution slice for that frame; keep zoom on the `"time"` group while the supporting frequency/rate panel uses `"freq"` or `"mod"` as appropriate.

- Sharpness: specific loudness by ERB/Cam, multiplied by the model’s sharpness weighting; shade the high-ERB region and show the weighted numerator contribution.
- Roughness/fluctuation: modulation strength by auditory band and modulation rate, with the model-sensitive region (about the implemented 70 Hz or 4 Hz weighting) drawn as a labelled reference region—not a generic hard-coded claim.
- Tonality: tonal prominence/TNR or tonal-bin contribution spectrum, with detected tonal peaks marked using the shared frequency-overlay helper.

For a 1-D supporting curve, uPlot bands can show a sensitive interval and `referenceLine` can show 4 Hz/70 Hz after generalizing its scale/orientation. For 2-D band × modulation-rate data, use the shared heatmap canvas/colourbar rather than forcing it into aligned uPlot series.

### Data required

- Already available: only aggregate timelines in `SeriesResult`; `specificLoudness` exists as a separate full-window matrix analyzer, and `ModulationResult` contains whole-window AM/FM spectra. These are useful context but are not per-frame contribution payloads for sharpness/roughness/fluctuation.
- Not available: sharpness weighting/contribution arrays, per-band/per-rate roughness and fluctuation contributions, tonal prominence/TNR spectra, and tonal peak metadata. All require Rust-side additions.

### Risk / effort

Large, data-shape-heavy work. Define one reusable contribution result schema where mathematically valid, but do not flatten unlike models into an ambiguous generic array. This likely warrants multiple small renderer files to stay under budget.

## 8. Make loudness self-describing

### Goal

Expose the model, calibration, phon context, distribution statistics, and optional physical-level comparator needed to interpret both perceptual loudness and momentary LUFS.

### Where

- `src/components/analyzer/LoudnessView.tsx`: `data()`, `readouts()`, and `TimeSeriesChart` configuration.
- `src/components/analyzer/SeriesView.tsx`: momentary-loudness contextual readouts.
- `src/state/analyzer/defs/loudness.ts` and `defs/perception.ts`: model/window/reference copy and display controls.
- `src/components/analyzer/TimeSeriesChart.tsx`: multiple scales/series if sone + phon or RMS/SPL are plotted together.

### How (concrete)

`LoudnessResult` already supplies aligned `loudnessSone` and `loudnessPhon`. Plot either with a view toggle or both on separate y scales; do not place phon and sone on one unnamed scale. Add N5/N50/N95, mean, and max readouts from the returned arrays, with correct percentile definitions. The current `n5()` title says “exceeded 95% of the time,” but its descending 5th-percentile index corresponds to a level exceeded about 5% of the time; correct the title while adding the other percentiles.

Add model/calibration badges/readouts directly in the view: “Moore–Glasberg / ISO 532-2 family approximation,” calibrated dB SPL value or “relative/uncalibrated.” For `loudnessMomentary`, display the active `windowMs` semantics beside the chart and label the −14 LUFS line as a streaming reference, not a universal target.

A dual-axis chart should assign explicit scales:

```tsx
series={[
  {},
  { label: "Loudness", scale: "sone", stroke: chartTheme().series },
  { label: "Loudness level", scale: "phon", stroke: chartTheme().seriesMax },
]}
axes={[
  timeAxis,
  { ...soneAxis, scale: "sone", label: "loudness (sone)" },
  { ...phonAxis, scale: "phon", side: 1, label: "loudness level (phon)", grid: { show: false } },
]}
```

### Data required

- Already available: sone and phon tracks, calibration fields, and enough values to compute N5/N50/N95/mean/max frontend-side; active momentary window option is in the tool store.
- Not available: aligned RMS/SPL comparator in `LoudnessResult`, explicit standard/model/version fields, and engine-provided percentile summaries. RMS can be composed from `frameRms` only if frame/hop grids are aligned; otherwise add it Rust-side.

### Risk / effort

Small-to-medium for truthful labels, percentiles, and phon display; medium for a comparator. Avoid duplicating percentile helpers—extract and test them.

## 9. Clarify rhythm and modulation encodings

### Goal

Make every marker, secondary panel, modulation spectrum, sensitive region, and selected peak understandable without memorizing theme colours.

### Where

- `src/components/analyzer/RhythmView.tsx`: `MarkerSet`, `rhythmMarkers`, tempogram panel, and legends.
- `src/components/analyzer/ModulationView.tsx`: existing legend, peak labels, sensitive-region overlays, and fill/grid styling.
- `src/components/analyzer/modulationCommon.ts`: shared units/ranges/formatters.
- New shared `ChartSeriesLegend.tsx` or the solid-uplot `legend` plugin; do not keep multiple swatch implementations.
- `src/state/analyzer/defs/rhythm.ts` and `defs/modulation.ts`: threshold/model display metadata.

### How (concrete)

Carry marker `kind`/label in `MarkerSet`, and render one shared legend from `config().markers`. The marker plugin should remain one draw hook, but use a legend to map onset/beat/downbeat to the current theme. Label the tempogram “Tempo salience (autocorrelation)” and its chosen BPM marker; its axes already correctly say BPM/salience.

For modulation, keep AM and FM labels but replace the large AM fill with a low-alpha theme role or line-only default. Draw labelled peak markers from existing `amPeaks`/`fmPeaks`. Add a reusable vertical-region plugin using `u.valToPos()` and a `drawClear` or `draw` hook; preserve canvas state with `save()`/`restore()`. The region definitions should match the implemented model and be described as reference/sensitivity regions, not hard decision boundaries.

Use the wrapper legend correctly:

```tsx
plugins={[
  cursor(),
  tooltip(ModulationTooltip),
  legend(ModulationLegend, { placement: "top-right", pxOffset: 8 }),
  mirrorCursor(MOD_GROUP),
  syncView(MOD_GROUP),
]}
```

`legend()` requires the existing `pluginBus={analyzerBus}` and is overlaid on `u.over`.

### Data required

- Already available: event times, BPM/confidence, onset envelope, AM/FM spectra, ranked AM/FM peaks, depths, reliability, and effective modulation range.
- Not available: per-onset threshold/confidence and the threshold curve/value that produced onset events; add these to `RhythmResult` for truthful threshold disclosure.
- Sensitive reference regions can be descriptor/model constants if they accurately reflect the implemented analyzers.

### Risk / effort

Small-to-medium frontend work; rhythm confidence/threshold is a Rust payload change. Extract the legend and region plugins to avoid duplicating manual canvas and DOM code.

## 10. Rework `noteMetrics` at this canvas size

### Goal

Give detected musical-note spans enough vertical space and simplify the competing level/f0 encodings so boundaries, durations, and pitch context remain readable in ordinary Workbench sizes.

### Where

- `src/components/analyzer/NoteSegmentChart.tsx`: series/scales/axes and `noteSegments()` plugin wiring.
- `src/components/analyzer/noteSegmentPlugins.ts`: note boundaries, labels, and duration placement.
- `src/styles/noteMetrics.css`: `.note-segments-chart` sizing.
- `src/lib/noteSegments.ts`: current summarized envelope/f0 columns.
- `src/components/analyzer/seriesPlugins.ts`: reusable musical-note grid/labels.

### How (concrete)

Increase `.note-segments-chart` from `flex: 0 0 36%; min-height: 150px; max-height: 280px` to a responsive minimum that can hold legend + axes + plot, and let the user/table split retain enough height. Prefer a minimum around 220–260 px and a larger max, verified in the smallest supported Workbench size.

Simplify the main chart to level/envelope + clear segment boundaries. Move median f0 to either (a) a dedicated aligned pitch lane or (b) a mode toggle, instead of a right-hand scale competing with dBFS in a short plot. If retained, make the f0 scale logarithmic and add semitone context:

```tsx
scales={{
  x: { time: false },
  y: { range: levelRange },
  f0: { distr: 3, log: 10, range: logYRange },
}}
```

Label segment start/end with boundary rules; show duration inside a block only when pixel width is sufficient, otherwise leave it to the tooltip/table. Use MIDI/note-name labels for octave Cs and retain Hz in the tooltip. Avoid drawing every envelope point/label at narrow widths.

### Data required

- Already available: note spans, durations, gaps, per-note median f0, voiced fraction, level envelope, RMS/peak, gate, and reference note.
- Not available: a per-frame note pitch trajectory or pitch class/cents deviation. Median f0 is enough for a note label/grid position but must not be presented as a continuous pitch track.

### Risk / effort

Medium, primarily layout and encoding simplification. CSS changes affect the table/chart split, so validate narrow and tall tabs. Keep note (musical) terminology unchanged.

## 11. Improve light-theme heatmap and grid contrast

### Goal

Ensure low-energy heatmap structure, overlays, grids, and reference rules remain distinguishable in both base themes without changing the numerical mapping between chart and colourbar.

### Where

- `src/components/analyzer/colormap.ts`: ramp interpolation/API.
- `src/state/themes/basePalettes.ts` and theme file schema: light/dark stops and any added heatmap roles.
- Shared colourbar from gap 4.
- `src/components/analyzer/chartCommon.tsx`: `chartAxisStyle()` grid hierarchy.
- `src/components/analyzer/ModulationView.tsx`: AM fill and grid balance.
- `src/components/analyzer/chartCanvas.ts`: existing `strokeOverRamp` and heatmap pixel construction.

### How (concrete)

Replace the light ramp’s “low values melt into the light background” objective with a perceptually ordered ramp whose lowest rendered value is still distinguishable from the plot background. Keep one normalized sampler in `colormap.ts`, but allow a sequential and diverging ramp (MFCC) and expose the same stops to the colourbar.

Do not solve visibility by changing `minValue`/`maxValue` independently per component. The colourbar and pixels must share the exact `HeatmapScale` from gap 4. Add a small checker/contrast test that samples endpoints and overlay colours against each base plot background.

Reduce grid dominance through theme roles rather than component hard-coding. `chartAxisStyle()` can return lower-alpha/fainter grid strokes, while axis/tick strokes remain stronger. Remove or reduce `waveFill` for modulation AM in light mode; line contrast should carry identity. Continue using `strokeOverRamp()` halos for spectrogram overlays and apply the same helper to F0/harmonics.

### Data required

No analyzer payload changes. Theme colormap stops and chart roles are sufficient.

### Risk / effort

Medium because theme-file compatibility and all heatmaps are affected. Add defaults for new theme fields and test bundled/custom themes. Coordinate this with gap 4 so the ramp is not revised twice.

## 12. Make aggregate feature timelines explicit about scale and sampling

### Goal

Distinguish measured frame samples from visual continuity, explain bounded ratios, and provide a route from aggregate spectral features to the source spectrum that produced them.

### Where

- `src/state/analyzer/types.ts`: `SeriesView` descriptor fields.
- `src/state/analyzer/view.ts`: `series(...)` helper wiring.
- `src/state/analyzer/defs/time.ts`, `spectralSeries.ts`, `loudness.ts`, and `perception.ts`: per-tool sampling/scale declarations.
- `src/components/analyzer/SeriesView.tsx`: context/readouts and contribution links.
- `src/components/analyzer/TimeSeriesChart.tsx`: series paths, points, gaps, and optional sample-width rendering.
- `src/components/analyzer/chartCommon.tsx`: shared sampling/model label component or tooltip content.

### How (concrete)

Add descriptor metadata such as:

```ts
interface SeriesView {
  // existing fields...
  sampling?: "frame-centre" | "block" | "step";
  boundedMeaning?: string;
  supportingTool?: AnalyzerId;
  fill?: boolean;
}
```

Wire it through `series()` and use it to select honest paths: frame-centre measures default to `uPlot.paths.linear()` with visible points when sparse; block measures use `uPlot.paths.stepped({ align: 1 })`; event-like change scores remain stems. Set `spanGaps: false` explicitly so gated/null frames are never connected.

Do not area-fill centroid/rolloff/bandwidth merely because they are non-negative. Reserve area for quantities where accumulation from a meaningful baseline is intended. Add a frame/hop readout from `SeriesResult.hopSize` and optional `frameSize`, and label bounded scales with their physical/statistical meaning (for example, flatness 0 = tonal/1 = noise-like; harmonic ratio = normalized autocorrelation, not generic percent normalization).

A `supportingTool` action can open/focus `spectrum` or `spectrogram` and preserve the shared cursor/window. The actual contribution drill-down remains gap 7; this link is a low-cost truthful bridge for centroid/rolloff/bandwidth/flatness/harmonic ratio.

### Data required

- Already available: frame times, hop size, optional RMS frame size, gaps/gate metadata, descriptor explanations, and synchronized chart cursor/window.
- Not available: per-frame underlying spectra in `SeriesResult`, per-frame rolloff/centroid contribution arrays, and direct source-frame identifiers. Opening the separate spectrum shows a window aggregate, not the exact hovered frame; an exact drill-down requires Rust-side per-frame spectral access or a transient frame-window analysis request.

### Risk / effort

Small for descriptor fields, path/fill corrections, sampling labels, and supporting-tool links; large for exact hovered-frame spectra. Keep generic chart behavior descriptor-driven and avoid per-analyzer conditionals in `TimeSeriesChart.tsx`.
