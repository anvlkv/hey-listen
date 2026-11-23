# Chart-review findings

## Scope criteria

**Method.** This review uses the deterministic four-second mono fixture documented in
[`manifest.md`](manifest.md), and inspects every captured canvas in both
`builtin:dark` and `builtin:light`. The three DOM readout tools (`levels`,
`loudnessIntegrated`, `loudnessRange`) are out of visual-chart scope. `spatial` is
not scored: it is stereo-only and the fixture is mono. The checkable criteria below
are derived from [`improved-charts-ideation.md`](../improved-charts-ideation.md).

A chart satisfies a criterion only when the specified visual evidence is present in
its rendered view; a control or capability not visible in these screenshots is not
credited.

| ID | Checkable criterion |
| --- | --- |
| C1 | Every time-dependent chart renders time in seconds on the horizontal axis, aligned to the same source extent, and renders the shared playback cursor and selected time range when they exist. |
| C2 | A frequency-bearing chart uses the scale appropriate to its question: log-Hz for wide-range spectra and pitch; labelled Bark/ERB/Mel for auditory-band results; and exposes Hz/log-Hz/Bark/ERB switching where the ordinary spectrogram or spectrum is the diagnostic view. |
| C3 | A psychoacoustic/loudness result visibly names its unit **and** its model/reference/calibration near the result; SPL-derived reference curves do not present dBFS as dB SPL. |
| C4 | A physical or perceptual result remains on a labelled physical/model scale (rather than an unexplained 0–1 or arbitrary normalized scale), except when normalization is explicitly labelled as comparison-only. |
| C5 | An aggregate metric has an adjacent inspectable contribution view: frequency/Bark contribution, time contribution, or an explicitly linked drill-down. |
| C6 | An estimate with meaningful uncertainty renders it: pitch has voicing/confidence and its decision threshold; ambiguous candidates/octave uncertainty are identifiable when available. |
| C7 | A diagnostic chart renders the applicable explanatory overlays: spectrum peak/F0/harmonic and optional auditory bands; spectrogram F0/harmonics; loudness target/reference; rhythm onset/beat/downbeat markers; masking signal/ATH/maskers/combined threshold/margin; modulation sensitive regions and labelled peaks. |
| C8 | The waveform and spectrogram are presented as a linked primary diagnostic pair: waveform peak/RMS context above a time–frequency dB view; selecting either updates the other and the remaining time charts. |
| C9 | At the supplied canvas size, all plotted encodings, axis labels/ticks, grid/reference lines, legend/series identities, and heatmap colour meaning are distinguishable at a glance in both themes. |

## Per-family findings

### Waveform and amplitude

**What works.** [`waveform`](shots/waveform--dark.png) is immediately useful as a
four-part signal overview: tremolo, sustained/chirped tone, impulses, and dyad all
read clearly. Its zero-centred amplitude envelope is legible in both themes, so
transients and silences are easy to locate. [`frameRms`](shots/frameRms--dark.png) uses a labelled `level (dBFS)` area
plot and makes the same sections legible.

**Gaps.** Neither screenshot visibly distinguishes peak from RMS, labels a peak
overlay, shows clipping, nor shows a cursor/selection. The waveform and
[`spectrogram`](shots/spectrogram--dark.png) have the same broad 0–4 s extent, but
there is no visible linked cursor/range or stacked pair. This only partially meets
C1/C8. `frameRms` has useful units but no peak markers or reference/clipping line.

### Spectrum and spectrogram

**What works.** [`spectrum`](shots/spectrum--dark.png) has a log-Hz x-axis and dB
y-axis, so the broad range is inspectable; its solid blue and dashed orange traces
are visually separable. [`spectrogram`](shots/spectrogram--dark.png) is a strong
basic time×frequency diagnostic: the chirp, burst transients, and dyad emerge, and
it includes two coloured contour overlays. The logarithmic frequency ticks make
low-frequency structure much more usable than a linear full-band view.

**Gaps.** Spectrum has no visible legend identifying the blue/dashed-orange
statistics, no peak labels, no F0/harmonic markers, and no octave/Bark/ERB
boundaries. The spectrogram's overlays are unlabelled (therefore not auditable as
centroid/rolloff), lacks a colourbar or dB range, lacks F0/harmonic overlays, and
shows no scale selector. In light theme the pale blue heatmap is very close to the
background over much of the range; in dark it is clearer but still has no declared
colour scale. Neither can satisfy C2's switchability or C7's pitch diagnostic
requirements from the captures.

### Matrix heatmaps

**What works.** [`melSpectrogram`](shots/melSpectrogram--dark.png) is the most
legible heatmap in this family: labelled Mel rows show low-band energy, the upward
chirp, impulses, and dyad clearly. [`chromagram`](shots/chromagram--dark.png) uses
pitch-class note labels and horizontal note-grid lines; the chirp's changing pitch
class is visibly traceable. [`criticalBands`](shots/criticalBands--dark.png) and
[`spectralContrast`](shots/spectralContrast--dark.png) separate band/time regions,
so they at least expose temporal contributions rather than collapsing to a scalar.

**Gaps.** None of `melSpectrogram`, [`mfcc`](shots/mfcc--dark.png), `chromagram`,
`criticalBands`, [`specificLoudness`](shots/specificLoudness--dark.png), or
`spectralContrast` has a visible colourbar/legend or numeric colour units. Thus the
viewer can see relative pattern but cannot inspect magnitude or compare captures
(C3/C4/C9). `mfcc` is especially weak visually: coefficient labels exist but the
very low-contrast field and broad blocks do not make coefficients inspectable.

`criticalBands` uses band-centre Hz labels (not a declared Bark/ERB coordinate),
which is a sensible aid but does not establish the auditory model or units.
`specificLoudness` is effectively blank in both themes on this fixture: only a
bare log-frequency/time frame is visible, with no readable heatmap, Bark/ERB
coordinate, `sones/Bark` unit, or colour scale. It fails as the proposed perceptual
spectrogram. `spectralContrast` uses generic `band 1`–`band 6`, rather than octave
bounds/centres, and `chromagram` omits the intermediate pitch-class labels at this
size. The matrices share time extents, but show neither shared cursor nor selected
range.

### Spectral-feature series

**What works.** The conventional time series are structurally consistent:
[`spectralCentroid`](shots/spectralCentroid--dark.png),
[`spectralRolloff`](shots/spectralRolloff--dark.png), and
[`spectralBandwidth`](shots/spectralBandwidth--dark.png) use log-Hz y scales;
this prevents the burst section's high-frequency values from flattening the tonal
sections. Their labelled units make the fixture's chirp and broadband bursts
obvious. [`spectralFlux`](shots/spectralFlux--dark.png) correctly uses stems,
which preserve discrete change events better than a filled area. [`spectralCrest`](shots/spectralCrest--dark.png)
is correctly step-like, while [`spectralFlatness`](shots/spectralFlatness--dark.png),
[`harmonicRatio`](shots/harmonicRatio--dark.png), and
[`zeroCrossingRate`](shots/zeroCrossingRate--dark.png) have bounded, labelled
normalised scales. [`spectralEntropy`](shots/spectralEntropy--dark.png) retains
its `bits` unit.

**Gaps.** These are individual aggregate timelines with no contribution drill-down;
none makes a centroid, rolloff, bandwidth, flatness, or harmonicity value
inspectable against the underlying spectrum (C5). The area fill often turns sparse
sampled frames into large solid blocks—most noticeably the high-valued burst regions
of centroid/rolloff/bandwidth—and can imply continuity that the data do not support.
The otherwise appropriate normalized 0–1 charts are unexplained: it is not clear
whether their endpoints are physical bounds, proportions, or display normalization.
`harmonicRatio` supplies no accompanying harmonic spectrum/markers, so it does not
explain the score as called for by the ideation. No feature timeline carries source
or event markers beyond the data shape.

### Pitch and note metrics

**What works.** [`pitchPyin`](shots/pitchPyin--dark.png),
[`pitchYin`](shots/pitchYin--dark.png), and
[`pitchAutocorr`](shots/pitchAutocorr--dark.png) display individual points rather
than falsely connecting the silent regions. Their logarithmic Hz y-axis makes the
220 Hz tones and rising 300–920 Hz chirp readable, and the point contour itself
reveals frame granularity. [`noteMetrics`](shots/noteMetrics--dark.png) does render
a compact note-segment canvas with coloured regions/point values rather than only a
single note count.

**Gaps.** The three pitch plots look nearly identical, have only Hz labels, and
show no semitone grid or note names despite the musical task. More importantly,
there is no voicing probability, confidence encoding, threshold, octave-ambiguity
marker, candidate distribution, F0-on-spectrogram, or harmonic overlay. A precise
thin point trail is consequently presented without the uncertainty that C6 requires.

The `noteMetrics` canvas is only a thin strip at the supplied capture size. Its
left/right axes, coloured blocks, point marks, dashed line, and text such as `310 ms`
are too compressed to decode; it is not an at-a-glance inspectable note chart.
There is no displayed pitch-class/semitone grid or connection back to the pitch
estimate/spectrogram. The surrounding cards/table named in the manifest are DOM,
not assessable from these PNGs.

### Rhythm envelopes

**What works.** [`onsets`](shots/onsets--dark.png) has a readable onset-strength
envelope and thin green event markers. [`tempo`](shots/tempo--dark-c0.png) adds a
regular beat grid above the envelope and its second canvas
([`tempo` BPM](shots/tempo--dark-c1.png)) makes the tempo hypothesis visible, with
a clear teal estimate marker. [`downbeats`](shots/downbeats--dark-c0.png) adds a
visibly distinct red downbeat marker to the beat grid, meeting the basic marker
requirement better than the other event tools.

**Gaps.** Marker semantics are not labelled in-canvas, so green, purple, and red
rules require outside knowledge to interpret. The `tempo`/`downbeats` BPM canvases
are extremely shallow and use an unlabeled `strength` area around a zero line; they
are not self-explanatory tempo distributions. Their x-axis is BPM rather than the
shared time coordinate, which is valid for a supporting histogram but needs a
legend/result label. The onset rendering shows many green rules—not only the most
salient events—without threshold or confidence. No rhythm canvas shows the shared
playhead/selection.

### Loudness

**What works.** [`loudnessMomentary`](shots/loudnessMomentary--dark.png) is one of
the clearest charts: it has a LUFS axis, temporal context, and a clearly labelled
mint dashed `−14 LUFS` reference. The target is visible in both themes. The
[`loudness`](shots/loudness--dark.png) sone timeline retains a perceptual unit rather
than normalising to 0–1 and cleanly shows the chirp/dyad energy rise.

**Gaps.** `loudnessMomentary` does not identify the measurement/model/window or why
−14 LUFS applies. `loudness` labels `loudness (sone)` but has no visible phon
counterpart, model/calibration, overall/max/N5/N50/N95 indicators, or optional
RMS/SPL comparator. It is therefore a good timeline but not an inspectable
perceptual result (C3/C5). The separate `specificLoudness` result is blank/unreadable
as noted above, so the loudness family lacks the frequency contribution view needed
to explain both loudness and sharpness.

### Masking

**What works.** [`masking`](shots/masking--dark.png) uses a frequency-versus-level
frame with explicit Hz and dB axes, so it is at least shaped like a masking
explanation rather than a scalar. The pale green dotted curve remains visible in
both themes.

**Gaps.** The actual result is visually unusable for the supplied fixture: the
captured plot is almost entirely empty, with an implausible/unexplained curve rising
toward 180 dB at roughly 20 kHz. It does not render a measured spectrum, threshold
in quiet, tonal/noise maskers, combined threshold, shaded below-threshold region,
or masking-margin curve. It also offers no legend or SPL/dBFS calibration statement.
This fails the ideation's masking display requirements and makes a reference-model
curve misleading rather than diagnostic.

### Sound-quality timelines and modulation

**What works.** [`sharpness`](shots/sharpness--dark.png),
[`roughness`](shots/roughness--dark.png), and
[`fluctuationStrength`](shots/fluctuationStrength--dark.png) preserve their named
units (`acum`, `asper`, `vacil`) and clearly locate the burst-driven peaks. The
non-normalized vertical ranges make relative magnitude within each model visible.
[`tonality`](shots/tonality--dark.png) has an explicit 0–1 scale and separates tonal
and burst segments. [`modulation`](shots/modulation--dark.png) exposes AM and FM
rate spectra in a shared modulation-rate view, rather than reducing modulation to
a card.

**Gaps.** Sharpness is only its secondary time plot: it has no specific-loudness
curve, sharpness weighting function, or shaded high-Bark contribution. Roughness
and fluctuation are likewise only secondary timelines; neither supplies the
modulation-frequency contribution view, the sensitive region (roughness versus
low-rate fluctuation), nor labelled strongest modulation peaks/4 Hz reference.
Tonality has no tonal-prominence/TNR spectrum or detected tonal peak labels.

`modulation` is especially hard to interpret: its blue filled spectrum occupies most
of the plot while the orange curve is unlabeled; it lacks AM/FM legend, units/model,
sensitive-region highlight, and peak labels. The light theme's saturated blue fill
and white grid overpower the traces. All of these aggregate displays fail C5 even
where their temporal timing is useful.

## Theme findings

- **Dark is generally the more diagnostic heatmap theme.** `spectrogram`,
  `melSpectrogram`, `chromagram`, and `spectralContrast` preserve substantially
  more separation against the dark ground. In `builtin:light`, their low-energy
  blues frequently merge into the near-white plot field; `mfcc` and
  `specificLoudness` are particularly difficult to read.
- **Light has weak grid hierarchy.** Area charts remain legible, but many light
  grids are close to the fills and background. The rhythm canvases' purple beat
  rules are conspicuous yet unexplained; the modulation chart's white grid becomes
  a dominant texture over the blue fill.
- **Dark's labels and grids are mostly readable but subdued.** Thin dark-gray grids
  work for ordinary time series, but low-contrast small tick text and the almost
  black `specificLoudness`/masking backgrounds leave too little visual evidence to
  diagnose the result. `noteMetrics` is unreadable in either theme because of
  density and height, not merely palette.
- **Reference/overlay contrast is inconsistent.** The LUFS mint target works well
  in both themes. Spectrum/spectrogram overlay colours are distinguishable but
  unlabelled. The masking dotted green and modulation orange survive, but their
  meaning cannot be recovered without a legend.

## Prioritized gap list

1. **Make `waveform` + `spectrogram` a linked primary diagnostic pair:** stack them, share zoom/cursor/selected range with every timeline, retain peak and RMS overlays, and put F0/harmonics on the spectrogram. **Why it matters:** this is the foundation for locating and validating every derived result.
2. **Repair and complete `specificLoudness` and `masking`:** render visible data with colourbars/units; use Bark/ERB `sones/Bark` for specific loudness; render spectrum, ATH, individual/combined maskers, shaded threshold relationship, and signal-minus-threshold margin with calibrated labels for masking. **Why it matters:** the intended perceptual diagnostic layer is currently blank or misleading.
3. **Turn pYIN into an auditable pitch view:** overlay the F0 trajectory on the log-frequency spectrogram, add a 0–1 voicing/confidence track and threshold, semitone/note grid, and ambiguity/candidate display where available; give YIN/autocorrelation analogous reliability disclosure. **Why it matters:** the present precise-looking point contours conceal failure modes and do not explain pitch against the sound.
4. **Add colour scales and complete labels to every matrix:** declare value unit/range and model for `spectrogram`, `melSpectrogram`, `mfcc`, `chromagram`, `criticalBands`, `spectralContrast`, and `specificLoudness`; label octave bands and all pitch classes at usable zoom. **Why it matters:** a heatmap without magnitude semantics cannot support comparison or inspection.
5. **Provide frequency-scale controls on `spectrum` and `spectrogram`:** use log Hz by default, plus linear Hz/Bark/ERB views where appropriate; show optional band boundaries. **Why it matters:** it joins physical signal inspection to auditory-model results without duplicating charts.
6. **Make `spectrum` explanatory:** label mean/min/max traces, detected peaks, F0 and harmonic positions, with optional octave/Bark/ERB bands. **Why it matters:** users can then identify *which* components produce a perceived or metric change.
7. **Add contribution drill-downs for psychoacoustics:** sharpness gets specific-loudness + weighting/high-Bark shading; roughness/fluctuation get modulation-strength contributions and sensitive bands; tonality gets tonal-prominence/TNR spectrum and marked peaks. **Why it matters:** time-series aggregates currently report that a value changed but not why.
8. **Make loudness self-describing:** pair `loudness` with model/calibration, phon context, overall/max/N5/N50/N95, and optional RMS/SPL comparison; state `loudnessMomentary` measurement window/model beside its −14 LUFS line. **Why it matters:** units alone do not make a perceptual or broadcast reference interpretable.
9. **Clarify rhythm and modulation encodings:** label onset/beat/downbeat marker types and thresholds; give the shallow BPM plots a legend/result label; label AM vs FM, add modulation units, sensitive regions, and peak annotations. **Why it matters:** the event/secondary canvases currently depend on undocumented colour knowledge.
10. **Rework `noteMetrics` at this canvas size:** increase the segment chart height, simplify/relabel its dual axes, show pitch/semitone context and clear note boundaries/durations. **Why it matters:** its dense miniature format prevents the detected musical-note result from being inspected.
11. **Improve light-theme heatmap and grid contrast:** use a perceptually ordered, theme-tuned colour map with a visible scale; reduce dominance of the modulation grid/fill; verify reference-line contrast. **Why it matters:** light theme currently hides low-level spectral/perceptual structure that is visible in dark.
12. **Make aggregate feature timelines explicit about scale and sampling:** distinguish frame samples from interpolated/filled continuity, explain bounded ratios, and link centroid/rolloff/bandwidth/flatness/harmonic ratio to their spectra. **Why it matters:** it prevents visual overstatement and makes supporting descriptors diagnostically useful.
