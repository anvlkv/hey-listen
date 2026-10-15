import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Deterministic E2E fixtures (M8).
 *
 * Generated on the fly (never committed) so every run is reproducible: a known
 * 440 Hz tone for the correctness spot-checks, a chirp + noise burst that gives
 * every spectral/rhythm tool a real, non-flat signal, a stereo tone for the
 * channel-select scenario, a corrupt file for the error path, and a known synth
 * graph for the synth source. See `docs/testing.md` → Fixtures.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the generated fixtures are written (gitignored). */
export const FIXTURE_DIR = path.resolve(HERE, "..", ".fixtures");

export const FIXTURES = {
  sine440: path.join(FIXTURE_DIR, "sine440.wav"),
  chirpNoise: path.join(FIXTURE_DIR, "chirp_noise.wav"),
  stereo: path.join(FIXTURE_DIR, "stereo.wav"),
  corrupt: path.join(FIXTURE_DIR, "corrupt.wav"),
  synthGraph: path.join(FIXTURE_DIR, "synth-graph.json"),
} as const;

const SAMPLE_RATE = 48_000;
/** −12 dBFS as a linear amplitude. */
const AMPLITUDE = 10 ** (-12 / 20);

/** A tiny deterministic PRNG (mulberry32), so the "noise" fixtures never change. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A short (20 ms) fade at each end, so the pitch/spectral tools see no click. */
function withFades(samples: Float32Array, seconds: number): Float32Array {
  const fade = Math.min(Math.floor(0.02 * SAMPLE_RATE), Math.floor(samples.length / 2));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    samples[i] *= g;
    samples[samples.length - 1 - i] *= g;
  }
  void seconds;
  return samples;
}

/** 2 s, 48 kHz, mono, 440 Hz at −12 dBFS. */
function sine440(): Float32Array {
  const frames = 2 * SAMPLE_RATE;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = AMPLITUDE * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
  }
  return withFades(out, 2);
}

/** 3 s, 48 kHz, mono: 20 Hz→8 kHz log sweep plus a noise burst at 1.5 s. */
function chirpNoise(): Float32Array {
  const frames = 3 * SAMPLE_RATE;
  const out = new Float32Array(frames);
  const f0 = 20;
  const f1 = 8000;
  const duration = frames / SAMPLE_RATE;
  // Logarithmic sweep (matches the "chirp" in `docs/testing.md`).
  const k = Math.log(f1 / f0);
  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE;
    const phase = ((2 * Math.PI * f0 * duration) / k) * (Math.exp((k * t) / duration) - 1);
    out[i] = AMPLITUDE * Math.sin(phase);
  }
  // Deterministic noise burst over ~1.4–1.6 s (a broadband transient for onsets).
  const random = prng(0x5eed);
  const burstStart = Math.floor(1.4 * SAMPLE_RATE);
  const burstEnd = Math.floor(1.6 * SAMPLE_RATE);
  const burstFade = Math.floor(0.005 * SAMPLE_RATE);
  for (let i = burstStart; i < burstEnd; i++) {
    const edge = Math.min(i - burstStart, burstEnd - 1 - i);
    const g = Math.min(1, edge / burstFade);
    out[i] = 0.25 * g * (random() * 2 - 1);
  }
  return withFades(out, 3);
}

/** 2.5 s, 48 kHz, stereo: 440 Hz left, 880 Hz right, both at −12 dBFS. */
function stereoTone(): [Float32Array, Float32Array] {
  const frames = Math.round(2.5 * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = AMPLITUDE * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    right[i] = AMPLITUDE * Math.sin((2 * Math.PI * 880 * i) / SAMPLE_RATE);
  }
  return [withFades(left, 2.5), withFades(right, 2.5)];
}

/** A minimal RIFF/WAVE container holding interleaved 16-bit PCM. */
function toWav(channels: Float32Array[], sampleRate: number): Buffer {
  const numChannels = channels.length;
  const frames = channels[0].length;
  const blockAlign = numChannels * 2;
  const dataBytes = frames * blockAlign;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);

  const pcm = Buffer.alloc(dataBytes);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const clamped = Math.max(-1, Math.min(1, channels[c][i]));
      pcm.writeInt16LE(Math.round(clamped * 32767), (i * numChannels + c) * 2);
    }
  }
  return Buffer.concat([header, pcm]);
}

/** The synth graph fixture: `sine(440) → output` (matches `src/lib/graph.ts`). */
export const SYNTH_GRAPH_SPEC = {
  nodes: [
    { id: "osc-1", kind: "sine", params: [440] },
    { id: "output-2", kind: "output", params: [] },
  ],
  edges: [{ from: "osc-1", fromPort: 0, to: "output-2", toPort: 0 }],
};

/** Write every fixture. Idempotent: bytes are identical on each run. */
export async function writeFixtures(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });

  const [left, right] = stereoTone();
  await Promise.all([
    writeFile(FIXTURES.sine440, toWav([sine440()], SAMPLE_RATE)),
    writeFile(FIXTURES.chirpNoise, toWav([chirpNoise()], SAMPLE_RATE)),
    writeFile(FIXTURES.stereo, toWav([left, right], SAMPLE_RATE)),
    // A RIFF header followed by garbage — `probe_file` must fail on it (I1).
    writeFile(
      FIXTURES.corrupt,
      Buffer.concat([
        Buffer.from("RIFF", "ascii"),
        Buffer.from([0xff, 0xff, 0xff, 0xff]),
        Buffer.from("WAVEjunk-not-a-real-codec", "ascii"),
        Buffer.alloc(1024, 0x7f),
      ]),
    ),
    writeFile(FIXTURES.synthGraph, Buffer.from(JSON.stringify(SYNTH_GRAPH_SPEC, null, 2), "utf8")),
  ]);
}
