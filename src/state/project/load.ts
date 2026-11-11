import { invoke } from "../../lib/ipc";
import { pcmStream } from "../../lib/pcmStream";
import { applySharedParams } from "../analysis";
import { loadToolOptions, seedResults } from "../analyzer";
import {
  KIND_LABEL,
  recording,
  setChoice,
  setDeviceId,
  setGainLevel,
  setMixMicDeviceId,
  setMixSystemDeviceId,
  setTargetPid,
  stopCapture,
  stopMonitor,
  type CaptureKind,
  type SourceChoice,
} from "../capture";
import { loadGraph, setFilterEnabled } from "../graph";
import { restoreSavedComparisons } from "../compare/views";
import { resetHistory } from "../history";
import { replaceAnnotations } from "../annotations";
import {
  closeSource,
  currentSourceToken,
  nextSourceToken,
  setError,
  setSource,
  setStatus,
  setWindowTitle,
  type ProbeInfo,
} from "../source";
import { setView, setWindowEnd, setWindowStart } from "../timeline";
import { dockApi, openTool, restoreLayout, TOOLS } from "../workbench";
import { beginBaseline, endBaseline } from "./dirty";
import { basename, projectLabel } from "./paths";
import { rememberRecent } from "./recents";
import {
  setCreatedMs,
  setProjectError,
  setProjectPath,
  setProjectStatus,
  setProjectTitle,
  setReferenceProject,
  setUpgradedFrom,
} from "./signals";
import type { AnalysisWindowDto, LoadedProjectDto, SourceDescriptorDto } from "./types";

/**
 * Open a project file and restore every store + the Workbench tabs, so the analyzers
 * show the results the file cached and re-run only what it does not (see
 * [`project-file-format.md`](../../../docs/project-file-format.md)).
 */

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
  loadToolOptions(loaded.setup.toolOptions ?? {});
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
      return end > start
        ? { startSecs: start, endSecs: end }
        : { startSecs: 0, endSecs: fallbackEnd };
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

  // 4b. Seed the analyzer result cache. The source, graphs, filter, shared params and
  //     window are the loaded project's now, so a seeded entry is keyed for exactly
  //     what a tab asks for and is adopted instead of recomputing the result.
  seedResults(loaded.results);

  // 5. Workbench layout last: it mounts the analyzer tabs against the restored state.
  restoreLayout(loaded.layout?.dockview ?? null);

  // 5a. A headless save has no dockview layout but records the analyzer tabs in
  //    `SETUP.openTools`; open them so the project comes up as it was saved. A GUI
  //    layout already contains them (and restoring must not steal the active tab), so
  //    this only fills an empty Workbench.
  if ((dockApi()?.panels.length ?? 0) === 0) {
    for (const id of loaded.setup.openTools ?? []) {
      if (TOOLS.some((tool) => tool.id === id)) void openTool(id);
    }
  }

  // 5b. The project's saved comparisons (M25.C) restore as Workbench **tabs**,
  //     bound to their snapshot until the user reconnects a live project. They are
  //     never part of `LAYOUT`, so they are re-created here rather than by dockview.
  restoreSavedComparisons(loaded.compare ?? []);

  // 5c. Reconcile the project's popout windows with the loaded layout: a load replaces
  // the whole project, so the previous project's popouts close and the tools this layout
  // shows popped out get a window (exactly one each). Deferred a tick so the restored
  // state has been pushed to the core before a new popout pulls it.
  const popouts = (loaded.layout?.popouts ?? []).filter((id) =>
    TOOLS.some((tool) => tool.id === id),
  );
  window.setTimeout(() => {
    void invoke("sync_popouts", { tools: popouts }).catch((err) =>
      console.error("could not restore the popout windows", err),
    );
  }, 0);

  // 6. The project's annotations (M14): replace the store (this marks the project clean
  //    again via the baseline below). Applied before the undo history is reset.
  replaceAnnotations(loaded.annotations ?? []);

  // 7. Start a fresh undo history for the loaded project (undo must not step
  //    back across the project boundary).
  resetHistory();
}

/**
 * Open a project file (already chosen) and adopt it as the current project. Returns
 * whether the project became the current one (a failed or superseded load returns
 * `false`).
 */
export async function loadProject(path: string): Promise<boolean> {
  // Loading replaces the source, so stop any live capture first (its poll loop would
  // otherwise keep publishing the capture buffer over the loaded timeline).
  if (recording()) await stopCapture();
  await stopMonitor();

  setProjectStatus("loading");
  setProjectError(null);
  setStatus("decoding");

  // Claim a source-replacement token: a newer open supersedes this load, and this load
  // (and its decode) can never install over one that started later.
  const token = nextSourceToken();
  const stream = pcmStream();

  try {
    const loaded = await invoke<LoadedProjectDto>("load_project", {
      path,
      requestId: token,
      onChunk: stream.channel,
    });
    // A load replaces every view of the project (the core has already installed the new
    // source). A surviving popout still holds the old project's UI state and can push it
    // back while the new state is restored (it made a fresh load come up dirty), so close
    // the old views before the stream is assembled. The saved layout's popouts are reopened
    // by `sync_popouts` below. Closing only after the file decoded keeps a failed load from
    // tearing down the current project's windows.
    await invoke("close_popouts").catch((err) =>
      console.error("could not close the previous popouts", err),
    );
    // Wait for the core's end-of-stream sentinel before assembling (large chunks
    // arrive asynchronously — see `lib/pcmStream.ts`).
    await stream.done;
    if (token !== currentSourceToken()) return false;
    beginBaseline();
    applyProject(loaded, stream.samples());
    setProjectPath(path);
    setProjectTitle(projectLabel(path));
    setCreatedMs(loaded.meta.createdMs || null);
    // A reference project (no `DATA`) re-saves as a reference, not as a full copy.
    setReferenceProject(!loaded.embedded);
    // A file from an older format version is migrated in memory by the core; a save makes
    // the upgrade durable (see `dirty.ts`). See `docs/project-file-format.md` → Migrations.
    setUpgradedFrom(loaded.upgradedFrom ?? null);
    void setWindowTitle(basename(path));
    rememberRecent(path);
    endBaseline();
    return true;
  } catch (err) {
    if (token === currentSourceToken()) {
      setProjectError(String(err));
      setStatus("error");
    }
    return false;
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
