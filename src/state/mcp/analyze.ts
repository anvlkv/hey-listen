import { invoke } from "../../lib/ipc";
import { applySharedParams, sharedParams, type SharedParamsDto } from "../analysis";
import {
  applyOptionPatch,
  engineOptions,
  isAnalyzerId,
  setToolOption,
  toolOptions,
} from "../analyzer";
import { source } from "../source";
import { setWindowEnd, setWindowStart, windowEnd, windowStart } from "../timeline";
import { openTool } from "../workbench";
import { asArgs, optionalBool, optionalNum, str, type Args } from "./args";

/** The `run_analysis` response: the canonical summary beside the shaped result. */
interface AnalysisReply {
  summary: unknown;
  result?: unknown;
}

/**
 * Run an analyzer, optionally applying window/params/options first.
 *
 * `display: false` computes without opening (or focusing) the analyzer tab, so an
 * agent can sweep many tools without leaving a Workbench tab per tool. `transient:
 * true` applies `start`/`end`/`params`/`options` to this call only instead of writing
 * them back to the shared stores. The result echoes the effective `params`/`options`.
 *
 * The core returns `{ summary, result }`; `shape` picks the amount of result —
 * `compact` by default, `full` with `includeData`, or none with `summaryOnly`. The
 * summary is always present, so an agent never has to read arrays to get the answer.
 */
export async function runAnalysis(args: Args) {
  const tool = str(args, "tool");
  if (!isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);

  const transient = optionalBool(args, "transient") ?? false;
  const summaryOnly = optionalBool(args, "summaryOnly") ?? false;
  const includeData = optionalBool(args, "includeData") ?? false;
  if (summaryOnly && includeData) {
    throw new Error("`summaryOnly` and `includeData` are mutually exclusive");
  }

  // Effective params: a transient patch merges into a snapshot, otherwise it is
  // written back to the shared store and re-read.
  let params = sharedParams();
  if ("params" in args) {
    const patch = asArgs(args.params) as Partial<SharedParamsDto>;
    if (transient) {
      params = mergeParams(params, patch);
    } else {
      applySharedParams(patch);
      params = sharedParams();
    }
  }

  // Effective per-tool options, likewise. The patch is validated (unknown keys fail)
  // and canonicalized, then the engine-only view is what crosses IPC.
  let options = { ...toolOptions[tool] };
  if ("options" in args) {
    const patch = applyOptionPatch(tool, asArgs(args.options));
    if (transient) {
      options = { ...options, ...patch };
    } else {
      for (const [key, value] of Object.entries(patch)) setToolOption(tool, key, value);
      options = { ...toolOptions[tool] };
    }
  }
  const requestOptions = engineOptions(tool, options);

  // Effective window (clamped to the source). An explicit start/end persists unless
  // the call is transient.
  const hasWindow = "start" in args || "end" in args;
  const span = clampSpan(
    optionalNum(args, "start") ?? windowStart(),
    optionalNum(args, "end") ?? windowEnd(),
  );
  if (hasWindow && !transient) setAnalysisWindow(span.start, span.end);

  if (!source()) throw new Error("no source loaded — open a source first");

  // UI following: the tab opens (and, if popped out, its window is raised) unless the
  // caller asked to compute without display.
  if (optionalBool(args, "display") ?? true) await openTool(tool);

  const shape = summaryOnly ? "summary" : includeData ? "full" : "compact";
  const maxPoints = optionalNum(args, "maxPoints");
  // A uniform time axis can be echoed as `{ start, hop, length }` instead of an array.
  // Only meaningful with `includeData`; the default keeps arrays for compatibility.
  const compactAxis = args.axis === "compact";
  const response = await invoke<AnalysisReply>("run_analysis", {
    request: {
      tool,
      start: span.start,
      end: span.end,
      params,
      options: requestOptions,
      shape,
      ...(maxPoints != null ? { maxPoints } : {}),
      ...(compactAxis ? { compactAxis: true } : {}),
    },
  });

  const envelope: Record<string, unknown> = {
    window: span,
    params,
    options,
    axis: compactAxis ? "compact" : "array",
    summary: response.summary,
  };
  if (response.result !== undefined) envelope.result = response.result;
  return envelope;
}

/** Merge a shared-params patch over a base snapshot (mirrors `applySharedParams`). */
function mergeParams(base: SharedParamsDto, patch: Partial<SharedParamsDto>): SharedParamsDto {
  const out = { ...base };
  if (patch.fftSize != null) out.fftSize = patch.fftSize;
  if (patch.hop != null) out.hop = patch.hop;
  if (patch.randomizedOverlap != null) out.randomizedOverlap = patch.randomizedOverlap;
  if (patch.windowFn != null) out.windowFn = patch.windowFn;
  if ("channel" in patch) out.channel = patch.channel ?? null;
  if ("resampleTo" in patch) out.resampleTo = patch.resampleTo ?? null;
  if (patch.freqMinHz != null) out.freqMinHz = patch.freqMinHz;
  if (patch.freqMaxHz != null) out.freqMaxHz = patch.freqMaxHz;
  return out;
}

/** Clamp `start..end` to the source and set the analysis window. */
export function setAnalysisWindow(start: number, end: number) {
  const span = clampSpan(start, end);
  setWindowStart(span.start);
  setWindowEnd(span.end);
  return span;
}

/** Clamp a span to the source duration (when there is one) and order it. */
function clampSpan(start: number, end: number) {
  const duration = source()?.duration ?? 0;
  let a = start;
  let b = end;
  if (duration > 0) {
    a = Math.min(Math.max(0, a), duration);
    b = Math.min(Math.max(0, b), duration);
  }
  if (a > b) [a, b] = [b, a];
  return { start: a, end: b };
}

/** Clamp `start..end` to the source, then apply it to the store. */
export function clampSet(start: number, end: number, apply: (a: number, b: number) => void) {
  const span = clampSpan(start, end);
  apply(span.start, span.end);
  return span;
}
