import { invoke } from "@tauri-apps/api/core";
import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import { toSpec } from "../lib/graph";
import { deepClone } from "../lib/clone";
import type { AnalysisSetup } from "../bindings/AnalysisSetup";
import type { AnalysisWindow } from "../bindings/AnalysisWindow";
import type { Meta } from "../bindings/Meta";
import type { SourceDescriptor } from "../bindings/SourceDescriptor";
import type { StoredResult } from "../bindings/StoredResult";
import { pcmStream } from "../lib/pcmStream";
import { applySharedParams, resetAnalysisParams, sharedParams } from "./analysis";
import { resetToolOptions, setToolOptions, toolOptions } from "./analyzer";
import {
  choice,
  deviceId,
  gain,
  KIND_LABEL,
  mixMicDeviceId,
  mixSystemDeviceId,
  recording,
  setChoice,
  setDeviceId,
  setGainLevel,
  setMixMicDeviceId,
  setMixSystemDeviceId,
  setTargetPid,
  stopCapture,
  stopMonitor,
  targetPid,
  type CaptureKind,
  type SourceChoice,
} from "./capture";
import {
  FILTER_GRAPH,
  filterEnabled,
  graphLayout,
  loadGraph,
  resetGraph,
  setFilterEnabled,
  type GraphLayout,
  SYNTH_GRAPH,
} from "./graph";
import { closeSource, setError, setSource, setStatus, setWindowTitle, source, type ProbeInfo } from "./source";
import {
  setView,
  setWindowEnd,
  setWindowStart,
  viewEnd,
  viewStart,
  windowEnd,
  windowStart,
} from "./timeline";
import { closeAllTools, layoutJson, openTools, restoreLayout } from "./workbench";
import { resetHistory } from "./history";
import { isPopoutWindow } from "../lib/windowRole";

/**
 * Project file store (M6): save/load the binary project (see
 * [`project-file-format.md`](../../docs/project-file-format.md)).
 *
 * The Rust core owns the `DATA` section (the source PCM, ADR-9) and fills in `META`;
 * the frontend supplies `SOURCE` (a descriptor), `SETUP` (shared params, per-tool
 * options, open tools, windows), and `LAYOUT` (dockview + graph editor state). On
 * load the core streams the audio back for the Timeline waveform and installs the
 * PCM for preview/analysis; this module restores the stores and the Workbench tabs,
 * so the analyzers re-derive their results from the embedded audio.
 */

// --- IPC DTOs (generated from `src-tauri` via ts-rs; see `src/bindings/`) -----
//
// The `SOURCE`/`SETUP`/`META`/`RESULTS` shapes come from the Rust types; only
// `LAYOUT` is frontend-owned (it is the JSON the frontend writes into the core's
// opaque `layout` value).

/** `SOURCE` section: what the project's single source was. */
export type SourceDescriptorDto = SourceDescriptor;
/** A `start..end` span in source seconds. */
export type AnalysisWindowDto = AnalysisWindow;
/** `SETUP` section: shared params, per-tool options, open tools, and the windows. */
export type AnalysisSetupDto = AnalysisSetup;
/** `META` section: the project's identity and provenance. */
export type ProjectMetaDto = Meta;

/** `LAYOUT` section: the dockview snapshot plus both graph editors' state. */
export interface LayoutDto {
  dockview: unknown | null;
  graphs: { filter?: GraphLayout; synth?: GraphLayout };
  /** Tools popped out into their own windows (recreated on load). */
  popouts?: string[];
}

/** The frontend-supplied project data for `save_project`; the core adds `META` + `DATA`. */
interface SaveProjectArgs {
  name: string;
  createdMs?: number;
  source: SourceDescriptorDto | null;
  setup: AnalysisSetupDto;
  layout: LayoutDto;
}

/** What `load_project` returns (the `DATA` samples stream separately). */
interface LoadedProjectDto {
  meta: ProjectMetaDto;
  source: SourceDescriptorDto | null;
  setup: AnalysisSetupDto;
  layout: LayoutDto;
  results: StoredResult[];
  sampleRate: number;
  channels: number;
  frames: number;
}

// --- store -------------------------------------------------------------------

export const [projectPath, setProjectPath] = createSignal<string | null>(null);
/** An explicit project title (from a save/load); `null` = follow the source name. */
const [projectTitle, setProjectTitle] = createSignal<string | null>(null);
/** Whether there are unsaved edits (drives the title `*` and the close/new/open prompts). */
export const [dirty, setDirty] = createSignal(false);
/** The project's clean display name (no unsaved marker); shared with popouts. */
export const projectDisplayName = () =>
  projectTitle() ?? source()?.name ?? "Untitled project";
/** The project's display name: the explicit title, else the current source's name. */
export const projectName = () => projectDisplayName() + (dirty() ? " *" : "");
/** Apply the project title (used when a remote window syncs its project name). */
export function applyProjectTitle(name: string | null) {
  setProjectTitle(name);
}
export const [projectStatus, setProjectStatus] = createSignal<"idle" | "saving" | "loading">("idle");
export const [projectError, setProjectError] = createSignal<string | null>(null);
/** Creation time of the loaded project, preserved across re-saves. */
const [createdMs, setCreatedMs] = createSignal<number | null>(null);

// --- helpers -----------------------------------------------------------------

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** A file path's base name without its extension — used as the project title. */
function projectLabel(path: string): string {
  const name = basename(path);
  return name.replace(/\.[^.]+$/, "") || name;
}

function fileProbe(path: string, loaded: LoadedProjectDto): ProbeInfo {
  const channels = Math.max(1, loaded.channels);
  const frames = Math.floor(loaded.frames);
  return {
    path,
    name: basename(path),
    codec: "embedded",
    sampleRate: loaded.sampleRate,
    channels,
    bitsPerSample: 32,
    numFrames: frames,
    durationSecs: loaded.sampleRate > 0 ? frames / loaded.sampleRate : null,
  };
}

function sourceName(descriptor: SourceDescriptorDto | null): string {
  if (!descriptor) return "Source";
  switch (descriptor.kind) {
    case "file":
      return descriptor.path ? basename(descriptor.path) : "Audio file";
    case "synth":
      return "Synth";
    default:
      return KIND_LABEL[descriptor.kind as CaptureKind] ?? descriptor.kind;
  }
}

function sourceDetail(descriptor: SourceDescriptorDto | null): string {
  if (!descriptor) return "project audio";
  switch (descriptor.kind) {
    case "file":
      return "file";
    case "synth":
      return "fundsp synth";
    default:
      return "live capture";
  }
}

/** Fill a `SOURCE` descriptor's unused fields with null (the core defaults them too). */
function descriptor(
  fields: Partial<SourceDescriptor> & Pick<SourceDescriptor, "kind">,
): SourceDescriptor {
  return {
    path: null,
    deviceId: null,
    mixMicDeviceId: null,
    mixSystemDeviceId: null,
    targetPid: null,
    gain: 1,
    graph: null,
    ...fields,
  };
}

/** The project's current source descriptor, derived from the source + picker. */
function currentDescriptor(): SourceDescriptorDto | null {
  const current = source();
  if (!current) return null;
  const pick = choice();
  if (pick === "file") return descriptor({ kind: "file", path: current.probe?.path ?? null });
  if (pick === "synth") {
    return descriptor({ kind: "synth", graph: toSpec(SYNTH_GRAPH.nodes, SYNTH_GRAPH.edges) });
  }
  return descriptor({
    kind: pick,
    deviceId: pick === "mic" || pick === "system" ? deviceId() : null,
    mixMicDeviceId: pick === "mix" ? mixMicDeviceId() : null,
    mixSystemDeviceId: pick === "mix" ? mixSystemDeviceId() : null,
    targetPid: pick === "process" ? targetPid() : null,
    gain: gain(),
  });
}

function currentSetup(): AnalysisSetupDto {
  return {
    shared: sharedParams(),
    toolOptions: deepClone(toolOptions),
    openTools: openTools(),
    window: { startSecs: windowStart(), endSecs: windowEnd() },
    view: { startSecs: viewStart(), endSecs: viewEnd() },
    filterEnabled: filterEnabled(),
  };
}

async function currentLayout(): Promise<LayoutDto> {
  // The core knows which tools are popped out of this project.
  const popouts = await invoke<string[]>("popout_tools").catch(() => []);
  return {
    dockview: layoutJson(),
    graphs: { filter: graphLayout("filter"), synth: graphLayout("synth") },
    popouts,
  };
}

function defaultFileName(): string {
  const base = projectLabel(projectName()).trim().replace(/[^\w.-]+/g, "_") || "project";
  return `${base}.heyl`;
}

/** Remember a project file in the native File → Open Recent menu. */
function rememberRecent(path: string) {
  void invoke("add_recent_project", { path }).catch((err) =>
    console.error("could not update the recent projects", err),
  );
}

// --- unsaved-work tracking ---------------------------------------------------

/**
 * A signature of every piece of state the project file stores. Reading it inside a
 * reactive effect subscribes to those signals, so any edit re-runs the effect and
 * (once a baseline exists) flags the project dirty.
 */
function projectSignature(): string {
  return JSON.stringify({
    source: [source()?.name ?? null, source()?.frames ?? null],
    filter: toSpec(FILTER_GRAPH.nodes, FILTER_GRAPH.edges),
    synth: toSpec(SYNTH_GRAPH.nodes, SYNTH_GRAPH.edges),
    shared: sharedParams(),
    toolOptions,
    window: [windowStart(), windowEnd()],
    view: [viewStart(), viewEnd()],
    filterEnabled: filterEnabled(),
    openTools: openTools(),
    layout: layoutJson(),
  });
}

/** The signature at the last clean point (initial state, save, or load). */
let baseline = projectSignature();
/** True while restoring state, so the restore itself doesn't flag the project dirty. */
let baselining = true;

/** Take the current state as the clean baseline and clear the unsaved marker. */
function markClean() {
  baseline = projectSignature();
  setDirty(false);
}

/** Suppress the dirty effect while a load/new restores state. */
function beginBaseline() {
  baselining = true;
}

/**
 * Re-arm the baseline once restored state has settled. A macrotask runs after Solid
 * has flushed the effect, so the restore neither leaves the project dirty nor hides a
 * subsequent edit.
 */
function endBaseline() {
  window.setTimeout(() => {
    baselining = false;
    setDirty(false);
  }, 0);
}

createRoot(() => {
  createEffect(() => {
    const signature = projectSignature();
    if (baselining) {
      baseline = signature; // the restored state becomes the clean baseline
      return;
    }
    setDirty(signature !== baseline);
  });
});

// The app starts clean: suppress the initial effect run.
endBaseline();

// Keep the native window title in sync with the project name — its `*` marks unsaved
// edits (`setWindowTitle` lives in `state/source.ts`). The memo dedupes so a source's
// per-frame updates don't re-set the title. A popout window owns its own title
// (`<tool> — <project>`, see `PopoutApp.tsx`).
createRoot(() => {
  if (isPopoutWindow) return;
  const title = createMemo(() => projectName());
  createEffect(() => void setWindowTitle(title()));
});

// --- save --------------------------------------------------------------------

async function write(path: string): Promise<boolean> {
  setProjectStatus("saving");
  setProjectError(null);
  try {
    const args: SaveProjectArgs = {
      name: projectLabel(path),
      createdMs: createdMs() ?? undefined,
      source: currentDescriptor(),
      setup: currentSetup(),
      layout: await currentLayout(),
    };
    await invoke("save_project", { path, project: args });
    setProjectPath(path);
    setProjectTitle(projectLabel(path));
    void setWindowTitle(basename(path));
    rememberRecent(path);
    markClean();
    return true;
  } catch (err) {
    setProjectError(String(err));
    return false;
  } finally {
    setProjectStatus("idle");
  }
}

async function pickSavePath(): Promise<string | null> {
  try {
    return await invoke<string | null>("pick_project_save_path", {
      defaultName: defaultFileName(),
    });
  } catch (err) {
    setProjectError(String(err));
    return null;
  }
}

/** Save to the current path, prompting for one if the project has never been saved. */
export async function saveProject(): Promise<void> {
  const existing = projectPath();
  const path = existing ?? (await pickSavePath());
  if (path) await write(path);
}

/** Always prompt for a path, then save. */
export async function saveProjectAs(): Promise<void> {
  const path = await pickSavePath();
  if (path) await write(path);
}

// --- load --------------------------------------------------------------------

function applyDescriptor(descriptor: SourceDescriptorDto | null) {
  if (!descriptor) return;
  setChoice(descriptor.kind as SourceChoice);
  setDeviceId(descriptor.deviceId ?? null);
  setMixMicDeviceId(descriptor.mixMicDeviceId ?? null);
  setMixSystemDeviceId(descriptor.mixSystemDeviceId ?? null);
  setTargetPid(descriptor.targetPid ?? null);
  setGainLevel(descriptor.gain);
}

/** Restore every store from a loaded project (the PCM already streamed in). */
function applyProject(loaded: LoadedProjectDto, samples: Float32Array) {
  // 1. Graph editors first, so mounted graph tabs show the restored graphs.
  loadGraph("filter", loaded.layout?.graphs?.filter);
  loadGraph("synth", loaded.layout?.graphs?.synth);

  // 2. Analysis setup.
  applySharedParams(loaded.setup.shared);
  setToolOptions(loaded.setup.toolOptions ?? {});
  setFilterEnabled(loaded.setup.filterEnabled ?? true);

  // 3. The source PCM + the analysis window / view it was saved with.
  const channels = Math.max(1, loaded.channels);
  const frames = Math.floor(samples.length / channels);
  if (samples.length === 0) {
    // The project had no audio; leave the timeline empty.
    closeSource();
  } else {
    const duration = loaded.sampleRate > 0 ? frames / loaded.sampleRate : 0;
    setSource({
      name: sourceName(loaded.source),
      detail: sourceDetail(loaded.source),
      sampleRate: loaded.sampleRate,
      channels,
      frames,
      duration,
      samples,
      probe:
        loaded.source?.kind === "file" && loaded.source.path
          ? fileProbe(loaded.source.path, loaded)
          : undefined,
    });
    // Fall back to the full span if the saved window/view is missing, degenerate,
    // or out of range for the (now loaded) source.
    const span = (range: AnalysisWindowDto | undefined, fallbackEnd: number) => {
      const end = Math.min(fallbackEnd, Math.max(0, range?.endSecs ?? fallbackEnd));
      const start = Math.min(end, Math.max(0, range?.startSecs ?? 0));
      return end > start ? { startSecs: start, endSecs: end } : { startSecs: 0, endSecs: fallbackEnd };
    };
    const win = span(loaded.setup.window, duration);
    const view = span(loaded.setup.view, duration);
    setWindowStart(win.startSecs);
    setWindowEnd(win.endSecs);
    setView(view.startSecs, view.endSecs);
    setStatus("ready");
    setError(null);
  }

  // 4. Source picker.
  applyDescriptor(loaded.source);

  // 5. Workbench layout last: it mounts the analyzer tabs against the restored state.
  restoreLayout(loaded.layout?.dockview ?? null);

  // 5b. Recreate the windows for tools that had been popped out. Deferred a tick so
  // the restored state has been pushed to the core before the popouts pull it.
  for (const tool of loaded.layout?.popouts ?? []) {
    window.setTimeout(() => {
      void invoke("open_popout_window", { toolId: tool }).catch((err) =>
        console.error("could not restore the popout window", err),
      );
    }, 0);
  }

  // 6. Start a fresh undo history for the loaded project (undo must not step
  //    back across the project boundary).
  resetHistory();
}

/** Open a project file (already chosen) and adopt it as the current project. */
export async function loadProject(path: string): Promise<void> {
  // Loading replaces the source, so stop any live capture first (its poll loop would
  // otherwise keep publishing the capture buffer over the loaded timeline).
  if (recording()) await stopCapture();
  await stopMonitor();

  setProjectStatus("loading");
  setProjectError(null);
  setStatus("decoding");

  const stream = pcmStream();

  try {
    const loaded = await invoke<LoadedProjectDto>("load_project", {
      path,
      onChunk: stream.channel,
    });
    // Wait for the core's end-of-stream sentinel before assembling (large chunks
    // arrive asynchronously — see `lib/pcmStream.ts`).
    await stream.done;
    beginBaseline();
    applyProject(loaded, stream.samples());
    setProjectPath(path);
    setProjectTitle(projectLabel(path));
    setCreatedMs(loaded.meta.createdMs || null);
    void setWindowTitle(basename(path));
    rememberRecent(path);
    endBaseline();
  } catch (err) {
    setProjectError(String(err));
    setStatus("error");
  } finally {
    setProjectStatus("idle");
  }
}

/** Show the native picker and load the chosen project, if any. */
export async function openProject(): Promise<void> {
  let path: string | null;
  try {
    path = await invoke<string | null>("pick_project_open_path");
  } catch (err) {
    setProjectError(String(err));
    return;
  }
  if (path) await loadProject(path);
}

// --- new ---------------------------------------------------------------------

/** Start a fresh project: drop the source, graphs, setup, and Workbench tabs. */
export async function newProject(): Promise<void> {
  if (recording()) await stopCapture();
  await stopMonitor();

  beginBaseline();
  setProjectError(null);
  closeAllTools();
  resetGraph("filter");
  resetGraph("synth");
  resetAnalysisParams();
  resetToolOptions();
  setFilterEnabled(true);
  closeSource();
  setChoice("file");
  setDeviceId(null);
  setTargetPid(null);
  setProjectPath(null);
  setProjectTitle(null);
  setCreatedMs(null);
  resetHistory();
}
