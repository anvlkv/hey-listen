import {
  analyzerById,
  formatHz,
  type AnalyzerId,
  type AnyAnalysisResult,
  type LevelsResult,
  type LraResult,
  type LufsResult,
  type MatrixResult,
  type MatrixView as MatrixViewConfig,
  type RhythmResult,
  type SeriesResult,
  type SeriesView as SeriesViewConfig,
  type SpectrogramResult,
  type SpectrumResult,
  type WaveformResult,
} from "../analyzer";

const db = (value: number) => 20 * Math.log10(Math.max(Math.abs(value), 1e-6));

/** The frame nearest a time on a uniformly-sampled axis. */
function frameIndex(timeSecs: number, duration: number, count: number): number {
  if (!(duration > 0) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((timeSecs / duration) * count)));
}

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
      const frame = frameIndex(timeSecs, r.duration, r.max.length);
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
      const frame = Math.min(r.frames - 1, frameIndex(timeSecs, r.duration, r.frames));
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
    default:
      break;
  }

  if ("times" in result) {
    const r = result as SeriesResult;
    const view = analyzerById(tool).view as SeriesViewConfig;
    const index = presentIndex(r.values, nearestIndex(r.times, timeSecs));
    if (index == null) return `t ${t} s · no value`;
    return `t ${t} s · ${view.yLabel} ${view.formatY(r.values[index]!)}`;
  }
  if ("bins" in result) {
    const r = result as MatrixResult;
    if (r.frames === 0 || r.bins === 0) return `t ${t} s · no data`;
    const view = analyzerById(tool).view as MatrixViewConfig;
    const frame = Math.min(r.frames - 1, frameIndex(timeSecs, r.duration, r.frames));
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
  return `t ${t} s`;
}
