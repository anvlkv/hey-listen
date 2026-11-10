#!/usr/bin/env -S npx tsx
/**
 * Generate the analysis fixtures the preview surfaces render.
 *
 * 1. Render the deterministic signal (`src/preview/signal.ts`) to a temporary WAV.
 * 2. Run the **batch CLI** (`hey-listen-cli analyze --all --full --out`) over it for
 *    every analyzer, the same engine the app uses.
 * 3. Thin the raw arrays to display-sized grids and write
 *    `src/preview/fixtures/analysis.json`, keyed by analyzer id.
 *
 * The CLI is a console binary (no display needed), but this is still a
 * developer-machine step, not a build step: the generated JSON is committed, and
 * `npm run lighthouse` reads it. Re-run it after an engine/result-shape change.
 *
 *   npm run lighthouse:fixtures
 *   HEY_LISTEN_CLI=/path/to/hey-listen-cli npm run lighthouse:fixtures
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_SAMPLE_RATE, FIXTURE_SECONDS, fixturePcm } from "../../src/preview/signal";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = join(ROOT, ".lighthouse", "fixtures");
const OUT_JSON = join(ROOT, "src", "preview", "fixtures", "analysis.json");
const BIN =
  process.env.HEY_LISTEN_CLI ??
  process.env.HEYLISTEN_BIN ??
  join(
    ROOT,
    "src-tauri",
    "target",
    "release",
    `hey-listen-cli${process.platform === "win32" ? ".exe" : ""}`,
  );

/** Maximum points per displayed axis. The charts are a few hundred px wide. */
const MAX_POINTS = 240;

/**
 * Analyzers the mono fixture cannot exercise. `spatial` is stereo-only: the Rust tool
 * errors when `channels < 2` (see `src-tauri/src/audio/analysis/tools/spatial.rs`), so
 * an `analyze --all` over the mono WAV reports a failure and makes the CLI exit
 * non-zero. Running the catalog minus this set keeps the exit code meaningful for
 * every *real* failure while still rendering `spatial`-less fixtures.
 */
const MONO_EXCLUDED = new Set(["spatial"]);

/** The catalog's analyzer ids, from `hey-listen-cli analyzers --json` (the single
 * source of truth for which analyzers exist). */
function catalogIds(): string[] {
  const raw = execFileSync(BIN, ["analyzers", "--json"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const items = JSON.parse(raw) as Array<{ id?: unknown }>;
  const ids = items.map((item) => item.id).filter((id): id is string => typeof id === "string");
  if (ids.length === 0) throw new Error("the CLI returned no analyzer ids");
  return ids;
}

/** Write a mono 16-bit PCM WAV. */
function writeWav(path: string, samples: Float32Array, sampleRate: number) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); // PCM
  bytes.writeUInt16LE(1, 22); // mono
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    bytes.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  writeFileSync(path, bytes);
}

/** Indices to keep when thinning `length` points down to `max`. */
function keepIndices(length: number, max: number): number[] {
  if (length <= max) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

function pick<T>(values: T[], indices: number[]): T[] {
  return indices.map((index) => values[index]);
}

/** One envelope's `result` object (the engine's JSON shape, kept loosely typed). */
type Result = Record<string, unknown>;

function thinAligned(result: Result, keys: string[], max: number, framesKey?: string) {
  const first = result[keys[0]];
  if (!Array.isArray(first)) return;
  const indices = keepIndices(first.length, max);
  for (const key of keys) {
    const value = result[key];
    if (Array.isArray(value)) result[key] = pick(value, indices);
  }
  if (framesKey) result[framesKey] = indices.length;
}

function thinWaveform(result: Result) {
  // `bucketRms` is the per-bucket RMS aligned with `min`/`max` (M36) — thin it with them
  // so the peak band and the RMS overlay stay on the same buckets.
  const keys = ["min", "max"];
  if (Array.isArray(result.bucketRms)) keys.push("bucketRms");
  thinAligned(result, keys, MAX_POINTS);
}

function thinSpectrum(result: Result) {
  thinAligned(result, ["freqs", "magDb", "minDb", "maxDb"], MAX_POINTS);
}

function thinSpectrogram(result: Result) {
  const frames = Number(result.frames);
  const bins = Number(result.bins);
  const magDb = result.magDb;
  if (!Number.isFinite(frames) || !Number.isFinite(bins) || !Array.isArray(magDb)) return;
  const frameIndices = keepIndices(frames, MAX_POINTS / 2);
  const binIndices = keepIndices(bins, 96);
  const thinned: number[] = [];
  for (const frame of frameIndices) {
    for (const bin of binIndices) thinned.push(magDb[frame * bins + bin] as number);
  }
  result.frames = frameIndices.length;
  result.bins = binIndices.length;
  result.magDb = thinned;
  if (Array.isArray(result.freqs)) result.freqs = pick(result.freqs, binIndices);
}

function thinMatrix(result: Result) {
  const frames = Number(result.frames);
  const bins = Number(result.bins);
  const values = result.values;
  if (!Number.isFinite(frames) || !Number.isFinite(bins) || !Array.isArray(values)) return;
  const frameIndices = keepIndices(frames, MAX_POINTS / 2);
  const binIndices = keepIndices(bins, 48);
  const thinned: number[] = [];
  for (const frame of frameIndices) {
    for (const bin of binIndices) thinned.push(values[frame * bins + bin] as number);
  }
  result.frames = frameIndices.length;
  result.bins = binIndices.length;
  result.values = thinned;
  if (Array.isArray(result.times)) result.times = pick(result.times, frameIndices);
  if (Array.isArray(result.bands)) result.bands = pick(result.bands, binIndices);
}

function thinSeries(result: Result) {
  // `confidence` (pitch) is parallel to `values` and must thin with it (M36).
  const keys = ["times", "values"];
  if (Array.isArray(result.confidence)) keys.push("confidence");
  thinAligned(result, keys, MAX_POINTS, "frames");
}

function thinRhythm(result: Result) {
  thinAligned(result, ["times", "onsetStrength"], MAX_POINTS * 2);
}

function thinModulation(result: Result) {
  thinAligned(result, ["modFreqs", "amDb", "fmDb"], MAX_POINTS);
}

/** Pick the thinning strategy from the result's shape (not from a second tool table). */
function thinResult(result: Result) {
  if (Array.isArray(result.min) && Array.isArray(result.max)) thinWaveform(result);
  else if (Array.isArray(result.magDb)) {
    if (Number.isFinite(Number(result.bins))) thinSpectrogram(result);
    else thinSpectrum(result);
  } else if (Number.isFinite(Number(result.bins)) && Array.isArray(result.values))
    thinMatrix(result);
  else if (Array.isArray(result.onsetStrength)) thinRhythm(result);
  else if (Array.isArray(result.amDb)) thinModulation(result);
  else if (Array.isArray(result.values)) thinSeries(result);
}

interface Envelope {
  summary?: unknown;
  result?: Result;
}

function main() {
  if (!existsSync(BIN)) {
    console.error(
      `generate-fixtures: no console binary at ${BIN}\nBuild one (cargo build --release --bin hey-listen-cli) or set HEY_LISTEN_CLI.`,
    );
    process.exitCode = 1;
    return;
  }

  mkdirSync(WORK, { recursive: true });
  const wav = join(WORK, "lighthouse-fixture.wav");
  writeWav(wav, fixturePcm(), FIXTURE_SAMPLE_RATE);
  const outDir = join(WORK, "analysis");
  // The CLI's `--out` never overwrites an earlier run's file (it suffixes `-2`, `-3`, …),
  // so a stale `outDir` would otherwise leave last-run files that `readdirSync` picks up —
  // and their tool keys would shadow this run's fresh results. Clear it first.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const tools = catalogIds().filter((id) => !MONO_EXCLUDED.has(id));
  console.log(
    `generate-fixtures: analysing ${FIXTURE_SECONDS}s @ ${FIXTURE_SAMPLE_RATE} Hz ` +
      `(${tools.length} tools) …`,
  );
  execFileSync(
    BIN,
    ["analyze", wav, ...tools.flatMap((id) => ["-t", id]), "--full", "--out", outDir],
    { stdio: ["ignore", "inherit", "inherit"], maxBuffer: 64 * 1024 * 1024 },
  );

  const files = readdirSync(outDir).filter((name) => name.endsWith(".json"));
  if (files.length === 0) throw new Error(`the CLI wrote no JSON to ${outDir}`);

  const byTool: Record<string, Envelope> = {};
  for (const name of files) {
    const envelope = JSON.parse(readFileSync(join(outDir, name), "utf8")) as Envelope;
    const result = envelope.result;
    const tool = result && typeof result.tool === "string" ? result.tool : null;
    if (!tool) throw new Error(`${name}: result has no tool tag`);
    if (result) thinResult(result);
    byTool[tool] = { summary: envelope.summary, result };
  }

  const missing = tools.filter((id) => !(id in byTool));
  if (missing.length > 0) {
    throw new Error(`the CLI wrote no JSON for: ${missing.join(", ")}`);
  }

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(byTool) + "\n");
  const size = (readFileSync(OUT_JSON).length / 1024).toFixed(0);
  console.log(
    `generate-fixtures: wrote ${Object.keys(byTool).length} tools → ` +
      `${OUT_JSON.split(sep).join("/")} (${size} kB)`,
  );
}

main();
