For Hey Listen, I’d treat visualisation as part of the analysis, not just a way to display numbers. The best chart should help answer a particular listening question:

- What is happening in the sound?
- When does it happen?
- Which frequencies contribute?
- How might a listener perceive it?
- What changed between two recordings or processing settings?

I’d use three complementary visual layers:

1. Overview — a small set of perceptual metrics over time.
2. Diagnostic views — detailed frequency, modulation, and spatial plots.
3. Comparison views — overlays, differences, and reference markers for A/B analysis.

Below is a chart proposal for every analysis type we discussed, including some more experimental ideas. I’ll distinguish the charts that should be central from those that are better as optional diagnostic tools.

## 1. Core signal views

These are the foundation. Every perceptual analysis should be navigable back to the actual signal.

![Ocenaudio audio editor review | TechRadar](https://images.openai.com/static-rsc-4/OPciRWOS0_Ee31TwsMHAsN2x5xDvwgTUurrug0mnE49soKiBiJCgZ8nEsj9f_VRIOPYFInwTVSVWRFoQdb-5ps5y31EiW0ad7fktSEeH1UNZcuQl3RAxJEMJzmuYKonZFS7oV59bapbWiXCIm7tOF09iFxMypHVnecl7YnyuTu4?purpose=inline)

Waveform / amplitude envelope

Chart: amplitude against time, with left and right channels separated or overlaid.

Why: reveals transients, silence, clipping, dynamics, and the timing of events.

Add: RMS and peak envelopes as optional overlays; selection and playback cursor should be shared with every other chart.

![Spectrum Analyzer – MiRA](https://images.openai.com/static-rsc-4/sYa-M7xcaU_-vNNswydUUx8ygsGhjYEwIKjBTKZHXPY3LPVR_z5eLNNgruu5DNc6Huf1X2gxpz-H7nAYFvinVCI9uG6yxYPJKnDFeHzX5_FUsIh33gambodOZTiL9-Edk2Wtdcfh_JJzqpyEdMbGfadidQPJmYGbFHaU81NrStk?purpose=inline)

Frequency spectrum

Chart: magnitude or power against logarithmic frequency (Hz), with a dB scale.

Why: reveals tonal peaks, harmonics, resonances, broadband noise, and spectral balance.

Add: peak labels, fundamental/harmonic markers, and optional octave, Bark, or ERB band boundaries.

![Using display.specshow — librosa 0.11.0 documentation](https://images.openai.com/static-rsc-4/_RgAsbSa2y4NXUOqiVrRPJHrXRUsZs7pxbz0j4lW6bJQW2rURLJGUUf-x3eOsdFsikChA3Egp4OJQJeDXIaL1hJYmkXAcmXbEartY94FWel7VD8vVKxRBl67i-hLu4kCrJhlKVwxAYC5y12p9rMSm5YoMwjNxPMpqC6XGTh-F-0?purpose=inline)

Spectrogram

Chart: time × frequency heatmap, colour representing energy in dB.

Why: probably the most useful general-purpose diagnostic view. Reveals how frequency content evolves: harmonics, transients, sweeps, noise, and resonances.

Add: switch between linear Hz, logarithmic Hz, Bark, and ERB axes. Keep the colour scale fixed when comparing recordings.

My recommendation: make the spectrogram the main diagnostic canvas, with the waveform immediately above it. Selecting a time region in either should update all other views.

## 2. Auditory frequency scales and hearing

These analyses are less about displaying the sound itself and more about displaying how the ear organises it.

Bark / ERB / Mel frequency scales

![声学感知刻度(mel scale、Bark scale、ERB)与声学特征提取(MFCC、BFCC、GFCC)\_hz2erb-CSDN博客](https://images.openai.com/static-rsc-4/vl0LvIv-xoH4ba1TgrlXgDnKTP37d2OcYCjMgQBl4kP9iYP4bJihC9-MPpmKW0m70er4FA9eCUXZufdM1KBRXVcoRHm3jFe9c1472s2ElJIRoiuUaaMNLcarTPI48fAL27P6733zBAtOgubbatU-tHx61t72mlrKVPLlG6Z4Yfw?purpose=inline)

[blog.csdn.net](https://blog.csdn.net/qq_34218078/article/details/125145458?utm_source=chatgpt.com)

Chart: a frequency-axis transformation plot: Hz on the horizontal axis, Bark or ERB number on the vertical axis. Alternatively, show band boundaries overlaid on the spectrum.

Why: demonstrates how auditory resolution changes with frequency. This is useful for understanding the model, but not particularly useful as a standalone analysis result.

Best interaction: a scale selector on the spectrum and spectrogram rather than a dedicated chart that occupies permanent space.

Absolute threshold of hearing (ATH)

![Can We Measure Our Age in dB? … You Must Be Kidding? | Canadian Audiologist](https://images.openai.com/static-rsc-4/HQ6J4H1JT8Onx1XlBpqSHKksrw6MQ_xulnuuViHIOhbmSPMKanU0BsnjOFgJLik7Q2PSviQrnjoL1Kmc03DP-AFkVNQJgunyTgOuhmdLpy-x2KuOPalLIJ3xVUNH8YaiqC7LRvOx6D-JJXFmNvn5pVgT5k_7rPdQaHAOdMZgkhs?purpose=inline)

[canadianaudiologist.ca](https://canadianaudiologist.ca/can-we-measure-our-age-in-db-feature/?utm_source=chatgpt.com)

Chart: frequency (log Hz) × sound pressure level (dB SPL), with the hearing threshold curve and the measured spectrum.

Why: shows which parts of the signal are close to the nominal threshold of human hearing.

Add: shaded regions below the threshold and a vertical distance between the signal and threshold. Make clear that this is a reference threshold, not a guarantee of audibility in every listening situation.

Equal-loudness contours

![Equal loudness contours (ISO 226-2003) - Lawrence Yule](https://images.openai.com/static-rsc-4/OY6a9NyIeLMb05dMRGggc8609dSaeusQAIKntpFsBiwGYZpbqfy5fxGrdrKag21ieSf4q0dzFatl0_qPeuUD0zomoEASZYC652XVHNu9i9fmDbC2DnarEq9W_SzLgKxFqmmk02-8K-5HZxH6sgbQywJuWbcU6VqZv9D4-p8Yehw?purpose=inline)

[lawrenceyule.com](https://lawrenceyule.com/2024/06/07/equal-loudness-contours-iso-226-2003/?utm_source=chatgpt.com)

Chart: frequency × SPL, with several phon contours.

Why: demonstrates why equal physical levels at different frequencies don't sound equally loud.

Add: a selectable phon level and a highlighted contour. Overlay a signal spectrum to give the user a sense of how its frequency distribution relates to perceived loudness.

Important: this is a reference model for pure tones under specified conditions, not a direct loudness calculation for arbitrary audio.

## 3. Loudness and masking

These are among the most informative perceptual views. I would give them a prominent place in the application.

Loudness over time

![acousticLoudness - Perceived loudness of acoustic signal - MATLAB](https://images.openai.com/static-rsc-4/5ypkdDDT2W7E4bl-JGgsAS8ms2KNxkGXXs_DBnesk2PYfsHquaPHrYiFcF0SImZ_CFgtsfYpVAcnnig09LLQICQDJQ8wiGQ1hps8yAtfWz8bgpdKg4Uv6rr6DHSEi3QvkY4bG7yv6UXh5vTJCnS53yq-JP6x4uRA1-gvT5UAJQs?purpose=inline)

[fr.mathworks.com](https://fr.mathworks.com/help/audio/ref/acousticloudness.html?utm_source=chatgpt.com)

Chart: time × loudness (sones).

Why: gives a perceptual counterpart to the amplitude envelope. It can show how loud a sound is perceived to be, rather than just how much signal energy it contains.

Add: overall loudness, maximum, percentiles (e.g. N5, N50, N95), and an optional SPL/RMS comparison line. Keep the units and model visible.

Specific loudness

![acousticLoudness - Perceived loudness of acoustic signal - MATLAB](https://images.openai.com/static-rsc-4/43LJ_y7jm6L5R5NgKg1cyBOLn8I8qYnQCROpPx68y51kBWeU7ge3anlNdX5XMBKWANOtIz3RjEVonqYQDCC-GbOWR5D9ZFUZ2_cRVWm9dc1VyaheONb8j-3kqE6otq4SJRqUyf3wMnYnvv5J1sEiA-qyFoYl1XK21pz7Ssvj4OA?purpose=inline)

[la.mathworks.com](https://la.mathworks.com/help/audio/ref/acousticloudness.html?utm_source=chatgpt.com)

Chart: Bark × specific loudness (sones/Bark), displayed as a curve.

Why: shows which auditory frequency regions contribute to the perceived loudness. This is particularly useful when two sounds have the same total loudness but different spectral character.

Creative extension — loudness landscape: show specific loudness over both time and Bark as a heatmap. It gives you a perceptual equivalent of a spectrogram.

Masking threshold

![Lossy audio compression: principles, methods, misconceptions](https://images.openai.com/static-rsc-4/b6nUojt3fJOY94crlBQbvdP24HwAUqPsnAdLz3PTOC2aK1fJzjUjEIfwhgnu3plKQUlNdGyo_PZFhAKUwCf9eSrFDLWuhvEF6PvDHFqJI5D2IqY9wAknYha0m7YVKT6-I_6G166ow25kwv6-fKsU-BC9843QH9VbuJ9yODFQ5wc?purpose=inline)

[tonestack.net](https://www.tonestack.net/articles/digital-audio-compression/lossy-audio-compression-primer.html?utm_source=chatgpt.com)

Chart: frequency × level, with:

- measured spectrum;
- threshold in quiet;
- individual tonal and noise masker thresholds;
- combined masking threshold.

Why: shows which spectral components may be masked by other components.

Add: a masking margin curve: signal level minus masking threshold. Positive values indicate energy above the estimated threshold; negative values indicate energy below it.

Temporal masking: a separate time × level view showing masker events and estimated forward/backward masking windows. Don't conflate this with simultaneous spectral masking.

A useful reference for these displays is the traditional loudness-spectrum representation: Bark on one axis, sones on another, and time as a third dimension. It makes the relationship between frequency, loudness, and temporal change tangible.&#x20;

![image](https://www.google.com/s2/favicons?domain=https://www.cieri.net\&sz=32)

cieri.net+1



## 4. Sound quality: sharpness, roughness, fluctuation, tonality

This is where Hey Listen could become more distinctive than a conventional spectrum analyser.

Sharpness

![Sharpness and booming | Acoustics | University of Salford](https://images.openai.com/static-rsc-4/Rijnr3awADcDlUr5fGkSkaQMXaSF9u-kOd4-TvBKaeLZIEMJ67F_ztcrffbMp9X2FY3EhXcrjW4duLXR6baTLMbGszzJQw2erAw6sN80bhkEUEBGMjdDlNSBCwIm2b7gmuFIBj5t6vN79hcrFGDjnPNmankqs1KKyJmxECw47PU?purpose=inline)

[acoustics.salford.ac.uk](https://acoustics.salford.ac.uk/psychoacoustics/sound-quality-making-products-sound-better/an-introduction-to-sound-quality-testing/sharpness-and-booming/?utm_source=chatgpt.com)

Primary chart: specific loudness against Bark, with the sharpness weighting function overlaid.

Secondary chart: sharpness (acum) against time.

Why: the first explains why the sound is sharp; the second shows when it becomes sharp.

Add: a shaded high-frequency contribution, so users can see how much of the result comes from the upper Bark bands.

Roughness

![The use of sampling for imaging continuous signals by Adam Weisser](https://images.openai.com/static-rsc-4/BobTDRK6RUvWc7rEHDVhoplTZCKGZbZGXY0CS5aWuF3m3R62R1qK3QuIpwqhRsueOlGCE0glvCnkmcOQfR00PWYpRXJ1B6CCHoDWqWDVsQ5Djd9BENIROOJeI475SzvI3DJnatRP4FgDx8xGwxDyqwIvELQ90kixRmdRj_iTjuQ?purpose=inline)

[hearingtheory.org](https://hearingtheory.org/Chapter14.html?utm_source=chatgpt.com)

Primary chart: modulation frequency × modulation strength, with the roughness-sensitive region highlighted.

Secondary chart: roughness (asper) over time.

Creative extension — roughness spectrogram: time × auditory frequency (Bark or ERB), with colour representing local roughness contribution.

Why: a single asper value hides whether roughness comes from one frequency region or several, and when it occurs. The modulation view helps explain the source of the sensation.

Fluctuation strength

![Amplitude-modulated signal. (A) 6 Hz (modulation frequency, f m ) sine... | Download Scientific Diagram](https://images.openai.com/static-rsc-4/fZ_nGQIWYFEuBxVVqfRa-_7fF4gT6HQS6Uri9BBFHrsN0j_-VClPa1EgbZYy8QeoRh3W3XQHCWERBwF1a9a2WWKNxpc0QPgdQAG8rfR6wFcsRj2QC99ua1hX-bAJGdyYYyWVPoX510vOYAcemcgx-YzEG8siq6LgRQekjWbeHZg?purpose=inline)

[researchgate.net](https://www.researchgate.net/figure/Amplitude-modulated-signal-A-6-Hz-modulation-frequency-f-m-sine-wave-with-an_fig5_224947161?utm_source=chatgpt.com)

Primary chart: modulation frequency × modulation depth, with the low-frequency fluctuation-sensitive region highlighted.

Secondary chart: fluctuation strength (vacil) over time.

Why: reveals slow changes in amplitude or frequency that create a wavering sensation.

Add: annotate the strongest modulation frequencies. A peak around 4 Hz is especially relevant to classic fluctuation-strength models.

Tonality

![Siemens Digital Industries Software Community](https://images.openai.com/static-rsc-4/SmPUj5vpfUCp8PUsXsnznoLIeO2bz8aYrAU6H0el1qs2w1HmypnWJheaC8AXGV9mpvaI7M6Wfg6xxguRuNVY9GqvEx8TPN1oKSryWpTPlm_fr7kCAHLRe072IoRWcTprQ_roNQo1uTBV0Zoulvq66ApLmwNio0_hoZ3ovRsuiAc?purpose=inline)

[community.sw.siemens.com](https://community.sw.siemens.com/s/question/0D54O000061xkxBSAQ/have-you-seen-this-before-prominence-ratio-pr-inconsistency?utm_source=chatgpt.com)

Primary chart: frequency × tonal prominence, or frequency × tone-to-noise ratio.

Secondary chart: tonality over time.

Why: identifies prominent discrete components against their surrounding noise.

Add: draw detected tonal peaks on the spectrum, with each peak's prominence and frequency. This is much more actionable than a single tonality score.

The specific-loudness curve is especially important for sharpness, while modulation-sensitive representations help explain roughness and fluctuation strength. These are not interchangeable metrics: their models and reference calibrations differ.&#x20;

![image](https://www.google.com/s2/favicons?domain=https://docs.jmrp.io\&sz=32)

phonometry+2



## 5. Pitch, harmonics, and spatial perception

Pitch salience

![Harmonic spectrum — librosa 0.10.2 documentation](https://images.openai.com/static-rsc-4/uxyeSQGAa37N0LoYtNa734h08hgpTXorHIOrEc0s6hD_pwxN9xnBi3SdIpl90m2Cym5-ty_WwtwLS9rrV76LPFNHuNmdnc-y2VvGyeQg2MR3ZvZwsocfJMPxgc2UFappkXQS05gHeJKoySESN8uL2TvaEcaRKjhX8x2W3waw3VI?purpose=inline)

[librosa.org](https://librosa.org/doc/0.10.2/auto_examples/plot_spectral_harmonics.html?utm_source=chatgpt.com)

Chart: time × frequency, with the estimated fundamental frequency (F0) drawn over the spectrogram.

Add:

- F0 confidence as line opacity or a secondary confidence track;
- detected harmonics as thin lines;
- octave ambiguity markers;
- missing-fundamental indication when harmonics support a perceived pitch despite no energy at F0.

Why: makes pitch estimation inspectable instead of presenting an F0 number as unquestionable truth.

Stereo image and spatial cues

![Metering Stereo Width - Gearspace](https://images.openai.com/static-rsc-4/72hktGF4lPM3ibspSVzpJChKrZBBt0K3MnLiR3EjObGZ7ipVJTu9aepPjDcevNjtOGqhg-Vz0LCV4Ph66y9VftzgT2To3g1AQhiXMbVN1qBqadPINKzYslSuqmuXuv6uMbGJooryWRW1U1pkaAu0yymxqEZ-zlk5WSM-upEbG44?purpose=inline)

[gearspace.com](https://gearspace.com/board/music-computers/1448451-metering-stereo-width.html?utm_source=chatgpt.com)

Primary chart: stereo vectorscope / goniometer (left channel against right channel).

Secondary charts:

- correlation coefficient over time;
- mid-side energy over time;
- interchannel level difference (ILD);
- interchannel time difference (ITD), if implemented.

Why: the vectorscope shows stereo width and phase behaviour at a glance; the time series explains when the image changes.

Creative extension — spatial fingerprint: a polar plot of estimated direction or interchannel delay against time, where the recording and model support meaningful directional estimates.

Caution: stereo width and interchannel correlation are not the same thing as perceived source localisation. A true spatial model needs more assumptions about the recording and listening setup.

## 6. Derived and combined indicators

These aren't necessarily separate low-level analyses, but they're useful ways to make the results understandable.

Loudness level (phon)

Use a conversion display or paired axis next to sones, rather than a separate large chart. A small sones-to-phon curve can be useful for explaining the relationship. Don't imply that phon is a direct conversion independent of the sound's spectrum.

Psychoacoustic annoyance

![File:SOUND QUALITY 19.png - OROS Wiki](https://images.openai.com/static-rsc-4/jTy25tU3xxBGDywW7ZgOh46OsDC2BzV2q3kVAG40wLI-GZyvUeh1kOvQOsuc8Xjm1Q292epOMsJ3h1lSRJEwPnBfCtGmXgR4WQoB35JB9qM-7ce8MaZ7kdNYTgXCPXJVqt-IQ8NYRyIgwobH3gSxGjn6AzfukvaqEwEZmuamOJI?purpose=inline)

[wiki.oros.com](https://wiki.oros.com/index.php?title=File:SOUND_QUALITY_19.png\&utm_source=chatgpt.com)

Chart: radar chart or four-axis profile for loudness, sharpness, roughness, and fluctuation strength.

Why: provides a compact sound-quality fingerprint. It can be useful for comparing recordings or processing configurations.

However, I would not use a radar chart as the primary analysis: it hides the time and frequency dimensions. Also, a combined annoyance score is model-dependent; it should be labelled with the formula/model and never presented as an objective universal measure of how annoying a sound is.&#x20;

![image](https://www.google.com/s2/favicons?domain=https://docs.jmrp.io\&sz=32)

phonometry+1



A/B comparison

![ADPTR AUDIO Metric AB – Plugin Alliance](https://images.openai.com/static-rsc-4/VyJnzqHtKRL8lRrPiH0nvU9UfoCKaTCg4YWA9zy4AuEr_6ZWlV6ZACNte75Qme2eWuBab0ffvWriLrrgDB1FKQM0fPdIbq1zBomoSJ-ib1LgUw6p04WTrUdW57bSfRKjwE_xI4u75uP0I9-dm4cIlM6YXHZFmOUQDmaJ0PTSjTg?purpose=inline)

[plugin-alliance.com](https://www.plugin-alliance.com/products/metric-ab?utm_source=chatgpt.com)

For virtually every metric, provide:

- overlay of A and B;
- difference curve (B − A);
- percentage or relative change where meaningful;
- synchronized playback and time selection.

For example, a sharpness difference curve could show exactly where a processed recording becomes brighter or less bright than its reference.

## 7. Other useful signal descriptors

These are not all psychoacoustic metrics, but they're valuable supporting analyses.

| Analysis           | Most informative chart                                   | What it tells you                                                                                    |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| RMS / energy       | Time-series line                                         | How the signal's energy changes                                                                      |
| Peak level         | Time-series line + peak markers                          | Transients and clipping risk                                                                         |
| Spectral centroid  | Time-series line                                         | How the spectral centre of mass changes; a rough brightness descriptor                               |
| Spectral rolloff   | Time-series line                                         | How much of the spectrum is concentrated below a chosen frequency                                    |
| Spectral flatness  | Time-series line or frequency-band heatmap               | Whether a region is more noise-like or tone-like                                                     |
| Spectral flux      | Time-series line                                         | How quickly the spectrum changes between frames                                                      |
| Zero-crossing rate | Time-series line                                         | A simple indicator of waveform sign changes, often useful for distinguishing noisy and tonal regions |
| Harmonicity        | Spectrum with harmonic markers, plus a time-series score | How well the signal fits a harmonic structure                                                        |

I'd keep these in a supporting Signal Features section, not mix them into the psychoacoustic metrics. Spectral centroid, for example, is often used as a brightness proxy, but it is not equivalent to perceived sharpness.&#x20;

![image](https://www.google.com/s2/favicons?domain=https://www.mdw.ac.at\&sz=32)

Centre for Music Physiology+1



## 8. My proposed Hey Listen dashboard

Rather than showing every chart at once, I'd build a hierarchy that gives the user an immediate overview and lets them drill down.

HEY LISTEN / ANALYSIS

Concept

Sound quality overview · Selected recording

Loudness

# 4.2

sones

Sharpness

# 1.3

acum

Roughness

# 0.4

asper

Fluctuation

# 0.2

vacil

Waveform

Perceptual loudness landscape

Low BarkHigh Bark

Illustrative heatmap · time runs left to right

Perceptual metrics over time

Loudness

Sharpness

Roughness

Conceptual layout only. Values and plots are illustrative, not calculated from an audio file.

### Suggested navigation

| View          | Main purpose                     | Charts                                                       |
| ------------- | -------------------------------- | ------------------------------------------------------------ |
| Overview      | Understand the recording quickly | Metric cards, waveform, loudness landscape, metric timelines |
| Spectrum      | Inspect frequency content        | Spectrum, spectrogram, harmonic markers                      |
| Perception    | Understand auditory response     | Specific loudness, ATH, equal-loudness contours, masking     |
| Sound Quality | Understand timbral character     | Sharpness, tonality, roughness, fluctuation                  |
| Stereo        | Understand spatial behaviour     | Vectorscope, correlation, mid-side, ILD/ITD                  |
| Compare       | Understand differences           | Overlays, difference curves, metric deltas                   |

## 9. A few design decisions I'd make early

1. Time should be a shared coordinate. All time-dependent charts should share the same zoom, selection, cursor, and playback position.
2. Frequency should be switchable, not duplicated. Support Hz, logarithmic Hz, Bark, and ERB where appropriate.
3. Show explanations alongside results. A metric should have a short description, unit, model name, and reference calibration. A value without these can be misleading.
4. Don't normalise everything. Keep physically meaningful scales and model-specific units. Use normalised charts only when explicitly comparing unlike metrics.
5. Make every aggregate inspectable. Clicking a sharpness or roughness value should reveal the frequency/time contributions behind it.
6. Support uncertainty and confidence. Especially for pitch, tonality, and spatial estimates. Don't draw a precise-looking line when the underlying estimate is uncertain.

For a reference implementation of several time-resolved psychoacoustic metrics and their plots, PyAnsys Sound is worth examining. Its examples include loudness, sharpness, roughness and fluctuation strength over time.&#x20;

![image](https://www.google.com/s2/favicons?domain=https://sound.docs.pyansys.com\&sz=32)

PyAnsys Sound+1



## 10. What I'd implement first

My suggested order, balancing insight against implementation effort:

| Priority | Charts                                            | Reason                                                                   |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| 1        | Waveform, spectrum, spectrogram                   | Essential foundation; useful for almost every sound                      |
| 2        | Loudness over time, specific loudness             | The most useful perceptual layer                                         |
| 3        | Sharpness over time + specific loudness weighting | Explains an important dimension of timbre                                |
| 4        | Tonality and pitch overlays                       | Highly actionable for musical and synthetic sounds                       |
| 5        | Roughness and fluctuation views                   | Distinctive perceptual analysis, more complex to implement               |
| 6        | Masking and ATH                                   | Excellent diagnostic tools, especially for detailed analysis             |
| 7        | Stereo and spatial views                          | Important for music and spatial audio                                    |
| 8        | Combined sound-quality profile                    | Useful summary, but depends on the reliability of the preceding analyses |

One design idea I'd particularly pursue: the perceptual spectrogram — a time × Bark heatmap of specific loudness. It could become the central visual identity of Hey Listen: a view that is recognisably different from a conventional audio editor's spectrogram, because it represents an auditory model rather than just spectral energy.

I would prototype that alongside the ordinary spectrogram early. It will help establish whether the application is primarily an audio analyser with psychoacoustic add-ons, or a genuinely perceptual sound-analysis workbench.

---


pYIN absolutely deserves a place in Hey Listen. I'd classify it under Pitch & Harmonic Analysis, rather than general psychoacoustics.

pYIN (probabilistic YIN) is a fundamental-frequency (F0) estimation algorithm. It extends YIN by using probabilistic thresholding and an HMM (Hidden Markov Model) to select a more temporally consistent pitch trajectory.

Its visualisations should help answer three questions:

1. What pitch is being detected?
2. How confident is the estimate?
3. Where does the algorithm encounter ambiguity, silence, or unvoiced sound?

## Recommended charts

Essential

1\. F0 contour over spectrogram

![librosa.pyin — librosa 0.11.0 documentation](https://images.openai.com/static-rsc-4/PVcL411Y3n14K46d86bh3GpPZiFJ5qQ-KqE3KRPCz-r5KSvo34Tv4tbNp0xG9z2vIjDQ2RYG8QWlOQglJm0vcBwCsGjx2-EQbm-ipipwy8FbeTgtRdh_55cO06bB2JnNJ_v_iNfRG8RN7F-igw8reybE4CJQKCNiHhJnXOL-fnE?purpose=inline)

[librosa.org](https://librosa.org/doc/0.11.0/generated/librosa.pyin.html?utm_source=chatgpt.com)

- X: time
- Y: frequency (logarithmic Hz or musical pitch)
- Background: spectrogram
- Overlay: estimated F0 trajectory

This should be the primary pYIN view. Use a separate colour or line style for voiced and unvoiced frames.

Essential

2\. Voicing probability / confidence

![LibROSA ver. 0.8.0 で基本周波数推定（YIN, pYIN） - Wizard Notes](https://images.openai.com/static-rsc-4/16AB6J7jskGlQ80sKNhea7779C6HrYpyR4tLqy9o6ZjINda8to9K6M87W8Km_kFuMp18qLDvWNJwNpmZn_KLFke9k3u8vUZakibyeXgsqgW0s4SczL9191a2ncLtWn71URvYOgHWXz8lK0unPxHjOYTMhnu4_CNTMU09khHvCJc?purpose=inline)

[wizard-notes.com](https://www.wizard-notes.com/entry/python/librosa-yin-pyin-sample-code?utm_source=chatgpt.com)

- X: time
- Y: probability (0–1)
- Overlay: voiced/unvoiced decision threshold

Shows where the pitch estimate is reliable and where pYIN is uncertain. Important: distinguish the probability of a frame being voiced from confidence in the selected F0 candidate, if both are exposed by the implementation.

3\. Pitch in musical units

![Digital Performer: Using ARA & Audio-To-MIDI Options](https://images.openai.com/static-rsc-4/NLyITCMBT2_dO-e3Ytr18mKTHbOr_6nqw6Fdc6ldGpzjudhoh5aSXj7Mm38sQKteYLdSnAc5u-8sFKjYRSZpHKzq0dOOSo1ZZipzDvhHW7pGSgXXeF_mDjHM67fOW5Z7NzwlVQBXwW_ReZp0-NcpSUkZc1PVUYvlOJvY1q47MPA?purpose=inline)

[soundonsound.com](https://www.soundonsound.com/techniques/digital-performer-using-ara-audio-midi-options?utm_source=chatgpt.com)

- X: time
- Y: MIDI note number or note names
- Overlay: detected note trajectory

Useful for music, melody, tuning, and performance analysis. Add semitone grid lines and note labels. Consider cents deviation from the nearest equal-tempered note.

4\. Pitch distribution

![Pythonで音声のピッチ（F0）を求める ― librosaで基本周波数を推定する](https://images.openai.com/static-rsc-4/PxZkcdZKelSLrbiYboFv-wMBjMmf_1-_QwHKJi4gOYI6EioXyceTablilECfFoK_yVlV2uk64eeqV2_BEWj-DhN1BYdDxi8zWbzFgNamtdkpbQY6EIbAX_V7ZXeaQ6S4LrT7ECSUmyocJ83JrVPWmYD8Tsmt-9HZjn0_t685LFg?purpose=inline)

[zenn.dev](https://zenn.dev/kta805/articles/bd5a3811a761fa?utm_source=chatgpt.com)

- X: pitch or pitch class
- Y: duration or frame count
- Optional: weight each frame by voicing probability

Reveals the distribution of detected pitches, useful for identifying tonal centres, melodic range, and unusual pitch distributions.

I would offer both a continuous pitch histogram and a 12-bin pitch-class histogram.

5\. Pitch stability / vibrato

![Vocal Pitch Monitor for Singers & Vocal Coaches | Fiume](https://images.openai.com/static-rsc-4/kN8bclT3CdGM-t9V9K8anxUJzJgtDz3qyr6SOc73p8OBqVUzinJ12o1WniSVwEgTWmabZRQ_4Or--sA0yk9C1SjJu5yqhuikSorj9UEGQPw-OlJz8INOrgTgyHMLHvg94G0uAqU9iLtxLU8_qliP0Hgy74q7zXpNxQbDkke_ipg?purpose=inline)

[fiume.app](https://fiume.app/vocal-pitch-monitor?utm_source=chatgpt.com)

- X: time
- Y: cents deviation from a smoothed pitch trajectory
- Optional: modulation spectrum of the pitch contour

Useful for analysing vibrato rate, vibrato depth, pitch drift, and tuning stability.

This is a derived analysis, not a native pYIN output.

## An additional diagnostic: pYIN candidate probabilities

If you expose the internal candidate information, a particularly interesting chart is:

Time × candidate pitch, with colour representing candidate probability.

![Available processors — The Two!Ears Auditory Model \<unknown> documentation](https://images.openai.com/static-rsc-4/rZlzpbZS_Vs1HEofdTlQoQEr5UO9jAY0qFUFpNaeXEDmMCo8PaVnJ1pL3r0kLE1EGTVHtkPnz4DLivo0l566yRBT4etWk7YBT50OFBF2pEHe7o_lLthCTF9xglWK_6me4kOcZDhbIWkrzEvEHhQTxm6Lsu6w854EIwF2R6VjXDY?purpose=inline)

[docs.twoears.eu](https://docs.twoears.eu/en/1.3/afe/processors/?utm_source=chatgpt.com)

This reveals ambiguous regions where multiple F0 candidates compete, for example octave errors or harmonic confusion.

It can be much more informative than showing only the final selected pitch trajectory. Whether you can expose this depends on the pYIN implementation.

## How I'd integrate pYIN into Hey Listen

| Analysis           | Main chart                  | Supporting chart      |
| ------------------ | --------------------------- | --------------------- |
| pYIN               | F0 contour over spectrogram | Voicing probability   |
| Pitch distribution | Pitch histogram             | Pitch-class histogram |
| Pitch stability    | Cents deviation             | Vibrato modulation    |
| Harmonicity        | Harmonic spectrum           | Harmonicity over time |
| Tonality           | Tonal prominence spectrum   | Tonality over time    |

One important distinction: pYIN estimates F0; it does not directly measure perceived pitch salience. A strong F0 estimate doesn't necessarily mean a pitch is perceptually prominent, and a weak fundamental can still produce a clear pitch percept through its harmonics.

I'd also make pYIN's parameters inspectable: frame size, hop length, frequency range, threshold distribution, and voicing threshold. These can significantly affect the result.

My strongest recommendation: make the F0 contour over the spectrogram and the voicing-probability timeline a linked pair. Together, they make pYIN's output understandable, auditable, and useful for both music and general sound analysis.
