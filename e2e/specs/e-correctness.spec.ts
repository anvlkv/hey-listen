/**
 * E. Analyzer correctness spot-checks (E1–E5).
 *
 * The `sine440` fixture (a −12 dBFS, 440 Hz tone) gives most checks a known value;
 * `tempo` uses `chirp_noise` because a steady tone has no rhythm. Where a value has
 * no UI readout we read it straight from `run_analysis` via `invokeCore` (the one
 * sanctioned non-UI path — see `docs/testing.md` → "Deliberately out of scope").
 */

import { analyzerPanel } from "../support/selectors.ts";
import {
  openFixture,
  openTool,
  cardValue,
  invokeCore,
  waitForApp,
  closeAllTabs,
} from "../support/helpers.ts";

/**
 * Default shared params (`src/state/analysis.ts`): the values every analyzer runs
 * with until the user changes them.
 */
const DEFAULT_PARAMS = {
  fftSize: 2048,
  hop: 0.25,
  randomizedOverlap: false,
  windowFn: "hann",
  channel: null as number | null,
  resampleTo: null as number | null,
  freqMinHz: 0,
  freqMaxHz: 0,
};

/**
 * Call the real backend `run_analysis`. The Rust command takes a single `request`
 * argument (`{ request: AnalysisRequest }`) and answers `{ summary, result }`; the
 * specs read the raw result, so unwrap `result` here.
 */
async function runAnalysis<T>(tool: string, start: number, end: number): Promise<T> {
  const response = await invokeCore<{ result?: T }>("run_analysis", {
    request: { tool, start, end, params: DEFAULT_PARAMS, options: {}, shape: "full" },
  });
  return response.result as T;
}

/** Median of a numeric array (even counts average the two middle values). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** As in the D spec: wait for a readout-card result (`.readout-value` is chart-only). */
async function waitForReadouts(id: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const panel = await $(analyzerPanel(id));
      if (!(await panel.isExisting())) return false;
      if (await panel.$('[data-testid="analyzer.busy"]').isExisting()) return false;
      return (await panel.$$(".readout-card-value").length) > 0;
    },
    { timeout: 60_000, timeoutMsg: `analyzer "${id}" never rendered its readouts` },
  );
}

/** Poll until the loaded source is ~`expected` seconds long (a source swap is async). */
async function waitForSourceDuration(expected: number, timeout = 30_000): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        const wf = await runAnalysis<{ duration: number }>("waveform", 0, expected + 1);
        return Math.abs(wf.duration - expected) < 0.25;
      } catch {
        return false;
      }
    },
    { timeout, timeoutMsg: `the source never became ~${expected}s long` },
  );
}

describe("E. Analyzer correctness spot-checks", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    await openFixture("sine440");
  });

  it("E1 spectrum peak is at 440 Hz (within one STFT bin)", async () => {
    const res = await runAnalysis<{ peakHz: number; sampleRate: number; fftSize: number }>(
      "spectrum",
      0.1,
      1.9,
    );
    const oneBin = res.sampleRate / res.fftSize; // 48000 / 2048 ≈ 23.4 Hz
    const tolerance = Math.max(10, oneBin); // one bin, floored at a generous ±10 Hz
    expect(Math.abs(res.peakHz - 440)).toBeLessThanOrEqual(tolerance);
  });

  it("E2 pYIN median f0 is within 2% of 440 Hz", async () => {
    const res = await runAnalysis<{ values: (number | null)[] }>("pitchPyin", 0.1, 1.9);
    const voiced = res.values.filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
    expect(voiced.length).toBeGreaterThan(0);
    const f0 = median(voiced);
    expect(Math.abs(f0 - 440) / 440).toBeLessThanOrEqual(0.02);
  });

  it("E3 levels peak is ≈ −12 dBFS", async () => {
    await openTool("levels");
    await waitForReadouts("levels");
    const text = await cardValue("levels", "Peak");
    expect(text).toBeTruthy();
    const db = Number.parseFloat(text as string);
    expect(Number.isFinite(db)).toBe(true);
    expect(Math.abs(db - -12)).toBeLessThanOrEqual(0.5);
  });

  it("E4 integrated loudness matches the tone's expected LUFS (± 2 LU)", async () => {
    await openTool("loudnessIntegrated");
    await waitForReadouts("loudnessIntegrated");
    const text = await cardValue("loudnessIntegrated", "Integrated");
    expect(text).toBeTruthy();
    const lufs = Number.parseFloat(text as string);
    expect(Number.isFinite(lufs)).toBe(true);
    // EBU R128: L_K ≈ −0.691 + 10·log10(mean square) for the K-weighted signal. A
    // −12 dBFS-peak sine has amplitude A = 10^(−12/20) and mean square A²/2; the
    // K-weighting gain is ~0 dB at 440 Hz, so expected ≈ −15.7 LUFS.
    const amp = 10 ** (-12 / 20);
    const expected = -0.691 + 10 * Math.log10((amp * amp) / 2);
    expect(Math.abs(lufs - expected)).toBeLessThanOrEqual(2);
  });

  it("E5 tempo on chirp_noise is finite (and plausible when detected)", async () => {
    // This test runs last: swapping the source replaces the whole timeline.
    await openFixture("chirpNoise");
    await waitForSourceDuration(3);

    const result = await runAnalysis<{ bpm: number; confidence: number }>("tempo", 0, 3);
    expect(Number.isFinite(result.bpm)).toBe(true);
    // A log sweep + noise burst is not a rhythmic signal, so a stable tempo may not
    // be found (bpm 0). When one is, require a musically plausible 40–240 BPM —
    // a deliberately wide tolerance rather than a fixture-specific expectation.
    if (result.bpm > 0) {
      expect(result.bpm).toBeGreaterThanOrEqual(40);
      expect(result.bpm).toBeLessThanOrEqual(240);
    }
  });
});
