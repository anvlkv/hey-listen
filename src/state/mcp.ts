import { invoke } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { deepClone } from "../lib/clone";
import type { AnalysisWindow } from "../bindings/AnalysisWindow";
import type { Note } from "../bindings/Note";
import {
  ANALYZERS,
  isAnalyzerId,
  setToolOption,
  toolOptions,
  type AnalyzerId,
} from "./analyzer";
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
  createNote,
  deleteNote,
  focusedNoteId,
  noteById,
  notesSorted,
  setFocusedNote,
  updateNote,
  type NotePatch,
} from "./notes";
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
import {
  activeThemeId,
  exportThemeFile,
  importThemeFile,
  isBuiltinTheme,
  listThemeSummaries,
  setThemePreference,
  themeById,
  themePreference,
  type ThemeMode,
  type ThemePreference,
} from "./themes";

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

    // --- notes (app-only; a note lives in a project) ------------------------
    case "list_notes":
      return { notes: notesSorted() };
    case "get_note":
      return { note: requireNote(str(args, "id")) };
    case "create_note": {
      const tool = optionalStr(args, "tool");
      if (tool && !isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);
      const note = createNote({
        timeSecs: num(args, "time"),
        range: "range" in args ? rangeArg(args.range) : null,
        tool: (tool as AnalyzerId | null) ?? null,
        title: optionalStr(args, "title"),
        body: typeof args.body === "string" ? args.body : "",
        // The tool creates data, it does not steal the UI focus (use set_focused_note).
        focus: false,
      });
      return { note };
    }
    case "update_note": {
      const id = str(args, "id");
      requireNote(id);
      const patch: NotePatch = {};
      if ("title" in args) patch.title = optionalStr(args, "title");
      if ("body" in args) {
        if (typeof args.body !== "string") throw new Error("`body` must be a string");
        patch.body = args.body;
      }
      if ("time" in args) patch.timeSecs = num(args, "time");
      if ("range" in args) patch.range = rangeArg(args.range);
      if ("tool" in args) {
        const tool = optionalStr(args, "tool");
        if (tool && !isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);
        patch.tool = (tool as AnalyzerId | null) ?? null;
      }
      if (optionalBool(args, "recomputeValues")) patch.recomputeValues = true;
      return { note: updateNote(id, patch) };
    }
    case "delete_note": {
      const id = str(args, "id");
      deleteNote(id);
      return { id };
    }
    case "set_focused_note": {
      const id = optionalStr(args, "id");
      if (id && !noteById(id)) throw new Error(`unknown note: ${id}`);
      setFocusedNote(id);
      return { focusedNoteId: focusedNoteId() };
    }

    // --- themes (app chrome) ------------------------------------------------
    case "list_themes":
      return {
        themes: listThemeSummaries(),
        active: { ...themePreference(), activeId: activeThemeId() },
      };
    case "get_theme": {
      const id = optionalStr(args, "id") ?? activeThemeId();
      const theme = themeById(id);
      if (!theme) throw new Error(`unknown theme: ${id}`);
      return {
        theme: deepClone(theme),
        builtin: isBuiltinTheme(id),
        active: { ...themePreference(), activeId: activeThemeId() },
      };
    }
    case "set_theme": {
      const patch: Partial<ThemePreference> = {};
      if ("mode" in args) {
        const mode = str(args, "mode");
        if (!["auto", "dark", "light"].includes(mode)) {
          throw new Error(`unknown theme mode: ${mode}`);
        }
        patch.mode = mode as ThemeMode;
      }
      if ("darkThemeId" in args) patch.darkThemeId = slotThemeId(args, "darkThemeId");
      if ("lightThemeId" in args) patch.lightThemeId = slotThemeId(args, "lightThemeId");
      setThemePreference(patch);
      return { ...themePreference(), activeId: activeThemeId() };
    }
    case "import_theme":
      return { theme: await importThemeFile(str(args, "path")) };
    case "export_theme": {
      const id = optionalStr(args, "id") ?? activeThemeId();
      const path = str(args, "path");
      await exportThemeFile(id, path);
      return { id, path };
    }

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
    notes: notesSorted().map(noteSummary),
    focusedNoteId: focusedNoteId(),
  };
}

/** A compact note summary for `get_state` (id/time/tool/title + the values line). */
function noteSummary(note: Note) {
  return {
    id: note.id,
    timeSecs: note.timeSecs,
    range: note.range,
    tool: note.tool,
    title: note.title,
    values: note.values?.text ?? null,
  };
}

/** The source's shape, or `null` when there is none. */
function sourceSummary() {
  const current = source();
  if (!current) return null;
  return {
    name: current.name,
    sampleRate: current.sampleRate,
    channels: current.channels,
    frames: current.frames,
    duration: current.duration,
    live: current.live ?? false,
  };
}

/**
 * Run an analyzer, optionally applying window/params/options first.
 *
 * `display: false` computes without opening (or focusing) the analyzer tab, so an
 * agent can sweep many tools without leaving a Workbench tab per tool. `transient:
 * true` applies `start`/`end`/`params`/`options` to this call only instead of writing
 * them back to the shared stores. The result echoes the effective `params`/`options`.
 *
 * The result's `tool` tag is carried by the analysis result itself, so the envelope
 * does not repeat it.
 */
async function runAnalysis(args: Args) {
  const tool = str(args, "tool");
  if (!isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);

  const transient = optionalBool(args, "transient") ?? false;

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

  // Effective per-tool options, likewise.
  let options = { ...toolOptions[tool] };
  if ("options" in args) {
    const patch = numericOptions(args.options);
    if (transient) {
      options = { ...options, ...patch };
    } else {
      for (const [key, value] of Object.entries(patch)) setToolOption(tool, key, value);
      options = { ...toolOptions[tool] };
    }
  }

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

  const result = await invoke<unknown>("run_analysis", {
    request: { tool, start: span.start, end: span.end, params, options },
  });

  let payload = result;
  if (optionalBool(args, "includeData") ?? false) {
    const maxPoints = optionalNum(args, "maxPoints");
    if (maxPoints != null && maxPoints >= 0) payload = decimate(result, maxPoints);
  } else {
    payload = compact(result);
  }

  return { window: span, params, options, result: payload };
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

/** Keep only the numeric entries of an options patch (non-numbers are ignored). */
function numericOptions(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(asArgs(value))) {
    if (typeof item === "number") out[key] = item;
  }
  return out;
}

/** Clamp `start..end` to the source and set the analysis window. */
function setAnalysisWindow(start: number, end: number) {
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
function clampSet(start: number, end: number, apply: (a: number, b: number) => void) {
  const span = clampSpan(start, end);
  apply(span.start, span.end);
  return span;
}

// --- result shaping (mirrors `src-tauri/src/mcp/dispatch.rs`) ---------------

/** Above this length a numeric / gapped array is summarized. */
const COMPACT_ARRAY_MIN = 8;
/** Above this length any array (numeric or not) is reduced to its length. */
const COMPACT_LENGTH_MIN = 16;

/**
 * Shrink a result for the agent. A long numeric array becomes
 * `{ length, min, max, argmin, argmax }`; a long array with gaps (`null`s, e.g. a pitch
 * track's unvoiced frames) becomes `{ length, nulls, min, max, argmin, argmax }` over
 * the present numbers; any other long array becomes `{ length }`. Objects recurse.
 * `includeData: true` returns the raw result instead. Mirrors the Rust `compact`.
 */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length > COMPACT_ARRAY_MIN) return compactArray(value);
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

function compactArray(items: unknown[]): unknown {
  const length = items.length;
  let min = Infinity;
  let max = -Infinity;
  let argmin = 0;
  let argmax = 0;
  let nulls = 0;
  let present = 0;
  for (let index = 0; index < length; index++) {
    const item = items[index];
    if (item === null) {
      nulls++;
      continue;
    }
    if (typeof item !== "number") {
      return length > COMPACT_LENGTH_MIN ? { length } : items.map(compact);
    }
    present++;
    if (item < min) {
      min = item;
      argmin = index;
    }
    if (item > max) {
      max = item;
      argmax = index;
    }
  }
  if (present === 0) return { length, nulls };
  if (nulls > 0) return { length, nulls, min, max, argmin, argmax };
  return { length, min, max, argmin, argmax };
}

/**
 * Decimate every array longer than `maxPoints` to at most `maxPoints` entries by
 * striding (keeping the first and last), so a bounded `includeData` need not dump every
 * frame. Objects recurse. Mirrors the Rust `decimate`.
 */
function decimate(value: unknown, maxPoints: number): unknown {
  const n = Math.max(2, Math.floor(maxPoints));
  if (Array.isArray(value)) {
    if (value.length > n) {
      const step = (value.length - 1) / (n - 1);
      const out: unknown[] = [];
      for (let index = 0; index < n; index++) {
        out.push(decimate(value[Math.round(index * step)], n));
      }
      return out;
    }
    return value.map((item) => decimate(item, n));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = decimate(item, n);
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

/** One note by id, or a thrown error (the MCP tools fail loudly on a bad id). */
function requireNote(id: string): Note {
  const note = noteById(id);
  if (!note) throw new Error(`unknown note: ${id}`);
  return note;
}

/** Read a note range argument (`{ startSecs, endSecs }`) or `null`. */
function rangeArg(value: unknown): AnalysisWindow | null {
  if (value == null) return null;
  const object = asArgs(value);
  return { startSecs: num(object, "startSecs"), endSecs: num(object, "endSecs") };
}

function graphKind(args: Args): "filter" | "synth" {
  const graph = str(args, "graph");
  if (graph !== "filter" && graph !== "synth") {
    throw new Error(`\`graph\` must be "filter" or "synth"`);
  }
  return graph;
}

/** Read a slot theme id, validating it names a registered theme. */
function slotThemeId(args: Args, key: string): string {
  const id = str(args, key);
  if (!themeById(id)) throw new Error(`unknown theme: ${id} (see list_themes)`);
  return id;
}
