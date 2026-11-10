import { formatHz, type LevelsResult, type LraResult, type LufsResult } from "../../state/analyzer";

/** A small labeled value rendered by the analyzer readout rows. */
export interface ReadoutSpec {
  label: string;
  value: string;
  title?: string;
}

/** Result kinds whose body is just readouts (no chart). */
export type ReadoutResult = LevelsResult | LufsResult | LraResult;

const seconds = (value: number) => `${value.toFixed(3)} s`;

/**
 * Readouts shown above the (chartless) readout tools. Every chart-backed view
 * (waveform, spectrum, spectrogram, series, matrix, rhythm, noteMetrics, modulation)
 * builds its own readouts.
 */
export function readoutsFor(result: ReadoutResult): ReadoutSpec[] {
  switch (result.tool) {
    case "levels":
      return [
        { label: "Peak", value: `${result.peakDb.toFixed(1)} dBFS` },
        { label: "RMS", value: `${result.rmsDb.toFixed(1)} dBFS` },
        { label: "Peak (lin)", value: result.peak.toFixed(3) },
        { label: "RMS (lin)", value: result.rms.toFixed(3) },
        { label: "Duration", value: seconds(result.duration) },
      ];
    case "loudnessIntegrated":
      return [{ label: "Integrated", value: `${result.lufs.toFixed(1)} LUFS` }];
    case "loudnessRange":
      return [{ label: "Loudness range", value: `${result.lra.toFixed(1)} LU` }];
    default:
      return [];
  }
}

/** Readouts for a plain `SeriesResult` (many scalar-over-time spectral tools). */
export function seriesReadouts(
  result: {
    /** Frame count; derived from `values` when a result (such as `spatial`) omits it. */
    frames?: number;
    values?: (number | null)[];
    hopSize: number;
    sampleRate: number;
    minValue: number;
    maxValue: number;
    /** The RMS frame length, for tools that measure per frame (`frameRms`). */
    frameSize?: number | null;
  },
  formatY: (value: number) => string,
): ReadoutSpec[] {
  const frames = result.frames ?? result.values?.length ?? 0;
  const rate = result.sampleRate;
  /** A sample count as its real time in the source, so the frame grid is legible. */
  const asMs = (samples: number) =>
    rate > 0 ? `${((samples / rate) * 1000).toFixed(1)} ms` : `${samples} samples`;
  const samplesTitle = (samples: number) => `${samples} samples at ${formatHz(rate)}`;
  const specs: ReadoutSpec[] = [
    { label: "Frames", value: `${frames}` },
    { label: "Hop", value: asMs(result.hopSize), title: samplesTitle(result.hopSize) },
    { label: "Rate", value: formatHz(rate) },
  ];
  if (result.frameSize != null) {
    specs.push({
      label: "Frame",
      value: asMs(result.frameSize),
      title: `${samplesTitle(result.frameSize)} — the measurement window a frame value summarises`,
    });
  }
  if (frames > 0) {
    specs.push({ label: "Min", value: formatY(result.minValue) });
    specs.push({ label: "Max", value: formatY(result.maxValue) });
  }
  return specs;
}

/** Fraction of a series' frames that carry a value (e.g. voiced pitch frames). */
export function coverage(values: (number | null)[]): number {
  if (values.length === 0) return 0;
  const filled = values.reduce<number>((count, value) => count + (value == null ? 0 : 1), 0);
  return filled / values.length;
}
