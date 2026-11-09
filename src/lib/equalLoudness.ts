/**
 * Equal-loudness contour reference data (M31).
 *
 * The normal equal-loudness-level contours: the sound pressure level a pure tone
 * needs at each frequency to be perceived as loud as a 1 kHz tone at the selected
 * **phon** level. The table is generated from the ISO 226:2023 Formula (1) and its
 * Table 1 parameters at the 29 preferred third-octave frequencies, for 20–90 phon in
 * 10-phon steps. Levels are dB SPL re 20 µPa.
 *
 * The standard defines no interpolation between its tabulated frequencies; this
 * module interpolates **linearly in log-frequency** only so the curve can be drawn
 * across an arbitrary spectrum's bins, and clamps outside the table. It is a
 * reference overlay — a pure-tone contour under fixed listening conditions — not a
 * loudness model for arbitrary audio, and the spectrum it is drawn over is dBFS
 * unless calibrated.
 */

/** The 29 preferred third-octave frequencies of the table, in Hz. */
export const EQ_LOUDNESS_FREQS: readonly number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500,
];

/** The loudness levels the table carries, in phon. */
export const EQ_LOUDNESS_PHONS: readonly number[] = [20, 30, 40, 50, 60, 70, 80, 90];

/** SPL (dB) per phon row, aligned with {@link EQ_LOUDNESS_FREQS}. */
const CONTOURS: Record<number, readonly number[]> = {
  20: [
    89.5, 82.9, 76.3, 69.9, 64.3, 58.8, 53.4, 48.6, 44.1, 39.6, 35.6, 32.1, 28.9, 25.9, 23.6, 21.6,
    20.1, 20.0, 21.4, 21.5, 18.2, 15.5, 14.2, 15.3, 18.7, 25.0, 31.4, 34.7, 33.0,
  ],
  30: [
    94.8, 88.6, 82.5, 76.6, 71.4, 66.2, 61.2, 56.7, 52.6, 48.4, 44.7, 41.4, 38.4, 35.7, 33.5, 31.6,
    30.0, 30.0, 31.6, 32.1, 28.7, 26.1, 24.9, 26.1, 29.5, 35.5, 41.6, 44.7, 42.4,
  ],
  40: [
    99.7, 93.9, 88.2, 82.7, 77.8, 73.0, 68.3, 64.2, 60.4, 56.6, 53.3, 50.3, 47.6, 45.1, 43.1, 41.4,
    40.0, 40.0, 41.8, 42.6, 39.2, 36.6, 35.5, 36.7, 40.1, 45.8, 51.6, 54.4, 51.3,
  ],
  50: [
    104.6, 99.1, 93.7, 88.5, 83.9, 79.4, 75.2, 71.4, 68.0, 64.6, 61.6, 58.9, 56.5, 54.3, 52.6, 51.1,
    49.9, 50.0, 52.0, 52.9, 49.6, 47.0, 45.9, 47.2, 50.5, 56.1, 61.6, 63.9, 60.0,
  ],
  60: [
    109.4, 104.2, 99.1, 94.2, 89.9, 85.8, 81.9, 78.5, 75.4, 72.4, 69.7, 67.4, 65.4, 63.5, 62.1,
    60.8, 59.8, 60.0, 62.1, 63.2, 60.0, 57.4, 56.4, 57.7, 61.0, 66.4, 71.5, 73.2, 68.6,
  ],
  70: [
    114.1, 109.2, 104.4, 99.8, 95.9, 92.1, 88.5, 85.5, 82.8, 80.1, 77.8, 75.9, 74.2, 72.6, 71.5,
    70.4, 69.7, 70.0, 72.3, 73.5, 70.4, 67.8, 66.8, 68.1, 71.4, 76.6, 81.4, 82.6, 77.1,
  ],
  80: [
    118.9, 114.2, 109.7, 105.4, 101.8, 98.3, 95.1, 92.5, 90.1, 87.8, 85.9, 84.3, 82.9, 81.8, 80.9,
    80.1, 79.6, 80.0, 82.5, 83.8, 80.7, 78.1, 77.2, 78.5, 81.8, 86.9, 91.3, 91.9, 85.6,
  ],
  90: [
    123.6, 119.2, 115.0, 111.0, 107.7, 104.6, 101.7, 99.4, 97.4, 95.5, 94.0, 92.7, 91.7, 90.9, 90.2,
    89.7, 89.5, 90.0, 92.6, 94.1, 91.1, 88.5, 87.5, 88.8, 92.1, 97.1, 101.2, 101.2, 94.1,
  ],
};

/** The contour levels for `phon`, or `null` when that level is not tabulated. */
export function contourLevels(phon: number): readonly number[] | null {
  return CONTOURS[phon] ?? null;
}

/**
 * The contour's required level (dB SPL) at `freq` Hz for the given phon level.
 *
 * Interpolated linearly in log-frequency between the tabulated frequencies and
 * clamped at the ends; `null` when the phon level is not in the table or the
 * frequency is not positive.
 */
export function contourAt(phon: number, freq: number): number | null {
  const levels = CONTOURS[phon];
  if (!levels || !Number.isFinite(freq) || freq <= 0) return null;
  const freqs = EQ_LOUDNESS_FREQS;
  if (freq <= freqs[0]) return levels[0];
  const last = freqs.length - 1;
  if (freq >= freqs[last]) return levels[last];
  let index = 1;
  while (index < freqs.length && freqs[index] < freq) index++;
  const lo = index - 1;
  const hi = index;
  const t = Math.log10(freq / freqs[lo]) / Math.log10(freqs[hi] / freqs[lo]);
  return levels[lo] + t * (levels[hi] - levels[lo]);
}
