# Analyzer audit

**Date:** 2026-11-09. **Scope:** the custom analyzers and custom measurement code, including every psychoacoustic analyzer, AM/FM modulation, note segmentation and its voice-quality proxies, ranged pYIN, frame RMS, and the waveform/spectral adapters. This is an audit of the checked-out implementation, not an implementation milestone. No analyzer code was changed.

## Method and interpretation

The inventory/dispatch owners are [`AnalyzerId`](../src-tauri/src/audio/analyzers/id.rs) and [`tools/dispatch.rs`](../src-tauri/src/audio/analysis/tools/dispatch.rs). The design baseline is [analysis metrics](analysis-metrics.md), [psychoacoustics](analysis-psychoacoustics.md), [psychoacoustic references](psychoacoustics-references.md), and the delivered milestones in the [roadmap](roadmap.md).

For readability, source references below use these prefixes:

- **A/** = [`src-tauri/src/audio/analysis/`](../src-tauri/src/audio/analysis/).
- **C/** = [`src-tauri/src/audio/analyzers/`](../src-tauri/src/audio/analyzers/).
- Other paths are repository-relative. Line numbers refer to the audit snapshot.

**High** means an ordinary supported input can produce materially misleading measurements, non-finite results, or false rates. **Medium** means a narrower correctness/contract defect. **Low** means presentation, provenance, or an internal API problem. **Unvalidated** means the available evidence does not establish numerical accuracy; it is not by itself proof that a standard was violated.

The oxiaudio-provided feature algorithms, YIN/autocorrelation, rhythm detectors, and LUFS/LRA internals are outside this audit. Their custom adapters, gating, conditioning, and shared spectral normalization are considered where they affect the requested tools. A wrapper around oxiaudio is not treated as an independently implemented detector. The ISO 226 overlay is reviewed as an adjacent custom calculation, not as a standalone analyzer.

### Validation actually performed

- `cargo test --lib audio::analysis`, from `src-tauri/`: **180 passed, 0 failed, 302 filtered out**. This selection includes comparison, serialization/binding, and summary tests as well as numerical analyzer tests; it is not a count of independent accuracy checks.
- `cargo test --lib audio::analyzers`, from `src-tauri/`: **20 passed, 0 failed, 462 filtered out**, covering catalog, identifier, option metadata, and guidance contracts.
- `npm run test:unit`: **passed**, including analyzer options, note-segment helpers, waveform helpers, comparison helpers, and equal-loudness checks.
- `npx --no-install prettier --check docs/analyzers-audit.md`: **passed** after formatting the report.
- Temporary `rustc --edition=2021 -O` probes executed the actual ranged-pYIN source with minimal buffer/frame type stubs, and unchanged copies of the loudness, masking, threshold, and PCM modules. Results are identified explicitly below. Temporary harnesses were removed; they are not permanent regression tests.
- Supplemental equation/filter calculations used small Python numerical mirrors. Those establish examples and arithmetic, not execution of the full Rust analyzer; such examples are labelled accordingly.
- `npm run sidecar` was attempted before Cargo and timed out after 120 seconds during compilation. The subsequent direct Cargo test completed successfully despite macOS SDK-cache sandbox warnings.
- No normative ISO/DIN conformance suite, independently sourced perceptual reference corpus, E2E UI run, full Rust suite, frontend build, or full maid gate was run. This change is documentation-only; passing the selected tests must not be read as certification of the measurements.

## Executive assessment

The architecture is largely appropriate: explicit result types, finite silence floors in many paths, nullable unavailable estimates, and a clear distinction between acoustic descriptors and clinical/perceptual standards. The principal weakness is **measurement validation**, not the absence of tests. Several tests prove only a fitted anchor, direction of change, schema shape, or advertised metadata.

Highest-priority findings:

1. **Spectral amplitude normalization is reused as integrated power.** Window choice changes critical-band energy and the power delivered to the loudness model.
2. **Aliasing is not prevented by restricting the output axis.** Both AM/FM sampling and long-window psychoacoustic-envelope decimation can manufacture retained modulation rates; the shared PCM downsampler has no anti-alias filter either.
3. **Specific loudness has the wrong exposed density unit and an incomplete result contract.** Its actual unit is sone/Cam, not sone/Bark; calibration and band edges are absent, and its integration routines are inconsistent.
4. **Masking loses broadband masker energy and can overflow.** Its default uncalibrated SMR also mixes dBFS and dB SPL and cannot support audibility conclusions.
5. **Reference-anchored roughness/fluctuation outputs are custom approximations.** They are not numerically validated Daniel–Weber/Osses implementations; low-carrier rectification creates spurious roughness.
6. **FM and note reliability have missing-data defects.** Interpolated FM values count as evidence, fine-track gaps are unrestricted, and note jitter detrending discards elapsed time.
7. **The pYIN range contract and a regression assertion are misleading.** Quantized output can leave the requested interval, and a test that claims to reject subharmonics does not assert that property.

## Cross-cutting findings

### X1 — High: peak-amplitude STFT scaling is not energy normalization

**Evidence:** A/support.rs:296–311,347–368; A/psychoacoustics/bands.rs:84–95; A/tools/loudness.rs:16–22.

The STFT wrapper uses `m[k] = 2 |Xw[k]| / sum(w)`. This is coherent-gain normalization: useful for a bin-centred sine's peak-bin amplitude. Summing `m[k]^2` over its main lobe instead gives approximately `A^2 × ENBW`, where `ENBW = N sum(w^2) / sum(w)^2`. A full-scale-sine calibration requires a consistent sine-equivalent component-power basis, not a window-dependent surplus.

At FFT size 2048, the window formula gives integrated excesses of approximately **+1.763 dB Hann, +1.346 dB Hamming, +2.374 dB Blackman**, relative to rectangular. These are analytical window-energy calculations, not measured loudness errors. If conventional sample-RMS dBFS is intended for band energy, the full-scale sine's −3.01 dBFS RMS reference must also be specified separately from the spectrum's 0 dBFS peak-amplitude convention.

**Affected:** critical-band energy directly; loudness/specific loudness through calibrated component powers; sharpness indirectly through the nonlinear loudness distribution. Masking's peak-line interpretation and tonality's main-lobe accounting have related problems discussed below.

**Tests:** the existing band test injects one normalized bin, bypassing the STFT; the loudness anchor uses Hann/2048 with broad tolerance. **Needed:** Parseval/power-conservation tests, tones on/off bins, noise, and FFT/window sweeps. Separate amplitude-spectrum and integrated-power representations rather than changing the shared scale indiscriminately.

### X2 — High: shared analysis downsampling is not band-limited

**Evidence:** `src-tauri/src/audio/pcm.rs:33–54`; A/mod.rs:239–242. Linear interpolation is used for analysis resampling without an anti-alias low-pass. At integer downsampling ratios it can simply select every nth input sample.

**Executed source probe:** a unit-amplitude 18 kHz cosine at 48 kHz, resampled to 24 kHz, retained RMS **0.70710677** and aliases to 6 kHz. This changes every downstream frequency-sensitive measurement, not just display resolution. Using the same path for preview does not make it measurement-correct.

**Tests:** DC preservation and output length only (`pcm::tests::resample_preserves_dc`; A/tests.rs:133–140). **Needed:** above-target-Nyquist rejection, passband amplitude/frequency accuracy, and sample-rate invariance. Treat this separately from modulation-envelope decimation: both stages need appropriate bandwidth control.

### X3 — Medium: frame/support metadata is incomplete or inconsistent

**Evidence:** A/tools/shared.rs:112–124 and A/support.rs:238–250 report matrix `duration = frame_count × hop`, not actual source duration or full STFT support. Psychoacoustic matrices omit FFT/frame size and band edges; start-time timestamps are valid conventions, but do not identify their support by themselves.

A 2048-sample signal at 48 kHz with a 512-sample hop has one ordinary STFT frame: `frame_count × hop` is **10.67 ms**, while its source/frame support is **42.67 ms**. Zero-padding short selections creates a different support ambiguity. The matrix summary exposes that synthetic duration as “duration” (A/summary/families.rs:98–113).

**Needed:** distinguish source duration, frame support, effective hop, and display grouping. Include exact band geometry and density units in measurement results. Keep timestamp conventions explicit rather than assuming all tools use frame centres.

### X4 — Medium: headless guidance does not preserve all scientific caveats

**Evidence:** `src-tauri/src/audio/analyzers.rs:160–178` falls back to a short description when Rust `about` text is absent; C/catalog/perception.rs:61–87 and C/family.rs:145–152 do not provide the frontend's full warnings for all custom models. Shared calibration help in C/options/table.rs:8–14 says “relative sones” for tools whose outputs are asper, vacil, masking levels, or dimensionless cues; C/options.rs:44–54 does not infer a unit for `calibrationDbSpl`.

**Impact:** GUI prose cannot be relied on to qualify a CLI/MCP result. Calibration is not model validation, and uncalibrated perceptual values are not generally an absolute result with a simple unknown additive offset.

**Needed:** tool-appropriate help, explicit model identity/limitations and calibration units in discovery and exports, and semantic tests of those descriptions. Existing catalog/key tests establish presence, not scientific meaning.

## Psychoacoustic analyzers

### Critical bands — `criticalBands`

**Principle:** appropriate descriptive integration of spectral power into approximately uniform Bark or ERB-rate bands. It is a rectangular bin-assignment filterbank, not a physiological overlapping auditory filterbank. The scale equations match the documented Bark and Glasberg–Moore approximations (A/psychoacoustics/scales.rs:17–38).

**Implementation:** bin assignment is consistent, including the final edge (A/psychoacoustics/bands.rs:101–113), but **X1** biases the summed power. Band geometry is regenerated relative to the requested range and coarsened by a cap; these are not fixed standardized critical-band boundaries. Frequency-range changes therefore alter the partition, not merely hide existing rows.

**Shape/units:** frame-major matrix with centre frequencies in Hz is conventional for visualization. **Medium:** A/tools/critical_bands.rs:20–28 discards exact edges and scale identity; `MatrixResult` alone cannot establish the integration intervals or power reference. Calling values “energy” should not suggest joules or PSD in dB/Hz: they are summed spectral powers expressed on a digital-level reference. Apply **X3**.

**Tests:** `edges_are_monotonic_and_cover_the_range`, `a_one_khz_sine_lands_in_the_band_containing_it`, `bark_and_erb_have_different_band_counts`, `a_narrow_range_clamps_to_one_band`; scale round trips and monotonicity. Useful geometry tests, but the “sine” test uses a hand-built one-bin spectrum. **Missing:** real STFT energy accuracy, on-edge/off-bin tones, multiple tones, noise, edge retention in exports, and window/FFT invariance.

### Loudness — `loudness`

**Principle:** recognizable stationary Moore–Glasberg chain: calibrated components → outer/middle-ear transfer → level-dependent roex excitation → compressive specific loudness → diotic binaural sum → sones/phons (A/psychoacoustics/loudness.rs:116–167,213–308). Appropriate model family, explicitly an approximation rather than demonstrated ISO 532-2 conformance. Per-STFT-frame stationary estimates are **not** a validated time-varying loudness model. Free-field/diotic assumptions remain even for arbitrary recordings.

**Implementation:** inherits **X1**. **Medium:** A/tools/loudness.rs:32–44 passes the full spectrum regardless of shared `freqMinHz`/`freqMaxHz`, contradicting the psychoacoustic plan's band-limit contract. Specific loudness instead crops output excitation bands, so the two tools no longer describe the same restricted-domain quantity. An excluded input component can still excite a retained output band; cropping excitation is not input band-limiting.

**Shape/units:** parallel sone/phon series and calibration metadata are sensible. The piecewise sone-to-phon relation is the documented conventional conversion, not a substitute for validating the underlying auditory model. **Low:** N5 is computed as an upper-tail statistic, exceeded 5% of the time (A/summary/loudness.rs:24–32), but `src/state/analyzer/defs/perception.ts:50–51` and the design text say “exceeded 95%,” reversing its meaning. The implementation's percentile discretization should be documented/tested.

**Tests:** calibrated 1 kHz/40 dB SPL ≈ 1 sone, louder-copy ordering, silence, uncalibrated flags, conversion cases, and internal integration checks. The dispatcher anchor permits ±20% (A/tests/loudness.rs:46–62). **Missing:** independently sourced model vectors over frequency/level/bandwidth/mixtures, window invariance, excluded tones, N5 numerics, listening-condition assumptions, and temporal limitations. An anchor plus monotonicity is not ISO validation.

### Specific loudness — `specificLoudness`

**Principle:** exposing the excitation-to-loudness distribution behind the total is useful and conventional. A density must retain its integration coordinate: this implementation computes **sone/Cam** on ERB rate, not sone/Bark.

**Implementation findings:**

- **Medium — incorrect partial-cell integration:** A/psychoacoustics/loudness.rs:191–199 multiplies a whole-cell trapezoid by the overlap fraction. That is not the integral of the linear function over a partial cell. **Executed source probe:** samples 1 and 0 at 1.8 and 1.9 Cam, averaged over [1.8,1.85], return **0.49999952**; the correct mean is **0.75**.
- **Medium — inconsistent endpoint quadrature:** total loudness uses `0.1 × sum(samples)` (line 162), while rebinning integrates trapezoids between sample positions. Over the full supported axis their difference is `0.05 × (first + last)`. The claimed exact identity fails when endpoint contributions matter; the 1 kHz tests barely exercise them.
- Inherits **X1** and the loudness frequency-range inconsistency. A/tools/loudness.rs:93–106 restricts the output distribution after computing full-spectrum excitation.

**Shape/units — Medium:** A/tools/loudness.rs:81–83, A/summary/families.rs:108, and `src/state/analyzer/defs/perception.ts:95,121` label the values sone/Bark, although band means divide by **Cam** widths. A true coordinate-density conversion requires its Jacobian. `MatrixResult` also omits `calibrated`, `calibrationDbSpl`, model identity, and exact edges (A/results/mod.rs:157–172); the generic canonical summary does not recover calibration state. An enclosing options/provenance envelope helps, but does not repair the standalone result/summary. Apply **X3**.

**Tests:** `integrating_the_specific_loudness_reproduces_the_total`, `the_specific_loudness_bands_integrate_to_the_total`, and an outside-model band check. The dispatcher integration test correctly uses **Cam** widths, proving what the unit actually is. **Missing:** partial-cell ramps, endpoint-concentrated patterns, restricted ranges, explicit units/calibration assertions, and independent specific-loudness vectors. A full partition can conceal the partial-cell error because erroneous pieces still sum to a whole cell.

### Sharpness — `sharpness`

**Principle:** a loudness-weighted, high-frequency-emphasized Bark-position statistic is a reasonable sharpness approximation, not a centroid relabelled as acum. Using Moore–Glasberg loudness masses with a Bark-domain weighting is defensible as a custom model, but is not validation of DIN 45692.

**Implementation:** A/tools/sharpness.rs:42–53,68–87 uses coarse ERB-band means, their arithmetic-Hz centres mapped to Bark, and the documented high-frequency weighting with `k=0.11`. ERB-rate bands have essentially equal Cam widths, so omitting that common width from the normalized ratio is not, by itself, a missing-Jacobian bug. The actual limitations are inherited spectral-power/rebinning errors, excitation cropping, and unvalidated centre-sample quadrature.

**Shape/units:** nullable acum series with calibration metadata is appropriate. Silence has no defined loudness-weighted sharpness and may reasonably be `null`. A positive calibration flag does not establish DIN accuracy, and a hybrid-model output should retain its approximation label.

**Tests:** 1 kHz/60 dB SPL ≈ 1 acum, bright-versus-dull ordering, uncalibrated label (A/tools/sharpness.rs:112–161). **Missing:** independent reference distributions/vectors, broadband/narrowband reference stimuli, sample-rate/band-grid sensitivity, and **equal-loudness** comparisons. The existing bright/dull test uses equal physical level, not the plan's equal-loudness condition.

### Roughness — `roughness`

**Principle:** auditory-band envelopes → modulation filters → depth/frequency/coherence weighting is a plausible architecture. This is a **custom band-envelope approximation fitted to a reference stimulus**, not an established numerical implementation of Daniel–Weber or ECMA-418-2. The code uses its own filters/constants and a normalized energy-weighted **mean**, not validated integration of specific roughness (A/psychoacoustics/modulation.rs:53–121,317–336). Outer/middle-ear weighting from the recommended published chain is absent.

**Implementation findings:**

- **High — carrier ripple becomes roughness:** full-wave rectification followed by two fixed 200 Hz one-pole smoothers leaves the doubled frequency of low carriers (lines 144–155). A steady 35 Hz sinusoid creates 70 Hz envelope ripple exactly at the roughness filter. Its rectified 70 Hz amplitude/DC ratio is 2/3 before smoothing. A single-band Python filter mirror, 48 kHz, three seconds, amplitude 0.1, range 20–60 Hz, uncalibrated, gave approximately **1.59 asper-labelled relative units** despite no AM. This number is a mirror result, not a full-analyzer execution.
- **High — duration changes the modulation signal:** the envelope cap increases decimation without an adequate adaptive anti-alias filter (lines 131–155). At 48 kHz, a 30-minute selection reduces envelope rate to about 133 Hz; the filter silently clamps 70 Hz to about 60 Hz. At one hour, envelope rate is about 66.7 Hz and real 70 Hz modulation aliases near **3.33 Hz**. Memory bounding must preserve the measured bandwidth rather than silently change the model.
- **Medium — selected bands do not exclude out-of-band modulation:** finite-rejection band-pass leakage can survive normalization by each band's mean and total energy (lines 299–336). Range selection is not equivalent to the promised spectral exclusion; the low-carrier mirror still produced substantial normalized modulation with a 2–2.1 kHz selected range.

**Shape/units:** calibrated nullable series is appropriate structurally. Asper-labelled values need the custom-model qualification; acoustic calibration alone does not validate them. The global level factor saturates above the reference (lines 179–185), so amplitude scaling cannot establish a conventional roughness-versus-level response.

**Tests:** reference 70 Hz AM ≈ 1 asper, rate separation, steady **1 kHz** carrier, modulation-depth ordering, calibration response, silence/label wrappers. Reference tolerance is ±30% and fixtures are directly generated 0.5-second tones, not independent model vectors. **Missing:** carrier/rate/depth/level sweeps, low-carrier ripple, out-of-band rejection, separated/coherent bands, duration-cap behavior, settling/short-selection reliability, and a published-model comparison.

### Fluctuation strength — `fluctuationStrength`

**Principle:** a slow auditory-envelope modulation descriptor is appropriate, but this shares the custom roughness pipeline with a 4 Hz weighting, different exponent, coherence rule, and fitted constant. It is not validated Osses–García–Kohlrausch output (A/psychoacoustics/modulation.rs:108–121).

**Implementation:** shares the duration-dependent decimation, out-of-band leakage, and saturating level-factor problems above. Fixed envelope smoothing is not general carrier/envelope separation. One-hour 70 Hz AM aliasing near 3.33 Hz is especially relevant because it falls near this tool's target. The nominal 0.5-second integration window spans only two 4 Hz periods; filter warm-up and short-window certainty need validation rather than assuming a numerical value is reliable.

**Shape/units:** vacil-labelled calibrated series is a conventional form for a chosen model; accuracy beyond the fitted anchor is **unvalidated**. Keep the custom-model identity with exported values, including uncalibrated outputs.

**Tests:** 4 Hz reference ≈ 1 vacil, separation from 70 Hz, depth ordering/shared pipeline checks, calibration label. **Missing:** independent references, slow-rate response curves, long-window aliasing, carrier-frequency and bandwidth sweeps, coherence cases, phase/settling effects, and selection-duration invariance. The current anchor does not validate arbitrary slow fluctuations.

### Masking — `masking`

**Principle:** combining individual masker thresholds and ATH in the power domain, then `SMR = line level − global threshold`, is conventional MPEG-style architecture. A codec-style static estimate is not a universal human detection model. This implementation computes masking from the **window-averaged power spectrum** (A/tools/masking.rs:28–47), so non-overlapping events can mask one another in the aggregate result; it does not estimate instantaneous or temporal masking.

**Implementation findings:**

- **High — missing broadband masker energy:** A/psychoacoustics/masking.rs:140–152,173–191 takes only strict local maxima as non-tonal maskers, instead of aggregating residual noise-band power. **Executed source probe:** 100–5000 Hz at 100 Hz intervals, every line 60 dB SPL, yields no maskers; at 1 kHz **Tg = Tq = 3.3690665 dB SPL**, SMR **56.63093 dB**. A large flat noise spectrum contributes no masking at all. Tiny perturbations can abruptly introduce maskers.
- **High — non-finite high-rate results:** ATH's fourth-power term is evaluated beyond the audible model domain and exponentiated directly (A/psychoacoustics/threshold.rs:17–23; masking.rs:88–102). **Executed source probe:** at 42 and 48 kHz, `globalMaskDb = +∞`, `smrDb = −∞`. A 96 kHz source's default full-band analysis includes those bins. This defeats finite numerical-result expectations; JSON/summary handling cannot restore the lost measurement.
- **Medium — tonal masker energy is only its peak bin:** lines 71–81 do not aggregate the tonal main lobe. Levels/spreading therefore depend on FFT/window/bin alignment; see tonality below.

**Shape/units — High interpretation risk:** parallel frequency arrays for spectrum, ATH, global threshold, and SMR are conventional **when consistently calibrated**. In default uncalibrated mode the implementation knowingly combines dBFS spectrum levels with dB SPL ATH (masking.rs:58–60). This is not a valid relative audibility estimate: the level-dependent spread changes too. The claim that `globalMaskDb` has the spectrum's unit cannot hold for this mixed calculation. Do not infer “inaudible” from negative uncalibrated SMR; require calibration or explicitly withhold physical threshold/SMR interpretation.

**Tests:** global threshold ≥ ATH, clear peak versus flat-spectrum tonality, piecewise spreading bounds, a nearby quiet/loud tone, and calibration flag. These pass but do not test broadband masking or finiteness at high rates. **Missing:** flat/near-flat noise maskers, probe-with/without-masker thresholds, residual energy conservation, tonal main-lobe summation, reference threshold vectors, FFT/window sweeps, 96/192 kHz finiteness and serialization, and validity behavior without calibration.

### Tonality — `tonality`

**Principle:** an explicitly defined tonal-energy fraction is a legitimate custom descriptor. It is not standardized perceptual tonality, tone-to-noise ratio, prominence ratio, or a psychoacoustic tonality unit. The existing proxy label is important.

**Implementation — Medium:** A/psychoacoustics/masking.rs:114–123,155–168 classifies main-lobe neighbours as presumed leakage for peak detection but includes only retained **peak-bin** power in the numerator. For a bin-centred Hann tone with main-lobe amplitudes approximately `[0.5,1,0.5]`, the fraction approaches **2/3**, not one. At half-bin alignment the strongest-bin fraction is roughly **0.48**. These are window/main-lobe calculations, not executed tool outputs. Keeping only one peak per 0.5 Bark further changes the meaning for close tones. Either aggregate tonal-component energy or name/document the narrower peak-bin fraction; the current pure-tone-near-one expectation is misleading.

**Shape/units:** dimensionless 0–1 series is conventional for the stated ratio. A common calibration offset cancels algebraically from the numerator/denominator and prominence comparisons; calibration does not turn this into a standardized perceptual quantity.

**Tests:** pure sine >0.5, noise <0.5, uncalibrated label (A/tools/tonality.rs:100–137). Broad smoke checks do not test the claimed endpoints. **Missing:** on-bin/half-bin tones, window dependence, known tone/noise energy mixtures, close partials/harmonic complexes, silence, narrow bands, and calibration invariance.

### Stereo acoustic cues — `spatial`

**Principle:** correct for the stated scope: uncentred normalized cross-product correlation and mid/side RMS describe stereo structure, not perceived width or binaural spatial hearing. `M=(L+R)/2`, `S=(L−R)/2`, and normalized `sum(LR)` are conventional with the declared gain convention (A/psychoacoustics/mid_side.rs:15–55).

**Implementation:** the production `run_window` path correctly reads the first stereo pair before channel selection, filters/resamples channels separately, rejects mono, and computes correlation per frame plus whole-window mid/side (A/tools/spatial.rs:38–107; A/mod.rs:188–201). No substantial defect in those equations was established. It inherits **X2** when resampling.

**Low — internal fallback:** A/tools/dispatch.rs:171–188 returns a fabricated empty successful `SpatialResult` for the mono-buffer dispatcher, explicitly to keep the catalog-dispatch test green. Normal GUI/CLI `run_window` bypasses that arm. Unsupported direct dispatch should fail or require stereo input; tag coverage is not evidence of computation.

**Shape/units:** correlation is dimensionless, normally −1…1; silence may be `null`, and one silent channel is explicitly defined as zero correlation. Mid/side levels remain **dBFS**, even with positive calibration metadata. That is documented, but exposing calibration for unchanged acoustic cues is confusing and should not imply SPL levels.

**Tests:** identical channels, hard pan, silence correlation, equal hard-pan mid/side, mono rejection. **Missing:** anti-phase −1, known absolute mid/side levels, unequal gain/independent channels, conditioning and channel-selector bypass via `run_window`, resampling effects, calibration invariance, tail frames, and long-window timestamps.

### Equal-loudness overlay — adjacent custom calculation

**Principle/implementation:** `src/lib/equalLoudness.ts` supplies ISO 226:2023-derived preferred-frequency tables, log-frequency interpolation, and documented endpoint clamping. This is a pure-tone reference, not loudness estimation for arbitrary spectra. No independently verified incorrect coefficient was established; agreement with the normative formula/tables remains **unvalidated** by this audit.

**Shape/units:** frequency in Hz, selected phon level, contour in dB SPL is appropriate. The spectrum remains dBFS on a separately auto-ranged axis (`src/components/analyzer/FrequencyChart.tsx:85–100`); intersections of these independently scaled curves have **no audibility meaning**. Clamping beyond 20–12,500 Hz extends the reference graph, not validated equal-loudness predictions.

**Tests:** `scripts/equalLoudness.test.ts` passes offered-level completeness, 1 kHz anchors, lookup against its own table, clamping, and unsupported levels. **Missing:** independent non-1-kHz values, formula/table regeneration checks, interior interpolation cases, invalid frequencies, and UI assertions about separate-axis semantics. Looking up a value from the same table is not independent validation of the table.

## AM/FM modulation — `modulation`

**Principle:** linear frame-RMS envelope → detrend → Hann → magnitude FFT for AM; longest coarse voiced run → finer YIN → cents residual → corresponding spectrum for FM. Reasonable exploratory acoustic descriptors. Whole-window AM intentionally includes gating/note-gap rhythm. This is not Hilbert-envelope demodulation or cycle-accurate instantaneous frequency for arbitrary mixtures.

**Implementation findings:**

- **High — the output-band clamp cannot prevent aliases:** A/support.rs:106–130 samples RMS windows, and A/tools/modulation.rs:87–95 only clamps the output axis to 45% of the slower grid. With a 1 kHz carrier, 40 Hz AM, `frameMs=10`, `hopMs=20`, envelope rate is 50 Hz and 40 Hz folds to **10 Hz**, inside the reported 22.5 Hz ceiling. A Python RMS/detrend/window mirror confirmed the false 10 Hz maximum. Widened automatic hops can create the same issue; FM tracking likewise needs sampling/reliability qualification, not merely an axis clamp.
- **Medium — false default provenance:** C/options/table.rs:180–186 declares `hopMs=2.5`; A/types.rs:232–237 resolves an unset value to **5 ms**. Headless effective options return an unset `ToolOptions` (`src-tauri/src/mcp/dispatch/args.rs:233–250`), while metadata overlays catalog defaults (`src-tauri/src/audio/analyzers.rs:146–157`). A no-option run can report 2.5 ms and compute with 5 ms.
- **Medium — imputation becomes evidence:** A/tools/modulation_dsp.rs:281–324 interpolates missing pitches before A/tools/modulation.rs:148–161 counts duration, frames, and exact distinct cents values. Three measured levels with intervening gaps can become enough distinct values to pass the anti-staircase guard. Exact floating-point inequality is not meaningful pitch resolution either.
- **Medium — unrestricted fine-track gaps:** the 50 ms bridge applies only to the coarse track. Fine retracking trims edges, then interpolates every internal dropout regardless of length (modulation.rs:202–220). Coarse/fine voicing disagreement can therefore fabricate a long continuous FM trajectory.
- **Low — endpoints cannot become reported peaks:** modulation_dsp.rs:183–226 permits endpoint local maxima but assigns them zero two-sided prominence, excluding them at the 3 dB threshold. A boundary maximum needs an explicit censored/one-sided policy, not contradictory handling.
- **Low — FM provenance is the coarse slice, not retained fine support:** modulation.rs:175–184,204–230 keeps the original start/end after fine-edge trimming. `fmRunSecs` can overstate the support actually transformed.

**Shape/units:** shared rate axis in Hz with independently normalized relative-dB magnitude arrays is conventional. `20 log10(magnitude/max)` is correct; heights do **not** compare absolute AM and FM energy. AM depth `(max−min)/(max+min)` is conventional for an envelope, but the smoothed RMS envelope's index need not equal a carrier's physical modulation index. FM peak-to-peak/std in cents and fractions in 0–1 are coherent; summaries may explicitly convert fractions to percent. Zero-padding interpolates the spectrum; it does not improve physical resolution. The result lacks the actual envelope/pitch grid/support metadata needed to assess these limits independently (A/results/modulation.rs).

**Tests:** synth-rendered 10 Hz AM, multiple AM rates, 30 Hz FM, steady tone, silence, option aliases, output-band clamp, and directly constructed FM reliability cases. **Blind spots:** the alias test uses a safe 10 Hz input, not an above-Nyquist contaminant; staircase tests bypass interpolation; FM depth has only loose checks. **Needed:** alias-rejection/qualification tests, omitted versus explicit catalog defaults, missing-data reliability through the actual pipeline, analytic FM cents depth, edge peaks, fine-support bounds, and carrier/rate/depth/length sweeps.

## Notes and voice-quality proxies — `noteMetrics`

**Principle:** acoustic event gating, not musical transcription or species-aware syllable recognition. Frame-RMS relative/absolute threshold + hysteresis, merge short gaps, then drop short notes is appropriate for the advertised segmentation. Spans cover active **frame support**, so overlapping windows expand detected events; merged silence remains part of the measured raw-sample span. These are intentional conventions, not sample-accurate onset claims (A/tools/notes.rs:31–96).

**Implementation findings:**

- **Medium — digital silence becomes a note at a valid floor:** A/tools/notes.rs:51–55,108–115 compares inclusively against the same −120 dB floor used for silence. On silence with `gateFloorDb=-120`, threshold is −120, so every frame opens/stays active. A sufficiently long silent selection becomes a note. The allowed option range includes this value (A/types.rs:248–253).
- **Medium — silent detection truncation:** notes.rs:93–96 truncates to `MAX_NOTES` before counts, gaps, syllables, and trailing-gap calculation (lines 148–210). Permissive durations can produce more valid runs than the cap inside the bounded RMS grid. The omitted suffix is not marked truncated; the final retained note's `gapAfterSecs` becomes the entire remaining window, including omitted sound. Bounding storage is reasonable; representing omitted activity as silence is not.
- **Medium — jitter detrending loses time:** A/tools/note_quality.rs:53–61,96–104,143–166 removes unvoiced frames and detrends retained pitches against their compacted index. A perfectly linear cents glide with observations at `[0,5,10,50,55,60]` ms and values `[0,10,20,100,110,120]` cents gets approximately **16.73 cents** residual spread instead of zero (least-squares arithmetic). Fit against actual retained frame times.

**Shape/units:** explicit notes, inter-note gaps, optional syllable groupings, seconds/durations, raw dBFS levels, relative dB, and normalized envelope **positions** are conventional. Envelope **values** remain dBFS. One RMS-loudest note is the reference for both relative RMS and peak; another note may legitimately have positive relative peak dB. Leading/trailing gaps are excluded from the inter-note gap summary. Syllable levels include the grouped gaps by design. A truncation indicator and effective measurement grids are missing.

**Proxy conventionality:** `jitterProxyCents` is detrended frame-f0 spread, **not** clinical cycle-period jitter; `shimmerProxyDb` is frame-level dB spread, **not** cycle-amplitude shimmer; `hnrProxy` is 0–1 autocorrelation periodicity, **not HNR in dB**. Those distinctions are correctly documented. Attacks/decays, vibrato, merged gaps, f0 range, and frame size affect the proxies. A non-null median from very few pitches is not a strong reliability guarantee; proxy availability and confidence need separate interpretation.

**Tests:** continuous tone; tone-gap-tone; merging; silence at the default floor; relative levels; short-note null proxies; steady/vibrato/amplitude-modulated/noisy notes; aliases; syllable grouping (A/tests/note_metrics.rs). Useful behavioral coverage. **Missing:** silence at the minimum floor, explicit gate-state/equality boundaries, merge-before-drop and minimum-note rejection fixtures, absolute level oracles, above-cap output, missing-time jitter, partially voiced/noisy notes, effective-grid provenance, and independent voice-measure references. Serialization/shaping fixtures do not establish semantic consistency of detected counts/spans.

## Other custom implementations and adapters

### Ranged pYIN — `pitchPyin`

**Principle:** YIN difference candidates, Beta-threshold prior, and Viterbi temporal smoothing are a plausible pYIN-family approach (A/pyin.rs). This is a local adaptation of oxiaudio's algorithm, not an independently validated implementation of the original published pYIN estimator. A fixed semitone output grid is an intentional coarse representation; it is unsuitable for fine vibrato/jitter estimation, which correctly uses another path here.

**Implementation — Medium:** A/pyin.rs:51–58,84–87,177–195 rounds range endpoints to nearest bins, checks bin indices, then returns bin-centre frequencies. A bin index in the rounded interval need not have its **frequency** in the requested range. **Executed source probe:** a 455 Hz tone with requested range **450–460 Hz** yielded **466.16376 Hz** in all 43 voiced frames. Check the final reported frequency or explicitly report the quantized effective domain.

**Effective-range contract — Medium:** A/tools/dispatch.rs:264–270 echoes requested bounds as effective bounds, while tau bounds clamp to at least two samples and at most half a frame (pyin.rs:51–54). Small FFTs/low sample rates cannot realize every accepted range. `PitchResult` lacks frame size, and eight voiced frames alone makes `f0Reliable=true` (A/support.rs:219); that is an availability heuristic, not accuracy validation.

**Tests — misleading assertion:** `pyin_does_not_invent_a_subharmonic_when_the_range_excludes_the_tone` (A/tests/pitch.rs:141–162) asserts only that every returned value is below 2100 Hz. A false 1500 Hz octave error passes. **Executed source probe:** the test's 3 kHz tone with default 50–2000 Hz bounds produced **1479.9777 Hz**, 43 voiced frames. This establishes that the test does not verify its claimed property; detecting a tone's true f0 outside a constrained periodicity search is itself an algorithmic limitation, not something that can be fixed by a stronger assertion alone.

**Shape/units:** seconds, nullable Hz values, voiced counts/fraction are conventional. Confidence is calculated internally but omitted from the result; the boolean reliability flag must not substitute for calibrated confidence. Semitone quantization should be visible with the returned track, not just in source comments.

**Other coverage:** 440 Hz default, 3 kHz expanded range, voiced versus silent tail, and frame cap. **Missing:** tight range edges, realizable frame/sample-rate bounds, octave-confusable/harmonic/noisy signals, glides and jumps, transition/voicing behavior, confidence calibration, and reference-implementation comparisons. No successful sine-only test establishes general pitch correctness.

### Frame RMS — `frameRms`

**Principle/implementation:** correct rectangular-window RMS, `20 log10(rms)` in amplitude-referenced dBFS, frame-centred times, real-sample normalization for a short/tail frame, and reported effective hop/frame size (A/support.rs:91–132; A/tools/time.rs:45–62). It is explicitly not K-weighted loudness. The optional custom gate correctly follows the requested envelope grid.

**Limits/shape:** nullable dBFS series is conventional. Hops larger than frames intentionally leave uncovered gaps; automatic hop widening eventually does the same. The final partial frame can have a nonuniform centre-time interval, so consumers must respect `times`, not infer a perfectly uniform axis from `hopSize`. Those limits matter when reusing the helper for modulation or segmentation. The frame-size field remains nominal when the actual short frame is smaller.

**Tests:** half-scale sine ≈ −9.03 dBFS, silence floor, sub-frame input, configured grid, aliases; gate on/off, absolute floor, quiet-frame exclusion (A/tests/frame_rms.rs; A/tests/gating.rs). **Missing:** non-aligned partial tail, DC/transient analytical levels, cap-induced uncovered bursts, unusual sample rates, and silence exactly at the gate floor. No new core RMS-formula defect was established beyond its downstream sampling/interpretation limits.

### Waveform and levels — `waveform`, `levels`

**Principle:** scalar sample-peak/RMS calculations are delegated to oxiaudio; custom min/max buckets are a conventional peak-preserving waveform overview, not an analytic resampling of the waveform. Linear amplitude and amplitude-referenced dBFS are coherent. Sample peak is not oversampled true peak or inter-sample peak.

**Implementation — Medium:** A/support.rs:379–395 seeds bucket extrema with `lo=1`, `hi=−1`, despite supporting amplitudes above full scale. A bucket `[2,3]` returns minimum **1**, and `[-3,-2]` returns maximum **−1**, inventing values not present. Initialize extrema from the first sample or infinities. Whole-window oxiaudio level readouts are separate and need not share this defect.

**Shape:** paired min/max arrays plus frame count/duration are reasonable, but bucket spans are implicit. Consumers need the actual `ceil(sample_count/target_buckets)` partition: spreading bucket centres uniformly over duration is not exactly correct when the last bucket is short.

**Tests:** half-scale waveform RMS/peak and matching level readouts (A/tests.rs:55–68,192–203); frontend waveform helper checks passed. **Missing:** above-full-scale same-sign buckets, all-positive/all-negative data, short final buckets, exact envelope extrema/support, empty input, and independent absolute level cases. Level-meter smoke coverage does not test the custom bucket algorithm.

### Spectrum and spectrogram — custom oxiaudio STFT adapters

**Principle:** an averaged **magnitude** spectrum and peak-preserving magnitude heatmap are legitimate products, but not power spectral density or a Welch averaged-power estimate. A/tools/spectrum.rs:10 calls the magnitude average “Welch-style”; the numerical distinction should remain explicit. The oxiaudio FFT/STFT internals were not comprehensively audited here.

**Implementation/units:** coherent-gain scaling is reasonable for interior-bin tone amplitude, subject to scalloping/leakage. **Medium:** A/support.rs:298–311 applies the factor of two to **DC and Nyquist** too. A rectangular-window DC value 1 therefore yields amplitude 2, approximately **+6.02 dBFS**, rather than 0 dBFS. Those real-only bins need one-sided endpoint treatment. The factor also compounds their power interpretation in **X1**. “Randomized overlap” actually averages a fixed half-hop-shifted magnitude pass (support.rs:330–339), not random offsets or power averaging.

**Shape — Medium:** A/tools/spectrum.rs:85–155 max-pools frequency/time groups, returns grouped frequencies/frame count but retains the **ungrouped hop** and omits group factors/explicit time spans. The full result is already a display-reduced maximum statistic, not raw STFT data. Reconstructing its displayed frame grid from `hopSize` is wrong after time grouping; grouped-frequency maxima are not component powers at their labelled centre. Clearly separate measurement and display products.

**Additional display defect:** `src/components/analyzer/spectrogramRender.ts:42–53` checks converted power `>0` to detect silence, but a −120 dB floor converts to positive power. An all-silent heatmap can therefore produce non-null centroid/rolloff overlays. Those overlays also use pooled maxima, so they should not be interpreted as equivalent to full-resolution spectral feature analyzers.

**Tests:** sine peak frequency/loose level, band filtering, min/mean/max bracketing, spectrogram dimensions, and short-input padding (A/tests.rs). **Missing:** DC/Nyquist, exact-bin/window amplitude, pooled-grid metadata, partial groups, silence overlays, randomized-overlap semantics, and source-time alignment. The existing ±3 dB tone assertion is not a comprehensive amplitude calibration test.

## Recommended remediation sequence

1. **Establish trustworthy signal/power inputs:** band-limited analysis resampling; distinct amplitude and energy-normalized spectral paths; correct DC/Nyquist handling. Add analytical oracles before retuning perceptual anchors.
2. **Preserve modulation bandwidth:** fix both envelope-decimation paths, report effective sampling/support, and separate observed from interpolated FM evidence. Resolve catalog/engine defaults in one place.
3. **Repair loudness contracts:** correct density units/calibration/edges, exact partial integration and endpoint quadrature, and shared range semantics. Validate independent stationary-model vectors before stronger ISO/DIN wording.
4. **Make masking scientifically safe:** aggregate residual masker energy, account for tonal main lobes, bound the auditory model domain/use stable logarithmic sums, and prevent uncalibrated audibility interpretation.
5. **Fix event/pitch edge cases:** floor-sentinel segmentation, explicit truncation, time-aware jitter detrending, final-frequency pYIN bounds, and honest unsupported-input dispatch.
6. **Strengthen assurance, not just coverage counts:** published/reference vectors, parameter/sample-rate/selection-length sweeps, and tests that assert the scientific property named. Keep custom asper/vacil/tonality identities explicit across GUI, CLI/MCP, and exports.

**Bottom line:** the passing suite supports basic operation and useful exploratory trends. It does not currently justify treating all reported psychoacoustic units, modulation rates, or reliability flags as validated measurements. Correct the reproduced numerical/contract defects first; then use independent references to quantify the remaining model approximations.
