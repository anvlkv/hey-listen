// Direct sibling imports rather than the `../analyzer` barrel: this module is a pure
// result → text mapper, and the barrel re-exports the debounced runner (which pulls in
// `@dschz/solid-uplot` and its CSS), so the barrel would keep it out of the browser-free
// `scripts/*.test.ts` unit suite. See `scripts/notes.test.ts`.
import { formatHz } from "../analyzer/format";
import { analyzerById } from "../analyzer/lookup";
import type {
  AnalyzerId,
  AnyAnalysisResult,
  LevelsResult,
  LraResult,
  LufsResult,
  MatrixResult,
  MatrixView as MatrixViewConfig,
  ModulationResult,
  NoteMetricsResult,
  RhythmResult,
  SeriesResult,
  SeriesView as SeriesViewConfig,
  SpectrogramResult,
  SpectrumResult,
  WaveformResult,
} from "../analyzer/types";
import { noteFrameAt } from "../../lib/note";

const db = (value: number) => 20 * Math.log10(Math.max(Math.abs(value), 1e-6));

/** The index nearest `time` in an irregular time axis. */
function nearestIndex(times: number[], timeSecs: number): number {
  if (times.length === 0) return 0;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < times.length; i++) {
    const distance = Math.abs(times[i] - timeSecs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** The nearest index at or around `index` whose value is present (not a gap). */
function presentIndex(values: (number | null)[], index: number): number | null {
  for (let offset = 0; offset < values.length; offset++) {
    const right = index + offset;
    if (right < values.length && values[right] != null) return right;
    const left = index - offset;
    if (left >= 0 && values[left] != null) return left;
  }
  return null;
}

/** The compact values line for a tool's result at a time (the note's subtitle). */
export function valuesText(tool: AnalyzerId, result: AnyAnalysisResult, timeSecs: number): string {
  const t = timeSecs.toFixed(3);
  switch (result.tool) {
    case "waveform": {
      const r = result as WaveformResult;
      const frame = noteFrameAt(timeSecs, r.windowStart, r.duration, r.max.length);
      if (r.max.length === 0) return `t ${t} s · no data`;
      const peak = Math.max(Math.abs(r.max[frame]), Math.abs(r.min[frame]));
      return `t ${t} s · peak ${db(peak).toFixed(1)} dBFS`;
    }
    case "spectrum": {
      const r = result as SpectrumResult;
      return `peak ${formatHz(r.peakHz)} · ${r.peakDb.toFixed(1)} dB`;
    }
    case "spectrogram": {
      const r = result as SpectrogramResult;
      if (r.frames === 0 || r.bins === 0) return `t ${t} s · no data`;
      const frame = noteFrameAt(timeSecs, r.windowStart, r.duration, r.frames);
      const base = frame * r.bins;
      let bin = 0;
      let best = -Infinity;
      for (let b = 0; b < r.bins; b++) {
        const value = r.magDb[base + b];
        if (value > best) {
          best = value;
          bin = b;
        }
      }
      return `t ${t} s · peak ${best.toFixed(1)} dB @ ${formatHz(r.freqs[bin] ?? 0)}`;
    }
    case "levels": {
      const r = result as LevelsResult;
      return `peak ${r.peakDb.toFixed(1)} dBFS · RMS ${r.rmsDb.toFixed(1)} dBFS`;
    }
    case "loudnessIntegrated":
      return `${(result as LufsResult).lufs.toFixed(1)} LUFS`;
    case "loudnessRange":
      return `${(result as LraResult).lra.toFixed(1)} LU`;
    case "tempo":
    case "onsets":
    case "downbeats": {
      const r = result as RhythmResult;
      const index = nearestIndex(r.times, timeSecs);
      const strength = r.onsetStrength[index];
      return strength == null
        ? `t ${t} s · no onset`
        : `t ${t} s · onset strength ${strength.toFixed(4)}`;
    }
    case "noteMetrics": {
      const r = result as NoteMetricsResult;
      const noteIndex = r.notes.findIndex(
        (note) => timeSecs >= note.startSecs && timeSecs <= note.endSecs,
      );
      if (noteIndex >= 0) {
        const note = r.notes[noteIndex];
        return `t ${t} s · note ${noteIndex + 1}/${r.noteCount} · RMS ${note.rmsDb.toFixed(1)} dBFS`;
      }
      const gap = r.gaps.find((span) => timeSecs >= span.startSecs && timeSecs <= span.endSecs);
      if (gap) return `t ${t} s · gap ${(gap.durationSecs * 1000).toFixed(0)} ms`;
      return `t ${t} s · no note`;
    }
    case "modulation": {
      const r = result as ModulationResult;
      // Inside the analysed FM run report the pitch modulation; elsewhere the AM one.
      const inFmRun =
        r.fmRunStartSecs != null &&
        r.fmRunEndSecs != null &&
        timeSecs >= r.fmRunStartSecs &&
        timeSecs <= r.fmRunEndSecs;
      const rate = inFmRun ? r.fmRateHz : r.amPeaks[0]?.rateHz;
      if (rate == null) return `t ${t} s · no modulation`;
      const depth = inFmRun
        ? r.fmPeakToPeakCents != null
          ? `${r.fmPeakToPeakCents.toFixed(0)} ¢ p–p`
          : null
        : r.amDepth != null
          ? `${(r.amDepth * 100).toFixed(0)}% depth`
          : null;
      const kind = inFmRun ? "FM" : "AM";
      return `t ${t} s · ${kind} ${rate.toFixed(1)} Hz${depth ? ` · ${depth}` : ""}`;
    }
    default:
      break;
  }

  // A matrix result carries `times` **as well as** `bins` / `values`, so the band
  // check must come first: testing `times` first would classify every mel / MFCC /
  // chroma / contrast heatmap as a series and call the matrix view config's missing
  // `formatY`, which throws and (before the guard in `captureValues`) lost the note.
  if ("bins" in result && "values" in result) {
    const r = result as MatrixResult;
    if (r.frames === 0 || r.bins === 0) return `t ${t} s · no data`;
    const view = analyzerById(tool).view as MatrixViewConfig;
    const frame = noteFrameAt(timeSecs, r.windowStart, r.duration, r.frames);
    const base = frame * r.bins;
    let band = 0;
    let best = -Infinity;
    for (let b = 0; b < r.bins; b++) {
      const value = r.values[base + b];
      if (value > best) {
        best = value;
        band = b;
      }
    }
    return `t ${t} s · ${view.yLabel} ${view.formatBand(band)}: ${view.formatValue(best)}`;
  }
  if ("times" in result) {
    const r = result as SeriesResult;
    const view = analyzerById(tool).view as SeriesViewConfig;
    const index = presentIndex(r.values, nearestIndex(r.times, timeSecs));
    if (index == null) return `t ${t} s · no value`;
    return `t ${t} s · ${view.yLabel} ${view.formatY(r.values[index]!)}`;
  }
  return `t ${t} s`;
}
