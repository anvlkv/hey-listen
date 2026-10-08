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
 * Readouts shown above the (chartless) readout tools. Chart-backed tools
 * (waveform, spectrum, spectrogram, series, matrix, rhythm) build their readouts
 * in their own view.
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
  result: { frames: number; hopSize: number; sampleRate: number; minValue: number; maxValue: number },
  formatY: (value: number) => string,
): ReadoutSpec[] {
  const specs: ReadoutSpec[] = [
    { label: "Frames", value: `${result.frames}` },
    { label: "Hop", value: `${result.hopSize}` },
    { label: "Rate", value: formatHz(result.sampleRate) },
  ];
  if (result.frames > 0) {
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
