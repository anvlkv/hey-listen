import { invoke } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { deepClone } from "../lib/clone";
import { ANALYZERS, isAnalyzerId, setToolOption, toolOptions } from "./analyzer";
import { applySharedParams, sharedParams, type SharedParamsDto } from "./analysis";
import {
  setView,
  setWindowEnd,
  setWindowStart,
  viewEnd,
  viewStart,
  windowEnd,
  windowStart,
} from "./timeline";
import { closeSource, openPath, source } from "./source";
import { renderSynth } from "./synth";
import {
  filterEnabled,
  filterError,
  flushFilterGraph,
  graphLayout,
  loadGraph,
  setFilterEnabled,
  type GraphLayout,
} from "./graph";
import { dockApi, openTool, openTools, type ToolId } from "./workbench";
import {
  dirty,
  loadProject,
  newProject,
  projectDisplayName,
  projectPath,
  saveProject,
  saveProjectTo,
} from "./project";
import { applyOutputGain, outputDeviceId, outputGain } from "./output";
import {
  applyGain,
  recording,
  setChoice,
  setDeviceId,
  setMixMicDeviceId,
  setMixSystemDeviceId,
  setTargetPid,
  startCapture,
  stopCapture,
  type SourceChoice,
} from "./capture";
import { previewRegion, stop as stopPreviewAudio } from "../audio/preview";

/**
 * MCP tool dispatch (M9).
 *
 * The Rust core owns the MCP server (protocol + transport; see
 * `src-tauri/src/mcp/`). For every `tools/call` it emits `mcp:request` to this
 * project window, which runs the tool here and answers through the `mcp_respond`
 * command. So the agent drives the **same** stores and commands the UI does — an
 * agent action is reflected in the live window, and the window's state is what the
 * agent observes. See `docs/mcp.md`.
 *
 * The tool catalog (names + schemas) lives in `src-tauri/src/mcp/tools.rs`; the
 * handlers below must cover exactly those names.
 */

/** The `mcp:request` payload the core sends. */
interface McpRequest {
  id: number;
  tool: string;
  arguments: unknown;
  /** The resolved project window label the call is routed to (multi-project). */
  target?: string;
}

type Args = Record<string, unknown>;

/** Subscribe to tool calls from the MCP server. Call once per project window. */
export async function initMcp(): Promise<void> {
  try {
    await listen<McpRequest>("mcp:request", (event) => {
      void handle(event.payload);
    });
    // Tell the core the listener is live, so forwarded calls are not attempted
    // before this window can answer them.
    await invoke("mcp_ready");
  } catch (err) {
    console.error("could not initialise the MCP bridge", err);
  }
}

/** Run one tool call and answer the core (never throw: always answer). */
async function handle(request: McpRequest): Promise<void> {
  try {
    const result = await run(request.tool, asArgs(request.arguments), request.target);
    await respond({ id: request.id, ok: true, result });
  } catch (err) {
    console.error(`MCP tool ${request.tool} failed`, err);
    await respond({ id: request.id, ok: false, error: String(err) });
  }
}

async function respond(payload: {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}): Promise<void> {
  try {
    await invoke("mcp_respond", payload);
  } catch (err) {
    console.error("could not answer the MCP server", err);
  }
}

/** Dispatch one tool by name. Throws (bubbled to the agent) on failure. */
async function run(tool: string, args: Args, target?: string): Promise<unknown> {
  switch (tool) {
    case "get_state":
      return getState(target);
    case "list_analyzers":
      return ANALYZERS.map((def) => ({
        id: def.id,
        title: def.title,
        description: def.description,
        section: def.section,
        keywords: def.keywords,
      }));

    // --- source -------------------------------------------------------------
    case "open_audio_file":
      await openPath(str(args, "path"), !optionalBool(args, "replace"));
      return sourceSummary();
    case "close_source":
      closeSource();
      return { source: null };
    case "render_synth":
      await renderSynth(
        optionalNum(args, "seconds") ?? 5,
        !optionalBool(args, "replace"),
      );
      return sourceSummary();

    // --- analysis -----------------------------------------------------------
    case "run_analysis":
      return runAnalysis(args);
    case "set_analysis_window": {
      const span = setAnalysisWindow(num(args, "start"), num(args, "end"));
      return { window: span };
    }
    case "set_view": {
      const span = clampSet(num(args, "start"), num(args, "end"), setView);
      return { view: span };
    }
    case "set_shared_params":
      applySharedParams(asArgs(args.params) as Partial<SharedParamsDto>);
      return { params: sharedParams() };
    case "set_tool_options": {
      const id = analyzerId(args);
      for (const [key, value] of Object.entries(asArgs(args.options))) {
        if (typeof value === "number") setToolOption(id, key, value);
      }
      return { tool: id, options: deepClone(toolOptions[id]) };
    }

    // --- workbench ----------------------------------------------------------
    case "open_tool":
      await openTool(toolId(str(args, "tool")));
      return { openTools: openTools() };
    case "close_tool": {
      const id = toolId(str(args, "tool"));
      dockApi()?.getPanel(id)?.api.close();
      return { openTools: openTools() };
    }

    // --- graphs -------------------------------------------------------------
    case "get_graph":
      return { graph: str(args, "graph"), layout: deepClone(graphLayout(graphKind(args))) };
    case "set_filter_graph": {
      if ("graph" in args) {
        const graph = args.graph;
        if (graph === null) loadGraph("filter", undefined);
        else loadGraph("filter", asArgs(graph) as Partial<GraphLayout>);
      }
      if ("enabled" in args) setFilterEnabled(bool(args, "enabled"));
      await flushFilterGraph();
      return { enabled: filterEnabled(), error: filterError() };
    }
    case "set_synth_graph":
      loadGraph("synth", asArgs(args.graph) as Partial<GraphLayout>);
      return { layout: deepClone(graphLayout("synth")) };

    // --- playback -----------------------------------------------------------
    case "preview": {
      const start = optionalNum(args, "start") ?? windowStart();
      const end = optionalNum(args, "end") ?? windowEnd();
      previewRegion(start, end, optionalBool(args, "loop") ?? true);
      return { start, end };
    }
    case "stop_preview":
      stopPreviewAudio();
      return { playing: false };
    case "set_output_gain":
      applyOutputGain(num(args, "gain"));
      return { gain: outputGain() };

    // --- enumeration --------------------------------------------------------
    case "list_output_devices":
      return invoke("list_output_devices");
    case "list_input_devices":
      return invoke("list_devices");
    case "list_processes":
      return invoke("list_processes");

    // --- capture ------------------------------------------------------------
    case "start_capture": {
      const kind = str(args, "kind");
      if (!["mic", "system", "process", "mix"].includes(kind)) {
        throw new Error(`unknown capture kind: ${kind}`);
      }
      setChoice(kind as SourceChoice);
      applyNullable(args, "deviceId", setDeviceId);
      applyNullable(args, "mixMicDeviceId", setMixMicDeviceId);
      applyNullable(args, "mixSystemDeviceId", setMixSystemDeviceId);
      applyPid(args, "targetPid", setTargetPid);
      if (optionalNum(args, "gain") != null) await applyGain(num(args, "gain"));
      await startCapture();
      return { recording: recording() };
    }
    case "stop_capture":
      await stopCapture();
      return { recording: recording() };

    // --- project ------------------------------------------------------------
    case "save_project": {
      const path = optionalStr(args, "path");
      if (path) {
        const ok = await saveProjectTo(path);
        if (!ok) throw new Error("could not save the project");
      } else {
        await saveProject();
      }
      return { path: projectPath(), name: projectDisplayName(), dirty: dirty() };
    }
    case "open_project":
      await loadProject(str(args, "path"));
      return getState();
    case "new_project":
      await newProject();
      return getState();

    default:
      throw new Error(`unknown tool: ${tool}`);
  }
}

// --- tool implementations --------------------------------------------------

/** The observable project state an agent reads to follow the user. */
function getState(target?: string) {
  return {
    project: {
      name: projectDisplayName(),
      path: projectPath(),
      dirty: dirty(),
      // Which project window this call is looking at (multi-project addressing).
      window: target ?? null,
    },
    source: sourceSummary(),
    window: { start: windowStart(), end: windowEnd() },
    view: { start: viewStart(), end: viewEnd() },
    params: sharedParams(),
    toolOptions: deepClone(toolOptions),
    openTools: openTools(),
    filter: { enabled: filterEnabled(), error: filterError() },
    output: { gain: outputGain(), device: outputDeviceId() },
  };
}

/** The source's shape, or `null` when there is none. */
function sourceSummary() {
  const current = source();
  if (!current) return null;
  return {
    name: current.name,
    detail: current.detail,
    sampleRate: current.sampleRate,
    channels: current.channels,
    frames: current.frames,
    duration: current.duration,
    live: current.live ?? false,
  };
}

/** Open an analyzer tab and run it, optionally applying window/params/options first. */
async function runAnalysis(args: Args) {
  const tool = str(args, "tool");
  if (!isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);

  if ("params" in args) applySharedParams(asArgs(args.params) as Partial<SharedParamsDto>);
  if ("options" in args) {
    for (const [key, value] of Object.entries(asArgs(args.options))) {
      if (typeof value === "number") setToolOption(tool, key, value);
    }
  }
  const start = optionalNum(args, "start");
  const end = optionalNum(args, "end");
  if (start != null || end != null) {
    setAnalysisWindow(start ?? windowStart(), end ?? windowEnd());
  }
  if (!source()) throw new Error("no source loaded — open a source first");

  // UI following: the tab opens (and, if popped out, its window is raised).
  await openTool(tool);

  const span = { start: windowStart(), end: windowEnd() };
  const result = await invoke<unknown>("run_analysis", {
    request: {
      tool,
      start: span.start,
      end: span.end,
      params: sharedParams(),
      options: { ...toolOptions[tool] },
    },
  });

  return {
    tool,
    window: span,
    result: optionalBool(args, "includeData") ? result : compact(result),
  };
}

/** Clamp `start..end` to the source and set the analysis window. */
function setAnalysisWindow(start: number, end: number) {
  return clampSet(start, end, (a, b) => {
    setWindowStart(a);
    setWindowEnd(b);
  });
}

/** Clamp a span to the source duration (when there is one) and apply it. */
function clampSet(start: number, end: number, apply: (a: number, b: number) => void) {
  const duration = source()?.duration ?? 0;
  let a = start;
  let b = end;
  if (duration > 0) {
    a = Math.min(Math.max(0, a), duration);
    b = Math.min(Math.max(0, b), duration);
  }
  if (a > b) [a, b] = [b, a];
  apply(a, b);
  return { start: a, end: b };
}

/**
 * Shrink a result for the agent: long numeric arrays become `{ length, min, max }`,
 * other long arrays just their length. Scalars pass through. `includeData: true`
 * returns the raw result instead.
 */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length > 8 && value.every((item) => typeof item === "number")) {
      let min = Infinity;
      let max = -Infinity;
      for (const item of value as number[]) {
        if (item < min) min = item;
        if (item > max) max = item;
      }
      return { length: value.length, min, max };
    }
    if (value.length > 16) return { length: value.length };
    return value.map(compact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = compact(item);
    }
    return out;
  }
  return value;
}

// --- argument helpers ------------------------------------------------------

function asArgs(value: unknown): Args {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("arguments must be an object");
  }
  return value as Args;
}

function str(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`\`${key}\` is required`);
  }
  return value;
}

function optionalStr(args: Args, key: string): string | null {
  const value = args[key];
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`\`${key}\` must be a string`);
  return value;
}

function num(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`\`${key}\` must be a finite number`);
  }
  return value;
}

function optionalNum(args: Args, key: string): number | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`\`${key}\` must be a finite number`);
  }
  return value;
}

function bool(args: Args, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") throw new Error(`\`${key}\` must be a boolean`);
  return value;
}

function optionalBool(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== "boolean") throw new Error(`\`${key}\` must be a boolean`);
  return value;
}

/** Set a nullable string field (a device id), but only when the agent supplied it. */
function applyNullable(args: Args, key: string, set: (value: string | null) => void) {
  if (key in args) set(optionalStr(args, key));
}

/** Set a nullable numeric field (a process id), but only when the agent supplied it. */
function applyPid(args: Args, key: string, set: (value: number | null) => void) {
  if (key in args) set(optionalNum(args, key) ?? null);
}

function analyzerId(args: Args) {
  const tool = str(args, "tool");
  if (!isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);
  return tool;
}

function toolId(id: string): ToolId {
  if (id !== "filter" && id !== "synth" && !isAnalyzerId(id)) {
    throw new Error(`unknown tool: ${id}`);
  }
  return id as ToolId;
}

function graphKind(args: Args): "filter" | "synth" {
  const graph = str(args, "graph");
  if (graph !== "filter" && graph !== "synth") {
    throw new Error(`\`graph\` must be "filter" or "synth"`);
  }
  return graph;
}
