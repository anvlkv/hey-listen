/**
 * The deterministic audio fixture behind the preview surfaces.
 *
 * Both the browser preview (`src/preview/fixtures.ts`) and the fixture generator
 * (`scripts/lighthouse/generate-fixtures.ts`) import this module, so the PCM the
 * Timeline draws is exactly the PCM the analyzer fixtures were computed from.
 *
 * The signal is built to exercise the whole catalog in one 4 s mono file: a
 * loudness/tremolo tone, a gap, a vibrato chirp, a gap, gated noise bursts (onsets),
 * a gap, and a steady two-tone tail (notes with measurable pitch). It is synthesised
 * from a fixed seed, so every run is identical — no audio blobs are committed.
 */

/** Fixture sample rate (Hz). */
export const FIXTURE_SAMPLE_RATE = 48_000;
/** Fixture length (seconds). */
export const FIXTURE_SECONDS = 4;

const TAU = Math.PI * 2;

/** Ramp in/out inside `start..end`, so a segment never clicks. */
function fade(t: number, start: number, end: number, fadeIn: number, fadeOut: number): number {
  return Math.max(0, Math.min(1, (t - start) / fadeIn, (end - t) / fadeOut));
}

/** Deterministic white noise in −1…1 (a small LCG, no dependency). */
function noiseSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x80000000 - 1;
  };
}

/**
 * Render the fixture PCM (mono, interleaved-by-definition) at
 * [`FIXTURE_SAMPLE_RATE`].
 */
export function fixturePcm(): Float32Array {
  const count = Math.round(FIXTURE_SAMPLE_RATE * FIXTURE_SECONDS);
  const out = new Float32Array(count);
  const noise = noiseSource(0x2f6e2b1);
  let tonePhase = 0;
  let chirpPhase = 0;
  let tailA = 0;
  let tailB = 0;

  for (let i = 0; i < count; i++) {
    const t = i / FIXTURE_SAMPLE_RATE;
    let sample = 0;

    if (t >= 0.1 && t < 0.9) {
      // Harmonic tone with a 5 Hz tremolo (AM) — loudness / modulation / pitch.
      tonePhase += (TAU * 220) / FIXTURE_SAMPLE_RATE;
      const am = 0.6 + 0.4 * Math.sin(TAU * 5 * (t - 0.1));
      sample =
        fade(t, 0.1, 0.9, 0.02, 0.05) *
        am *
        (0.32 * Math.sin(tonePhase) +
          0.12 * Math.sin(2 * tonePhase) +
          0.06 * Math.sin(3 * tonePhase));
    } else if (t >= 1.1 && t < 2) {
      // A 300 → 920 Hz chirp with 6 Hz vibrato — pitch track / spectrogram.
      const u = (t - 1.1) / 0.9;
      const f = 300 + 620 * u + 18 * Math.sin(TAU * 6 * (t - 1.1));
      chirpPhase += (TAU * f) / FIXTURE_SAMPLE_RATE;
      sample =
        fade(t, 1.1, 2, 0.02, 0.05) *
        (0.28 * Math.sin(chirpPhase) + 0.08 * Math.sin(2 * chirpPhase));
    } else if (t >= 2.15 && t < 3) {
      // Gated noise bursts at 6 Hz — onsets / tempo / spectral-flatness contrast.
      const gate = Math.max(0, Math.sin(TAU * 6 * (t - 2.15))) ** 12;
      sample =
        fade(t, 2.15, 3, 0.01, 0.05) *
        gate *
        (0.22 * noise() + 0.1 * Math.sin(TAU * 1200 * (t - 2.15)));
    } else if (t >= 3.2 && t < 3.85) {
      // A steady 440 + 660 Hz dyad — a clean tonal tail for the note tools.
      tailA += (TAU * 440) / FIXTURE_SAMPLE_RATE;
      tailB += (TAU * 660) / FIXTURE_SAMPLE_RATE;
      sample = fade(t, 3.2, 3.85, 0.02, 0.06) * (0.26 * Math.sin(tailA) + 0.18 * Math.sin(tailB));
    }

    out[i] = sample;
  }
  return out;
}
