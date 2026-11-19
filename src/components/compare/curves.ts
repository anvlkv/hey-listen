import { compareViewFamily } from "../../state/compare/id";
import type {
  AnyAnalysisResult,
  LoudnessResult,
  MaskingResult,
  SeriesResult,
  SpectrumResult,
} from "../../state/analyzer";

/**
 * The one place that knows which curve a result puts on a compare chart (M25).
 *
 * The compare views are dispatched by `compareViewFamily`, and each family's chart needs
 * the result's **headline curve**, which is not always the field with the obvious shape:
 * masking headlines in SMR and loudness in sones, and the core diffs exactly those curves.
 * A chart that plotted another field would draw A and B against a Δ line measuring
 * something else. A result from any other family yields `null`, so the chart shows its
 * empty state instead of reading a field that is not there.
 */

/** One value per frame (a gap is `null`) on the result's own frame times. */
export interface SeriesTrack {
  times: number[];
  values: (number | null)[];
}

/** A value per frequency bin, plus the quantity the curve measures. */
export interface SpectrumCurve {
  freqs: number[];
  values: (number | null)[];
  label: string;
}

/** The sone curve loudness headlines (its phon track restates the same measurement). */
function isSoneTrack(
  result: AnyAnalysisResult,
): result is AnyAnalysisResult & Pick<LoudnessResult, "times" | "loudnessSone"> {
  return "loudnessSone" in result;
}

/** The per-frame track every other series-family result shares. */
function isFrameTrack(
  result: AnyAnalysisResult,
): result is AnyAnalysisResult & Pick<SeriesResult, "times" | "values"> {
  return "times" in result && "values" in result;
}

/** The signal-to-mask curve masking headlines. */
function isSmrCurve(
  result: AnyAnalysisResult,
): result is AnyAnalysisResult & Pick<MaskingResult, "freqs" | "smrDb"> {
  return "smrDb" in result;
}

/** The averaged magnitude curve a spectrum headlines. */
function isMagnitudeCurve(
  result: AnyAnalysisResult,
): result is AnyAnalysisResult & Pick<SpectrumResult, "freqs" | "magDb"> {
  return "magDb" in result;
}

/** The per-frame track a series-family result contributes, or `null`. */
export function seriesTrack(result: AnyAnalysisResult | undefined): SeriesTrack | null {
  if (!result || compareViewFamily(result.tool) !== "series") return null;
  if (isSoneTrack(result)) return { times: result.times, values: result.loudnessSone };
  if (isFrameTrack(result)) return { times: result.times, values: result.values };
  return null;
}

/** The frequency curve a spectrum-family result contributes, or `null`. */
export function spectrumCurve(result: AnyAnalysisResult | undefined): SpectrumCurve | null {
  if (!result || compareViewFamily(result.tool) !== "spectrum") return null;
  if (isSmrCurve(result)) return { freqs: result.freqs, values: result.smrDb, label: "SMR" };
  if (isMagnitudeCurve(result)) {
    return { freqs: result.freqs, values: result.magDb, label: "level" };
  }
  return null;
}
