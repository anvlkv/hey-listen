# Analysis: psychoacoustics — loudness, sharpness, roughness, tonality, masking, spatial

Design for **M26–M31**, the perceptual-analysis track that layers a set of model-based
descriptors on top of the existing signal features. The reference material (libraries,
equations, and model recommendations) is collected in
[`psychoacoustics-references.md`](psychoacoustics-references.md); this doc turns it into a
milestone plan that matches the engine's existing contracts.

Psychoacoustic analysis answers a different question from the physical tools in
[`analysis-tools.md`](analysis-tools.md): instead of "what frequencies are present", it
asks "how loud / bright / rough / tonal / spacious does this seem to a listener". The
two are not interchangeable — spectral centroid is a physical descriptor, sharpness is a
perceptual model — so this track adds a **Perception** section, not new spectral
features.

The milestones are ordered so each is a self-contained, testable unit:

| Perceptual question | Milestone | Delivered by |
| --- | --- | --- |
| What is the energy in each critical band? | **M26** | Bark + ERB scales; `criticalBands` band-energy matrix |
| How loud does it seem? | **M27** | `loudness` (sone/phon series) + `specificLoudness` map (ISO 532-2) |
| How bright does it seem? | **M28** | `sharpness` (acum series, DIN 45692) |
| How rough / pulsing does it seem? | **M29** | `roughness` (asper) + `fluctuationStrength` (vacil) |
| What is masked, and how tonal is it? | **M30** | `masking` (ATH + SMR overlay) + `tonality` (tonal-energy ratio) |
| How loud is it per frequency, and how wide is it? | **M31** | ISO 226 contour overlay + `spatial` (mid/side + correlation) |

Dependency order: **M26 → M27 → M28** (sharpness needs specific loudness); **M29** and
**M30** each need only M26 and can ship in either order; **M31** needs M26 for the band
basis and M27 only for the contour-overlay comparison.

## Goal

Make the engine able to answer, reproducibly and through every surface (GUI, MCP, batch
CLI):

- What is the critical-band energy, and how does the perceptually weighted spectrum
  differ from the linear one?
- How loud is the window (sone/phon), and where is that loudness concentrated
  (specific loudness over ERB bands)?
- How sharp, rough, or fluctuating is the sound, and how tonal / masked is it?
- How does the measured spectrum sit against an equal-loudness contour, and what is the
  stereo structure (mid/side, inter-channel correlation)?

## Scope and constraints

- **In this repo:** new analyzers, the `audio/analysis/psychoacoustics/` Rust modules,
  result types, chart views, option metadata, MCP/CLI catalog entries, docs, and tests.
- **Not in this repo:** machine-learning perceptual models; the purchased normative
  tables and conformance procedures behind ISO 532 / DIN 45692 / ISO 226. This track
  implements the **published approximations** and labels conformance honestly. No fork
  of `oxiaudio`: psychoacoustics is a new layer that consumes its STFT / envelope output.
- **Calibration honesty.** The engine analyses a window in **dBFS**; perceptual models
  are defined in **dB SPL**. Each loudness-family tool therefore takes a per-tool
  `calibrationDbSpl` option — the dB SPL a full-scale sine corresponds to. `0` (the
  default) means **uncalibrated**, and the summary labels the result so; a value such as
  `94` turns the dBFS axis into an absolute SPL axis before the model runs. There is no
  magic reference level.
- **No project-file schema break.** Calibration and every psychoacoustic parameter are
  per-tool options in the existing `tool_options` map (`tool id → key → number`); nothing
  is added to `SharedParams` (which is `postcard`-encoded and would need a format bump).
  The shared `freqMinHz` / `freqMaxHz` keep their existing meaning as a **spectral band
  limit** applied to the STFT the psychoacoustic tools consume.
- **Results are not persisted yet** (`RESULTS` is written empty), so new
  `AnalysisResult` variants need no container change; they regenerate
  `src/bindings/**` via `cargo test`.
- **Models are named, not invented.** Loudness commits to **ISO 532-2 (Moore–Glasberg,
  stationary)**, sharpness to **DIN 45692**, roughness to a **Daniel–Weber**-style model,
  fluctuation strength to the **Osses–García–Kohlrausch (2016)** family, masking to an
  **MPEG-style** tonal/non-tonal spread, and contours to **ISO 226** tabulated data. The
  tonality ratio and the stereo cues are **physical proxies**, labelled as such, not
  standardized perceptual metrics. No "perceptual score" is assembled from these.
- **Stereo is a deliberate exception.** Spatial cues need the pre-selection stereo pair;
  every other tool conditions to the chosen channel/mono mixdown first. `spatial` reads
  `Left` and `Right` before the channel param is applied (documented in its about copy),
  and returns no result for a mono source.
- **Keep the maid green:** new Rust and frontend modules stay under the 400-line budget,
  reuse the existing STFT / frame-RMS / chart helpers, and add no duplicate logic.

## Shared building blocks

`audio/analysis/psychoacoustics/` (each file small enough to read):

- `scales.rs` — Bark and ERB conversions, both directions, plus the ERB-rate (Cam) scale:

  ```
  ERB_N(f)  = 24.7 * (1 + 0.00437 f)              // Hz
  E(f)      = 21.4 * log10(1 + 0.00437 f)         // Cam
  f(E)      = (10^(E / 21.4) - 1) / 0.00437       // Hz
  z(f)      = 13 atan(0.00076 f) + 3.5 atan((f/7500)^2)   // Bark
  ```

  Bark and ERB are **not interchangeable**; each model names which one it uses. ERB is
  the Moore–Glasberg axis; Bark is the Zwicker / MPEG-style axis.

- `threshold.rs` — absolute threshold of hearing (dB SPL):

  ```
  Tq(f) = 3.64 (f/1000)^-0.8 - 6.5 e^(-0.6 (f/1000 - 3.3)^2) + 1e-3 (f/1000)^4
  ```

  An empirical approximation, not a full hearing model; it assumes a quiet context and
  no individual differences.

- `bands.rs` — `critical_band_energies(magnitudes, freqs, scale) -> (centers, edges,
  energies_db)` integrates STFT magnitude into Bark or ERB bands (sum of power per band,
  converted back to dBFS, or dB SPL when calibrated). Shared by every later tool.

- `specific_loudness.rs` — Moore–Glasberg (ISO 532-2) stationary loudness: outer/middle
  ear transfer, excitation pattern on the ERB-rate axis, excitation → specific loudness
  `N'(z)` with the model's compressive exponent, and summation to overall loudness `N`
  (sones) and loudness level `LN` (phons) via `LN = 40 N^0.35` (`N < 1`) else
  `40 + 10 log2 N`. (M27.)

- `modulation.rs` — band-envelope extraction and modulation filtering shared by
  roughness and fluctuation strength. The two differ in their modulation-rate weighting
  (roughness is centred near 70 Hz, fluctuation near 4 Hz) and their calibration
  references (1 asper / 1 vacil). (M29.)

- `masking.rs` — tonal/non-tonal masker detection, the Bark-distance spreading function,
  the global masking threshold `Tg` (power-domain sum of `Tq` and each masker), and the
  signal-to-mask ratio `SMR(i) = L(i) - Tg(i)`. (M30.)

- `mid_side.rs` — `M = (L+R)/2`, `S = (L-R)/2`, and the normalized inter-channel
  correlation `ρ_LR = Σ L[n]R[n] / sqrt(Σ L[n]² Σ R[n]²)`. (M31.)

Caps: bound the band count (Bark ≤ 24, ERB ≤ 40 over 0–20 kHz, then clamped by the
shared frequency range) and the frame count by the existing `MAX_*` rule so an IPC result
stays small.

## M26 — Auditory scales + critical-band energy (planned)

**Problem.** The mel / spectral tools are perceptually spaced but not tied to an auditory
band model, and there is no Bark/ERB axis for the loudness / masking models that follow.

**Changes.**

- New `criticalBands` analyzer under **Perception**.
- Consumes the existing STFT (shared `fftSize`, `hop`, `windowFn`, channel, frequency
  range); integrates magnitude into Bark or ERB bands with `bands.rs`.
- Option: `scale` (`"bark"` default, or `"erb"`).
- Returns a `MatrixResult` (frame × band) of band energies, with the band centres and
  edges on the axis. Reuses the existing matrix heatmap; the y-axis labels band centres
  in Hz with the scale name.

**Result sketch.**

```rust
struct CriticalBandsResult {
    window_start: f64,
    scale: Scale,                  // "bark" | "erb"
    band_edges_hz: Vec<f32>,       // n + 1
    band_centers_hz: Vec<f32>,     // n
    times: Vec<f32>,
    energies_db: Vec<Vec<f32>>,    // frame × band, dBFS (or dB SPL if calibrated)
    calibrated: bool,
    calibration_db_spl: f32,
}
```

**Tests.** Band edges are monotonic and cover the requested range; a 1 kHz sine puts its
energy in the band containing 1 kHz; Bark and ERB give different band counts; a
frequency range narrower than a band is clamped without panicking.

## M27 — Loudness (sone/phon) + specific-loudness map (planned)

**Problem.** `loudnessIntegrated` / `loudnessMomentary` / `loudnessRange` are EBU R128
**LUFS** measures — programme level, not perceived loudness. There is no sone/phon model
and no specific-loudness distribution.

**Changes.**

- New `loudness` (Series) and `specificLoudness` (Matrix) analyzers under **Perception**.
- Commit to **ISO 532-2 (Moore–Glasberg) stationary** loudness on the ERB-rate axis.
  Run it per analysis frame over the window so the result is a time series; the summary
  carries the window's `N5` (the loudness exceeded 95% of the time), mean, max, and the
  calibration state. `specificLoudness` returns `N'(z)` as a frame × ERB-band matrix
  (the "specific loudness map").
- Option: `calibrationDbSpl` (default `0` = uncalibrated). When `0`, the summary and
  readouts say **uncalibrated** and the values are relative sones, not absolute.
- **Not** a change to the R128 tools: they stay programme-level measures, distinct from
  the sone/phon model. The catalog `about` copy distinguishes them.

**Result sketch.**

```rust
struct LoudnessResult {
    window_start: f64,
    times: Vec<f32>,
    loudness_sone: Vec<f32>,       // N per frame
    loudness_phon: Vec<f32>,       // LN per frame
    // summary adds: n5_sone, mean_sone, max_sone, calibrated, calibration_db_spl
    calibrated: bool,
    calibration_db_spl: f32,
}

struct SpecificLoudnessResult {
    window_start: f64,
    erb_centers_hz: Vec<f32>,
    times: Vec<f32>,
    n_prime: Vec<Vec<f32>>,        // frame × ERB band, sone/Bark
    calibrated: bool,
    calibration_db_spl: f32,
}
```

**Tests.** A calibrated 1 kHz sine at a known SPL produces the expected sone value within
tolerance; uncalibrated input is labelled; a louder copy raises `loudness_sone`; silence
floors near zero; the specific-loudness sum across bands approximates the overall `N`;
the R128 tools are untouched.

## M28 — Sharpness (DIN 45692) (planned)

**Problem.** Spectral centroid is a physical brightness proxy, not the perceptual
sharpness used to compare a dull thud with a piercing metallic sound.

**Changes.**

- New `sharpness` (Series) analyzer under **Perception**.
- Computes DIN 45692 sharpness from the M27 specific-loudness distribution:

  ```
  S = k * ∫ N'(z) g(z) z dz  /  ∫ N'(z) dz
  g(z) = 1                       (z <= 15.8)
       = 0.15 e^(0.42 (z - 15.8)) + 0.85   (z > 15.8)
  k ≈ 0.11 (0.105–0.115)
  ```

  The unit is **acum**. Do **not** substitute spectral centroid for `N'(z)`.
- Option: `calibrationDbSpl` (inherited from M27), so calibrated loudness carries
  through to sharpness.

**Result sketch.** A `SeriesResult` of `sharpness_acum` over time (plus `calibrated` /
`calibration_db_spl`), reusing the series view and readouts.

**Tests.** A high-frequency-heavy sound scores higher than a low-frequency-heavy one at
equal loudness; a reference 1 kHz tone at 60 dB SPL yields the documented ~1 acum; the
numerator/denominator integration matches a direct numerical reference.

## M29 — Roughness + fluctuation strength (planned)

**Problem.** There is no model for the harsh, buzzy sensation of rapid beating
(roughness) or the slow pulsing/wobble of AM (fluctuation strength). A single AM rate is
not enough, and `modulation` reports the *physical* AM/FM spectra, not the perceptual
weighted roughness/vacil.

**Changes.**

- New `roughness` (asper) and `fluctuationStrength` (vacil) analyzers under
  **Perception**, sharing the `modulation.rs` band-envelope → modulation-filter
  pipeline.
- **Roughness** follows a Daniel–Weber-style model: Bark/ERB band envelopes, a
  modulation filter centred near **70 Hz**, generalized modulation depth per band,
  frequency-dependent weighting, and inter-band correlation, calibrated to **1 asper** at
  a 1 kHz / 60 dB SPL / 100% AM / 70 Hz reference. This is the full signal-processing
  model, **not** a sum of FFT-peak beatings.
- **Fluctuation strength** uses the same pipeline with the modulation filter centred
  near **4 Hz**, calibrated to **1 vacil** at a 1 kHz / 60 dB SPL / 100% AM / 4 Hz
  reference.
- Option: `calibrationDbSpl` (shared). The rate bands are fixed by the model; no
  user-facing rate override in this milestone.

**Result sketch.** Two `SeriesResult`s (`roughness_asper`, `fluctuation_vacil`) over
time, each with the calibration fields. The **Perception** view draws both lines on one
time axis with readouts (like `modulation` draws AM + FM), so the rough vs pulsing
character is directly comparable.

**Tests.** Rendered from synth graphs (sine carrier × LFO): 70 Hz AM reads ~1 asper at
the reference calibration, 4 Hz AM reads ~1 vacil; roughness drops at slow rates where
fluctuation strength rises; a steady carrier reads near zero for both; uncalibrated
input is labelled.

## M30 — Tonality, masking, and audibility (planned)

**Problem.** Spectral flatness is a noisiness proxy, but there is no masking threshold,
no signal-to-mask ratio, and no defined tonal-energy ratio — so "which components are
likely inaudible under their neighbours" cannot be answered.

**Changes.**

- New `masking` (Spectrum overlay) and `tonality` (Series) analyzers under
  **Perception**.
- `masking` computes, per spectral line: the threshold in quiet `Tq(f)`, tonal/non-tonal
  maskers, the Bark-spread masking threshold, and the global threshold
  `Tg(i) = 10 log10(10^(Tq/10) + Σ 10^(Tj/10))`, then `SMR(i) = L(i) - Tg(i)`. Returns
  the spectrum alongside `Tq`, `Tg`, and `SMR` so the view can overlay the threshold and
  shade masked regions.
- `tonality` returns the band-energy ratio `H = E_tonal / E_total` (0–1) over time,
  where tonal components come from the same masker detection. It is a **documented
  custom proxy**, not a standardized perceptual tonality metric; the about copy says so.
- Option: `calibrationDbSpl` (shared); the masker/spread parameters follow the MPEG
  model and are fixed in this milestone.

**Result sketch.**

```rust
struct MaskingResult {
    window_start: f64,
    freqs_hz: Vec<f32>,
    spectrum_db: Vec<f32>,
    threshold_quiet_db: Vec<f32>,
    global_mask_db: Vec<f32>,
    smr_db: Vec<f32>,
    calibrated: bool,
    calibration_db_spl: f32,
}
```

**Tests.** A loud tone plus a nearby quiet tone: the quiet tone's `SMR` is negative where
it is masked and positive elsewhere; `Tg` never falls below `Tq`; a pure sine has a high
`tonality` ratio and white noise a low one; uncalibrated input is labelled.

## M31 — Equal-loudness contour overlay + spatial (stereo) cues (planned)

**Problem.** There is no ISO 226 reference to compare a spectrum's audibility against,
and no stereo-structure readout (mid/side, inter-channel correlation) — the two
"reference + width" gaps that remain after the model tools land.

**Changes.**

- **Equal-loudness contours (ISO 226)** are a **chart overlay**, not a new result
  family: tabulated frequencies + coefficients, interpolated, drawn as a reference rule
  on the **spectrum** and **spectrogram** views with a selectable phon level. Clearly
  distinguish dB SPL (contours) from normalized digital amplitude (the data); the
  overlay only means something when the spectrum is calibrated. A small readout reports
  the phon level at the cursor's frequency.
- New `spatial` analyzer under **Perception**: reads `Left` and `Right` **before** the
  channel param (the documented exception), then returns mid/side levels (dBFS) and the
  normalized inter-channel correlation `ρ_LR` over time. Returns no result for a mono
  source. These are **acoustic cues**, not a complete perceived-width model; the about
  copy says so.

**Result sketch.** `spatial` is a `SeriesResult` of `correlation` over time plus
mid/side RMS readouts in the summary (`midDb`, `sideDb`), and the calibration fields.

**Tests.** A mono source returns no result; a hard-panned signal gives `sideDb` close to
`midDb` and low correlation; an identical L/R pair gives `ρ_LR` near 1 and side energy
near 0; the ISO 226 overlay matches tabulated values at the interpolation points.

## Options summary

| Tool | Options (proposed defaults) |
| --- | --- |
| `criticalBands` | `scale` `bark` |
| `loudness` | `calibrationDbSpl` 0 |
| `specificLoudness` | `calibrationDbSpl` 0 |
| `sharpness` | `calibrationDbSpl` 0 |
| `roughness` | `calibrationDbSpl` 0 |
| `fluctuationStrength` | `calibrationDbSpl` 0 |
| `masking` | `calibrationDbSpl` 0 |
| `tonality` | `calibrationDbSpl` 0 |
| `spatial` | `calibrationDbSpl` 0 |

`calibrationDbSpl: 0` means **uncalibrated** everywhere (values are relative, and the
summary/readouts say so); a positive value is the dB SPL of a full-scale sine and turns
the dBFS axis absolute before the model runs. All options are canonical camelCase with
snake_case aliases, validated like every other tool (M16).

## Surfaces

- **Sidebar section:** all new tools → **Perception** (`perception`). The existing
  EBU R128 tools stay under **Loudness**; the about copy on both sides distinguishes
  programme level from perceived loudness.
- **GUI:** `criticalBands` and `specificLoudness` reuse the matrix heatmap;
  `loudness`, `sharpness`, `tonality` reuse the series view; `roughness` +
  `fluctuationStrength` share a two-line time view; `masking` adds a threshold/SMR
  overlay to the spectrum view; `spatial` is a series + mid/side readouts; the ISO 226
  contour is a spectrum/spectrogram overlay with a phon selector.
- **MCP:** add the ids to `list_analyzers` (GUI and Rust catalog), expose option
  metadata via `get_analyzer`, mark `family` (`matrix` for `criticalBands` /
  `specificLoudness`, `spectrum` for `masking`, `series` for the rest) and `decimatable`
  correctly. The compact shape for `masking` keeps the `SMR`/`Tg` stats and the
  `loudness`/`sharpness`/`roughness`/`fluctuationStrength` series keep their
  min/max/argmin/argmax like every series.
- **CLI:** the new ids are available through `hey-listen analyze` automatically once in
  the Rust catalog; `-o <tool>.<key>=<value>` covers `scale` and `calibrationDbSpl`.
- **Notes:** add `valuesText` cases in `src/state/notes/format.ts` for the new
  readouts (loudness, sharpness, roughness/fluctuation, masking, spatial).

## Validation

- Rust unit tests beside each tool module (so `tests.rs` stays under the budget),
  including synth-graph-rendered references for roughness / fluctuation strength.
- `scripts/notes.test.ts` cases for the new values-line formatters.
- `npm run typecheck`, `npm run build`, `cargo check`, `cargo test`, `npm run maid`.
- Regenerate `src/bindings/**` with `cargo test`; never hand-edit it.
- Optional e2e: render a synthetic AM tone, run `loudness` / `sharpness` /
  `roughness`, and assert the tabs render.

## Risks and deferred work

- **Calibration is the user's responsibility.** Sones, phons, aspers, and vacils are
  only absolute when `calibrationDbSpl` is set; uncalibrated results are relative and
  are labelled. A shared app-level calibration control (one knob fanned out to the
  per-tool options) is a later UX convenience, not part of this track.
- **No standards-compliance claim.** The published approximations implement the model
  families; the normative coefficients and conformance procedures behind ISO 532 /
  DIN 45692 / ISO 226 may require purchase. The UI and docs say "model" or "proxy", never
  "ISO-compliant".
- **Zwicker loudness (ISO 532-1), time-varying loudness (ISO 532-3), and the Sottek
  hearing model (ECMA-418-2)** are deferred: M27 commits to one stationary model first,
  and the scales/modules are structured so a second model can slot in later.
- **Stereo is a point read, not a width model.** Mid/side and correlation describe a
  recording's stereo structure, not perceived width/distance; binaural cues (ITD/ILD) and
  a true spaciousness model are deferred.
- **Roughness / fluctuation strength are the heaviest models.** They depend on the
  band-envelope modulation pipeline; defaults are starting points, not species-specific
  tuning, and should be validated against published test signals and real clips.
- **Export of the new results rides M12**; the data model is already export-shaped.
