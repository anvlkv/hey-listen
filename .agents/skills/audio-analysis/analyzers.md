# Analyzers

`list_analyzers` is the authoritative catalog (ids, sections, families, keywords, option
defaults); `get_analyzer { id }` gives `about`, option metadata
(`key/label/default/min/max/step/unit/help`), `family`, `decimatable`, `summaryKeys`. Use
those for exact ranges — this file is a curated map of *what each tool is for* + the
non-obvious facts. Unknown option keys are **errors** (camelCase; snake_case aliases
accepted).

Result **families** (how `result` is shaped): `scalar`, `series`, `spectrum`,
`spectrogram`, `matrix`, `events`, `notes`.

## Shared params

`fftSize` (2^n), `hop` (**fraction of `fftSize`** — `0.25` = 75% overlap), `windowFn`,
`channel` (default 0), `resampleTo`, `freqMinHz`/`freqMaxHz` (0 = full range),
`randomizedOverlap`. Set once (`set_shared_params` / `-p`).

## Cross-cutting

- **Channel.** Tools run on one channel (`channel`, default 0). For stereo the **louder**
  channel sets what's audible — check both (and per instant; see the root gotchas).
- **Gating.** `frameRms`, `spectralCentroid`, `spectralRolloff`, `spectralFlatness`,
  `zeroCrossingRate`, `harmonicRatio` take `gateDb` (0 = off; dB below window peak) and
  `gateFloorDb` (absolute dBFS floor). Gated frames → `null`.
- **Reliability.** Trust a pitch median only when `voicedFrames ≥ 8` (`f0Reliable: 1`); an
  FM rate only when `fmReliable: 1`.
- **`harmonicRatio` is max autocorrelation, not HNR in dB** — use `spectralFlatness` for
  noisiness.
- **Perception family** needs `calibrationDbSpl` (0 = uncalibrated → ~0). Custom
  approximations, not validated standards; use level-gated medians, not min/max.

---

## Time

### waveform — `series`
Peak/RMS envelope over time; full-scale buckets marked (clipping) and counted. Overview,
**not raw samples**.

### levels — `scalar`
Peak, RMS (dBFS), duration. Quick headroom/loudness check.

### frameRms — `series`
Frame-centred RMS in dBFS — the amplitude envelope at your resolution. Options: `frameMs`
10 (0.1–1000), `hopMs` 5 (0.05–1000), `gateDb` 0, `gateFloorDb` −120.

> Fine-envelope + cap: result capped at **8192 frames** (hop widens to fit); a short window
> (≤ ~0.37 s) reaches the **2-sample hop** (45 µs). The tool for sample-accurate loop seams.

## Spectral

### spectrum — `spectrum`
Averaged FFT magnitude vs frequency. Spectral balance/timbre; more `fftSize` = more bins.

### spectrogram — `spectrogram`
STFT magnitude heatmap over time × frequency.

### melSpectrogram — `matrix`
Log-mel energies over time × mel bands. Options: `nMels` 64.

### mfcc — `matrix`
Mel-frequency cepstral coefficients. Options: `nMels` 64, `nMfcc` 13.

### chromagram — `matrix`
Energy per pitch class (12) over time, normalized (sum ≈ 1) — a band is a proportion;
average frames for a pitch-class/key profile. **Bands are numeric indices 0–11, not letter
names.**

### spectralCentroid — `series`
Spectral centre of mass (brightness). Options: `gateDb` 0, `gateFloorDb` −120. Physical,
not the same as perceived `sharpness`.

### spectralFlux — `series`
Frame-to-frame spectral change (novelty/onset strength). **Ungated** — cross-check, not a
segmenter.

### spectralRolloff — `series`
Frequency below which `rolloffPercent` of the energy lies. Options: `rolloffPercent` 0.85,
`gateDb` 0, `gateFloorDb` −120.

### spectralFlatness — `series`
Geometric/arithmetic mean ratio: ~0 tonal, ~1 noise. Options: `gateDb` 0, `gateFloorDb` −120.

### spectralContrast — `matrix`
Peak-to-valley ratio per octave band. Options: `nBands` 6.

### spectralBandwidth — `series`
Spread around the centroid.

### spectralEntropy — `series`
Shannon entropy of the spectrum.

### spectralCrest — `series`
Peak-to-average spectral power ratio.

### harmonicRatio — `series`
Max normalized autocorrelation (0–1), **not HNR in dB**. Options: `minF0Hz` 50,
`maxF0Hz` 4000, `gateDb` 0, `gateFloorDb` −120.

### zeroCrossingRate — `series`
Sign-change rate; low = voiced/low-frequency, high = noisy/percussive. Options: `gateDb` 0,
`gateFloorDb` −120.

### modulation — `series`
AM + FM modulation spectra (tremolo/vibrato/trill). Options: `frameMs` 10, `hopMs` 5,
`modMinHz` 0.5, `modMaxHz` 100, `detrend` 1, `pitchFrameMs` 40, `pitchHopMs` 5,
`minVoicedSecs` 0.2, `topPeaks` 3, `minF0Hz` 50, `maxF0Hz` 2000.

## Pitch

### pitchYin — `series`
YIN fundamental track. Options: `minF0Hz` 50, `maxF0Hz` 2000, `yinThreshold` 0.12.

### pitchPyin — `series`
Probabilistic YIN (Viterbi-smoothed). Options: `minF0Hz` 50, `maxF0Hz` 2000.

### pitchAutocorr — `series`
Autocorrelation fundamental track. Options: `minF0Hz` 60, `maxF0Hz` 1200.

### noteMetrics — `notes`
Gated events: spans, gaps, level, f0, voice quality. Options: `frameMs` 10, `hopMs` 5,
`gateDb` 35, `gateFloorDb` −60, `hysteresisDb` 3, `minNoteMs` 20, `minGapMs` 30,
`syllableGapMs` 0, `envelopePoints` 7, `pitchFrameMs` 40, `pitchHopMs` 5, `minF0Hz` 50,
`maxF0Hz` 2000.

> Compact returns **`bounds`** for every event (segment without a full result).
> `syllableGapMs` > 0 yields `syllables` (adjacent notes merged across a gap); amplitude
> belongs to the syllable. Set `minF0Hz`/`maxF0Hz` per corpus — defaults are voice-ish
> (50–2000 Hz).

## Rhythm

### tempo — `events`
BPM + beat grid + onset-strength curve. `confidence` matters: on rubato/no-percussion music
it's often low (~20–30 %) — report it, don't state BPM as fact.

### onsets — `events`
Spectral-flux onset peaks. **Ungated** — cross-check, not a segmenter.

### downbeats — `events`
Estimated bar-start beats. Options: `barLength` 4.

## Loudness (EBU R128)

### loudnessIntegrated — `scalar`
Integrated LUFS.

### loudnessMomentary — `series`
Momentary (400 ms) LUFS. Options: `windowMs` 0 (0 = standard 400 ms). Smears short events —
use `frameRms` for fine dynamics.

### loudnessRange — `scalar`
LRA in LU — dynamic range.

## Perception

All share `calibrationDbSpl` (0 = uncalibrated). Custom approximations, not validated
standards; summarize with level-gated medians.

### criticalBands — `matrix`
Bark/ERB critical-band energy over time. Options: `scale` 0.

### loudness — `series`
Moore–Glasberg loudness, **sone/phon**. Options: `calibrationDbSpl` 0. Not interchangeable
with EBU `loudnessIntegrated`.

### specificLoudness — `matrix`
N′(z) over ERB bands, **sone/Cam**. Options: `calibrationDbSpl` 0.

### sharpness — `series`
Perceived sharpness, **acum** (1 kHz ref ≈ 1 acum). Options: `calibrationDbSpl` 0.

### roughness — `series`
Perceived roughness, **asper**. Options: `calibrationDbSpl` 0.

### fluctuationStrength — `series`
Perceived fluctuation, **vacil**. Options: `calibrationDbSpl` 0.

### masking — `spectrum`
Masking threshold + signal-to-mask ratio. Options: `calibrationDbSpl` 0.

### tonality — `series`
Tonal-energy ratio proxy (dimensionless). Options: `calibrationDbSpl` 0.

### spatial — `series`
Mid/side levels + inter-channel correlation (acoustic cues, **not** perceived width).
Options: `calibrationDbSpl` 0. Correlation near 1 = mono-ish; near −1 = decorrelated.
