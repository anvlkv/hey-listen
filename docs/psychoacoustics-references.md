# Psychoacoustics references

The equations, library candidates, and model recommendations that the **M26–M31**
plan relies on. It is a **reference**, not a design: the milestone decisions, result shapes,
and option defaults live in [`analysis-psychoacoustics.md`](analysis-psychoacoustics.md).

> **Standards caveat.** Publicly available papers and descriptions explain the model
> *families*, but some normative equations, coefficients, and conformance procedures are
> contained in standards that may require purchase. Don't claim full ISO or DIN
> compliance merely because a subset of the equations has been implemented.

## Libraries worth investigating

| Library | Role | Notes |
| --- | --- | --- |
| [`audio_samples`](https://docs.rs/audio_samples/latest/audio_samples/) | First Rust candidate | A feature-gated `psychoacoustic` module: Bark/Mel band layouts, absolute threshold of hearing (ATH), masking thresholds, signal-to-mask ratio (SMR). Verify implementation details and reference tests before relying on its values as standards-compliant. |
| [`oxideav-mp2::psy`](https://docs.rs/oxideav-mp2/latest/oxideav_mp2/psy/) | Masking reference | Documents the MPEG-1 Layer II psychoacoustic model: tonal/non-tonal maskers, masking spread over Bark distance, threshold in quiet, and a global masking threshold. Codec-oriented, not a general loudness/sharpness library. |
| [Phonometry](https://github.com/jmrplens/phonometry) | Equation/reference source | Python reference implementing loudness-related metrics, DIN sharpness, roughness, fluctuation strength, and annoyance. Useful for porting equations and validating results. |

## Auditory frequency scales

These are foundational for critical-band energy, loudness, sharpness, masking, and
roughness. **Bark and ERB are not interchangeable:** Bark is convenient for classical
Zwicker and MPEG-style models; ERB is central to Moore–Glasberg loudness models.

### ERB (equivalent rectangular bandwidth)

The Glasberg–Moore approximation of the auditory filter width at centre frequency `f`:

```
ERB_N(f) = 24.7 * (1 + 0.00437 f)      // Hz
```

The ERB-rate (Cam) scale:

```
E(f) = 21.4 * log10(1 + 0.00437 f)      // Cam
f(E) = (10^(E / 21.4) - 1) / 0.00437    // Hz
```

### Bark (critical-band rate)

```
z(f) = 13 atan(0.00076 f) + 3.5 atan((f / 7500)^2)
```

`f` is in Hz and the arctangents are in radians; the axis spans roughly 24 Bark.

## Loudness

### Recommended models

| Model | Best use | Reference |
| --- | --- | --- |
| Zwicker | General-purpose stationary and time-varying loudness | ISO 532-1:2017 |
| Moore–Glasberg | Auditory-filter-based stationary loudness | ISO 532-2:2017 |
| Moore–Glasberg–Schlittenlacher | Time-varying loudness | ISO 532-3:2023 |
| Sottek Hearing Model | A shared perceptual model for loudness, roughness, tonality | ECMA-418-2 |

ISO 532-1 covers both stationary and time-varying sounds; ISO 532-2 uses auditory filters
and specific loudness on the ERB-rate axis. Both outputs are sones, but the model results
are not necessarily numerically interchangeable.

### Sone ↔ phon

The loudness level `LN` is in phons; loudness `N` is in sones:

```
LN = 40 * N^0.35            (0 < N < 1)
LN = 40 + 10 * log2(N)      (N >= 1)

N  = (LN / 40)^(1 / 0.35)   (LN < 40)
N  = 2^((LN - 40) / 10)     (LN >= 40)
```

These convert between loudness and loudness *level*; they do not calculate loudness from
raw samples — that needs the auditory filtering, frequency-dependent sensitivity,
excitation-to-loudness transformation, and summation of the selected model. Only report
calibrated sones when the signal calibration and model assumptions are known.

## Sharpness (DIN 45692)

Sharpness weights the specific-loudness distribution toward higher frequencies; the unit
is **acum**:

```
S = k * ∫ N'(z) g(z) z dz / ∫ N'(z) dz

g(z) = 1                                  (z <= 15.8)
     = 0.15 * e^(0.42 (z - 15.8)) + 0.85  (z > 15.8)
```

`N'(z)` is specific loudness at Bark rate `z`; `k` is commonly `0.11` (the standard
specifies a 0.105–0.115 range with a reference-sound calibration). Don't substitute
spectral centroid for `N'(z)` if you want DIN-style sharpness.

## Roughness

Recommended models: **Daniel–Weber (1997)** or the **Sottek model (ECMA-418-2)**.

Reference condition: a 1 kHz tone at 60 dB SPL, amplitude-modulated at 70 Hz with 100%
modulation, is calibrated to **1 asper**. The Daniel–Weber approach is a signal-processing
model, not a single spectral formula:

1. Divide the signal into overlapping frames.
2. Apply outer-/middle-ear frequency weighting.
3. Decompose the sound into Bark bands.
4. Extract each band's envelope and filter its modulation content around the roughness
   region.
5. Calculate generalized modulation depth.
6. Apply frequency-dependent weighting and account for correlations between adjacent bands.
7. Sum and calibrate the result.

Don't implement roughness as just the sum of beating between pairs of FFT peaks — that is
a proxy, not a published perceptual roughness model.

## Fluctuation strength

Reference condition: a 1 kHz tone at 60 dB SPL with 100% amplitude modulation at 4 Hz is
calibrated to **1 vacil**. For arbitrary audio, the **Osses–García–Kohlrausch (2016)**
model calculates modulation depths in auditory bands, weights them by modulation rate and
frequency, and combines contributions with inter-band correlation terms.

A deliberately generated, sinusoidally amplitude-modulated test tone is:

```
x(t) = A [1 + m cos(2 π f_m t)] cos(2 π f_c t)
```

`m` is modulation depth, `f_m` modulation frequency, `f_c` carrier frequency. This is a
test signal, not a fluctuation-strength formula.

## Tonality, masking, and audibility

### Absolute threshold of hearing

An empirical approximation for the threshold of hearing in quiet (dB SPL):

```
Tq(f) = 3.64 (f/1000)^-0.8 - 6.5 e^(-0.6 (f/1000 - 3.3)^2) + 1e-3 (f/1000)^4
```

An approximate threshold curve, not a complete hearing model.

### MPEG-style masking

The MPEG psychoacoustic model identifies tonal and non-tonal maskers, calculates
individual masking thresholds, applies a spreading function over Bark distance, and
combines masker thresholds with the threshold in quiet in the power domain:

```
Tg(i) = 10 log10( 10^(Tq(i)/10) + Σ_j 10^(Tj(i)/10) )
```

`Tg(i)` is the global masking threshold for spectral line `i`, `Tq(i)` the threshold in
quiet, and `Tj(i)` each masker's contribution. The signal-to-mask ratio is then
`SMR(i) = L(i) - Tg(i)` (positive = above the estimated masking threshold). A codec's
masking model is not a universal predictor of human detection for every stimulus.

### Tonality

There is no single universal "tonality"; choose a defined metric. A simple band-energy
ratio is:

```
H = E_tonal / E_total
```

Its result depends on how tonal components are detected and must not be presented as a
standardized perceptual metric.

## Equal-loudness contours

Standard: **ISO 226:2023**. The contours specify the SPL required at different frequencies
for pure tones to be perceived as equally loud, defined for specific listening conditions.
Implement the published tabulated frequencies and coefficients and interpolate, rather
than approximating the contour with a generic filter. They apply to pure tones under
specified conditions — not a complete loudness model for arbitrary audio.

## Pitch salience

There is no universal scalar for pitch salience. Expose distinct, complementary
measurements instead:

- **F0 confidence** — a pitch detector's confidence or periodicity estimate.
- **Harmonicity** — energy near harmonic partials vs residual/non-harmonic energy.
- **Missing-fundamental support** — whether harmonics imply a common fundamental even when
  energy at F0 is absent.
- **Masking-adjusted prominence** — a component vs its estimated masking threshold.

## Spatial perception

Most spatial measurements are acoustic cues, not complete psychoacoustic models. For
stereo:

```
M[n] = (L[n] + R[n]) / 2        S[n] = (L[n] - R[n]) / 2
ρ_LR = Σ L[n] R[n] / sqrt( Σ L[n]² Σ R[n]² )
```

Mid/side energy and inter-channel correlation describe stereo structure; they do not by
themselves estimate perceived width, which depends on additional cues, playback
configuration, and listening conditions.

## Implementation priorities

| Priority | Feature | Implementation route |
| --- | --- | --- |
| 1 | Bark and ERB scales | Implement the equations above |
| 2 | ATH and masking threshold | Inspect `audio_samples`; compare with `oxideav-mp2::psy` |
| 3 | Sharpness | DIN 45692 on a validated specific-loudness curve |
| 4 | Loudness | Implement or port a recognized ISO model |
| 5 | Tonality | Begin with a documented tonal-energy ratio |
| 6 | Roughness | Implement a published Daniel–Weber or ECMA model |
| 7 | Fluctuation strength | Port a published arbitrary-signal model |
| 8 | Equal-loudness contours | ISO 226 tables and interpolation |
| 9 | Spatial cues | Mid/side, correlation, cross-correlation, level differences |

## Suggested Rust module structure

```
psychoacoustics/
├── scales.rs            # Bark, ERB, frequency conversions
├── hearing_threshold.rs # Absolute threshold of hearing
├── masking.rs           # Maskers, spreading, SMR
├── loudness.rs          # Selected ISO loudness model
├── sharpness.rs         # DIN 45692
├── roughness.rs         # Published roughness model
├── fluctuation.rs       # Fluctuation strength
├── tonality.rs          # Tonal prominence / custom ratios
├── equal_loudness.rs    # ISO 226 contours
└── spatial.rs           # Stereo and binaural cues
```
