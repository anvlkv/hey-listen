# Analyzers

`list_analyzers` is the authoritative catalog (ids, sections, families, keywords, option
defaults); `get_analyzer { id }` gives `about` copy, **option metadata**
(`key/label/default/min/max/step/unit/help`), `family`, `decimatable`, and `summaryKeys`.
Use those for exact ranges — this file is a curated map of *what each tool is for* and the
non-obvious usage facts. Unknown option keys are **errors** (camelCase; snake_case
aliases accepted).

Result **families** (how `result` is shaped): `scalar`, `series`, `spectrum`,
`spectrogram`, `matrix`, `events`, `notes`.

## Shared params (apply to every analyzer)

`fftSize` (2^n), `hop` (**fraction of `fftSize`** — `0.25` = 75% overlap), `windowFn`
(hann etc.), `channel` (default 0), `resampleTo`, `freqMinHz` / `freqMaxHz` (0 = full
range), `randomizedOverlap`. Set once with `set_shared_params` / `-p`.

## Cross-cutting notes

- **Channel.** Tools run on one channel (`channel`, default 0). For stereo work the
  louder of the two channels sets what's audible — check both.
- **Gating.** `frameRms`, `spectralCentroid`, `spectralRolloff`, `spectralFlatness`,
  `zeroCrossingRate`, `harmonicRatio` take `gateDb` (0 = off; dB below the window peak)
  and `gateFloorDb` (absolute dBFS floor). Gated frames become `null`.
- **Reliability flags.** Trust a pitch median only when `voicedFrames ≥ 8`
  (`f0Reliable: 1`); an FM rate only when `fmReliable: 1`.
- **`harmonicRatio` is max autocorrelation, not HNR in dB.** Use `spectralFlatness` for
  noisiness.
- **Perception family** (`loudness`, `specificLoudness`, `sharpness`, `roughness`,
  `fluctuationStrength`, `tonality`, `masking`) needs `calibrationDbSpl` (0 =
  uncalibrated → ~0). These are custom approximations, not validated standards; their
  min/max summaries land on silent frames, so gate by level and use medians.

---

## Time

### waveform — `series`
Peak/RMS envelope over time; full-scale buckets are marked (clipping) and the readout
counts them. An overview, **not raw samples**. Options: none.

### levels — `scalar`
Peak, RMS (dBFS) and duration over the window. Quick headroom/loudness check. Options: none.

### frameRms — `series`
Frame-centred RMS in dBFS — the amplitude envelope at whatever resolution you ask for.
Options: `frameMs` 10 (0.1–1000), `hopMs` 5 (0.05–1000), `gateDb` 0, `gateFloorDb` −120.

> **Fine-envelope + cap.** `frameMs`/`hopMs` go sub-millisecond, but the result is capped
> at **8192 frames** — the engine *widens the hop* to fit, so a long window coarsens it
> (10 s → ~1.2 ms). To reach the floor of a **2-sample hop** (45 µs) use a short window
> (≤ ~0.37 s); the effective `hopSize`/`frameSize` are reported. This is the tool for
> sample-accurate work (loop seams, click avoidance, breaths).

## Spectral

### spectrum — `spectrum`
Averaged FFT magnitude vs frequency. Spectral balance / timbre; set `fftSize` via shared
params for more bins. Options: none.

### spectrogram — `spectrogram`
STFT magnitude heatmap over time × frequency. Options: none (display options live in the UI).

### melSpectrogram — `matrix`
Log-mel energies over time × mel bands. Options: `nMels` 64.

### mfcc — `matrix`
Mel-frequency cepstral coefficients over time. Options: `nMels` 64, `nMfcc` 13.

### chromagram — `matrix`
Energy per pitch class (12) over time. Frames are **normalized (sum ≈ 1)**, so a band is
a proportion; average frames to get a pitch-class profile / key estimate. To trust the
letter labels, cross-check against a `pitchYin` f0 histogram. Options: none.

### spectralCentroid — `series`
Spectral centre of mass (brightness). Options: `gateDb` 0, `gateFloorDb` −120. Not the
same as perceived `sharpness` (perception family) — a physical measure.

### spectralFlux — `series`
Frame-to-frame spectral change (novelty/onset strength). **Ungated** — a cross-check, not
a segmenter. Options: none.

### spectralRolloff — `series`
Frequency below which `rolloffPercent` of the energy lies. Options: `rolloffPercent` 0.85,
`gateDb` 0, `gateFloorDb` −120.

### spectralFlatness — `series`
Geometric/arithmetic mean ratio: ~0 = tonal, ~1 = noise. Options: `gateDb` 0,
`gateFloorDb` −120.

### spectralContrast — `matrix`
Peak-to-valley ratio per octave band. Options: `nBands` 6.

### spectralBandwidth — `series`
Spread around the centroid (spectral variance). Options: none.

### spectralEntropy — `series`
Shannon entropy of the spectrum (order vs disorder). Options: none.

### spectralCrest — `series`
Peak-to-average spectral power ratio; tonal peaks vs flat/transient. Options: none.

### harmonicRatio — `series`
Max normalized autocorrelation (0–1), **not HNR in dB**. Options: `minF0Hz` 50,
`maxF0Hz` 4000, `gateDb` 0, `gateFloorDb` −120.

### zeroCrossingRate — `series`
Sign-change rate; low = low-frequency/voiced, high = noisy/percussive. Options: `gateDb` 0,
`gateFloorDb` −120.

### modulation — `series`
AM and FM modulation spectra (tremolo / vibrato / trill). Options: `frameMs` 10,
`hopMs` 5, `modMinHz` 0.5, `modMaxHz` 100, `detrend` 1, `pitchFrameMs` 40,
`pitchHopMs` 5, `minVoicedSecs` 0.2, `topPeaks` 3, `minF0Hz` 50, `maxF0Hz` 2000.

## Pitch

### pitchYin — `series`
YIN fundamental track. Options: `minF0Hz` 50, `maxF0Hz` 2000, `yinThreshold` 0.12.

### pitchPyin — `series`
Probabilistic YIN (Viterbi-smoothed). Options: `minF0Hz` 50, `maxF0Hz` 2000.

### pitchAutocorr — `series`
Autocorrelation fundamental track. Options: `minF0Hz` 60, `maxF0Hz` 1200.

### noteMetrics — `notes`
Gated sound events: spans, gaps, level, f0, voice-quality proxies. Options: `frameMs` 10,
`hopMs` 5, `gateDb` 35, `gateFloorDb` −60, `hysteresisDb` 3, `minNoteMs` 20,
`minGapMs` 30, `syllableGapMs` 0, `envelopePoints` 7, `pitchFrameMs` 40,
`pitchHopMs` 5, `minF0Hz` 50, `maxF0Hz` 2000.

> Compact returns **`bounds`** for every event, so segmenting never needs a full result.
> `syllableGapMs` > 0 also yields `syllables` (adjacent notes merged across a short gap);
> amplitude belongs to the syllable, not the note. Set `minF0Hz`/`maxF0Hz` per corpus —
> defaults are voice-ish (50–2000 Hz) and a ~3 kHz swift needs an explicit range.

## Rhythm

### tempo — `events`
BPM + beat grid + onset-strength curve. `confidence` matters: on rubato / no-percussion
music it can be low (~20–30 %) and the BPM is unreliable — report the confidence, don't
state the BPM as fact. Options: none.

### onsets — `events`
Spectral-flux onset peaks. **Ungated** — a cross-check, not a segmenter. Options: none.

### downbeats — `events`
Estimated bar-start beats. Options: `barLength` 4.

## Loudness (EBU R128)

### loudnessIntegrated — `scalar`
Integrated LUFS. Options: none.

### loudnessMomentary — `series`
Momentary (400 ms) LUFS over time. Options: `windowMs` 0 (0 = standard 400 ms block).
Smooths short events — use `frameRms` for fine dynamics.

### loudnessRange — `scalar`
LRA (loudness spread) in LU — dynamic range. Options: none.

## Perception

All of these share `calibrationDbSpl` (0 = uncalibrated/relative). Set it to the dB SPL of
a full-scale sine (e.g. `100`) to read absolute values. They are custom approximations,
not validated standards; summarize with level-gated medians, not min/max.

### criticalBands — `matrix`
Bark or ERB critical-band energy over time (rectangular bin integration, not an auditory
filterbank). Options: `scale` 0.

### loudness — `series`
Moore–Glasberg stationary loudness, **sone/phon** (not ISO 532-2 validated). Options:
`calibrationDbSpl` 0. Not interchangeable with EBU `loudnessIntegrated` (different model).

### specificLoudness — `matrix`
N′(z) specific-loudness map over ERB bands, **sone/Cam** density. Options:
`calibrationDbSpl` 0.

### sharpness — `series`
Perceived sharpness, **acum** (custom Bark-weighted model; not DIN 45692). 1 kHz reference
≈ 1 acum. Options: `calibrationDbSpl` 0.

### roughness — `series`
Perceived roughness, **asper** (custom band-envelope model near 70 Hz; not ECMA-418-2).
Options: `calibrationDbSpl` 0.

### fluctuationStrength — `series`
Perceived fluctuation, **vacil** (custom band-envelope model near 4 Hz; unvalidated).
Options: `calibrationDbSpl` 0.

### masking — `spectrum`
Masking threshold + signal-to-mask ratio (MPEG-style codec estimate). Options:
`calibrationDbSpl` 0.

### tonality — `series`
Tonal-energy ratio proxy (dimensionless; not standardized perceptual tonality). Options:
`calibrationDbSpl` 0.

### spatial — `series`
Mid/side levels and inter-channel correlation (acoustic cues, **not** perceived width).
Options: `calibrationDbSpl` 0. Correlation near 1 = mono-ish; wide/near −1 = decorrelated.
