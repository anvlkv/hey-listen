import { Channel } from "@tauri-apps/api/core";
import { errorMessage, invoke } from "../../lib/ipc";
import { hopWidenedNote, runSpanLabel, startRun } from "../../lib/runLog";
import { applySharedParams, mergeParams, sharedParams, type SharedParamsDto } from "../analysis";
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
  hopWidenedFromSamples?: number;
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
 *
 * `channels: [0, 1, 2]` runs the tool once per output channel and returns one envelope
 * each under `channels` — the way to compare a filter graph's bands in one call.
 */
export async function runAnalysis(args: Args) {
  const channels = channelSweep(args);
  return channels ? sweepChannels(args, channels) : runOne(args);
}

/** A `channels` argument (two or more), or null for a normal single-channel call. */
function channelSweep(args: Args): number[] | null {
  const raw = args.channels;
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error("`channels` needs at least two output channels");
  }
  return raw.map((value) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 15) {
      throw new Error(`\`channels\` entries must be output channels 0..15 (got ${String(value)})`);
    }
    return value;
  });
}

/**
 * Run the tool once per channel. The sweep is always **transient**: each entry would
 * otherwise leave its own channel behind as the project's setting, and the last one
 * would win. The analyzer tab still opens once when `display` allows it.
 */
async function sweepChannels(args: Args, channels: number[]) {
  const tool = str(args, "tool");
  if (!isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);
  const patch = asArgs(args.params ?? {});
  const entries: unknown[] = [];
  for (const channel of channels) {
    const envelope = await runOne({
      ...args,
      params: { ...patch, channel },
      transient: true,
      display: false,
    });
    entries.push({ channel, ...(envelope as Record<string, unknown>) });
  }
  if (optionalBool(args, "display") ?? true) await openTool(tool);
  return { tool, channels: entries };
}

/** One analyzer run over one channel (the shape every `run_analysis` documented). */
async function runOne(args: Args) {
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
  const log = startRun("analysis", `${tool} ${runSpanLabel(span.start, span.end)} (mcp)`);
  log.start();
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
    // The command's stage progress is required as a `Channel` (D-21). An agent call has
    // no view to drive, so the messages go to a channel nobody listens on.
    onProgress: new Channel(),
  }).catch((err: unknown) => {
    log.finish("failed", errorMessage(err));
    throw err;
  });
  if (response.hopWidenedFromSamples != null) {
    log.warn(hopWidenedNote(response.hopWidenedFromSamples));
  }
  log.finish("ok");

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
