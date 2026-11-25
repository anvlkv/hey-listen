import type { LoadedProjectDto } from "../../bindings/LoadedProjectDto";
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
import { resetSystems } from "../workbench";
import { restoreSavedComparisons } from "../compare/views";
import { replaceAnnotations } from "../annotations";
import {
  closeSource,
  currentSourceToken,
  nextSourceToken,
  openPath,
  setError,
  setSource,
  setStatus,
  setWindowTitle,
  type ProbeInfo,
} from "../source";
import { askBrokenLink, setSourceStorage, syncSourceWatch } from "../sourceStorage";
import { setView, setWindowEnd, setWindowStart } from "../timeline";
import { setSynthSeconds } from "../synth";
import { flushAllUiState } from "../uiSync";
import {
  dockApi,
  isPopoutView,
  openTool,
  refreshPoppedViews,
  restoreLayout,
  TOOLS,
} from "../workbench";
import { basename, projectLabel } from "./paths";
import { flushProjectPush, resetProjectHistory } from "./push";
import { rememberRecent } from "./recents";
import {
  setCreatedMs,
  setProjectError,
  setProjectPath,
  setProjectStatus,
  setProjectTitle,
  setUpgradedFrom,
} from "./signals";
import type { AnalysisWindowDto, LayoutDto, SourceDescriptorDto } from "./types";

/**
 * Open a project file and restore every store + the Workbench tabs, so the analyzers
 * show the results the file cached and re-run only what it does not.
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
  // The file's storage choice is project content: the panel shows it and a re-save keeps it.
  setSourceStorage(descriptor.storage);
}

/**
 * A project whose source file could not be decoded opens with an empty timeline; offer
 * to locate the file again. Cancel keeps the empty timeline (the panel still shows the
 * mode the project was saved with).
 */
async function promptMissingLink(path: string | null) {
  if ((await askBrokenLink("open", path)) !== "locate") return;
  const picked = await invoke<string | null>("pick_audio_file");
  if (picked) await openPath(picked, false, "linked");
}

/** Restore every store from a loaded project (the PCM already streamed in). */
async function applyProject(loaded: LoadedProjectDto, samples: Float32Array) {
  // The project content arrives as one projection (M24.A phase 2); `LAYOUT` is the
  // frontend-owned JSON the core stored opaquely.
  const snapshot = loaded.snapshot;
  const layout = snapshot.layout as unknown as LayoutDto | null;

  // 1. Graph editors first, so mounted graph tabs show the restored graphs.
  //    A restored graph replaces its subsystems too (their tabs close and re-open
  //    from the restored layout below).
  resetSystems("filter");
  resetSystems("synth");
  loadGraph("filter", layout?.graphs?.filter);
  loadGraph("synth", layout?.graphs?.synth);

  // 2. Analysis setup.
  applySharedParams(snapshot.setup.shared);
  loadToolOptions(snapshot.setup.toolOptions ?? {});
  setFilterEnabled(snapshot.setup.filterEnabled ?? true);

  // 3. The source PCM + the analysis window / view it was saved with.
  const channels = Math.max(1, loaded.channels);
  const frames = Math.floor(samples.length / channels);
  if (samples.length === 0) {
    // The project had no audio; leave the timeline empty.
    closeSource();
  } else {
    const duration = loaded.sampleRate > 0 ? frames / loaded.sampleRate : 0;
    const isSynth = snapshot.source?.kind === "synth";
    // The Length field follows the synth source it describes, so Live re-renders the
    // same piece rather than a default-length (shorter) one (`state/synth.ts`).
    if (isSynth) setSynthSeconds(Math.round(duration * 1000) / 1000);
    setSource({
      name: sourceName(snapshot.source),
      detail: sourceDetail(snapshot.source),
      sampleRate: loaded.sampleRate,
      channels,
      frames,
      duration,
      samples,
      // A saved synth project keeps its origin, so re-rendering it later is silent
      // (ADR-21) instead of asking to replace a file.
      origin: isSynth ? "synth" : undefined,
      probe:
        snapshot.source?.kind === "file" && snapshot.source.path
          ? fileProbe(snapshot.source.path, loaded)
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
    const win = span(snapshot.setup.window, duration);
    const view = span(snapshot.setup.view, duration);
    setWindowStart(win.startSecs);
    setWindowEnd(win.endSecs);
    setView(view.startSecs, view.endSecs);
    setStatus("ready");
    setError(null);
  }

  // 4. Source picker.
  applyDescriptor(snapshot.source);

  // 4b. Seed the analyzer result cache. The source, graphs, filter, shared params and
  //     window are the loaded project's now, so a seeded entry is keyed for exactly
  //     what a tab asks for and is adopted instead of recomputing the result.
  seedResults(loaded.results);

  // 5. Workbench layout last: it mounts the analyzer tabs against the restored state.
  restoreLayout(layout?.dockview ?? null);

  // 5a. A headless save has no dockview layout but records the analyzer tabs in
  //    `SETUP.openTools`; open them so the project comes up as it was saved. A GUI
  //    layout already contains them (and restoring must not steal the active tab), so
  //    this only fills an empty Workbench.
  if ((dockApi()?.panels.length ?? 0) === 0) {
    for (const id of snapshot.setup.openTools ?? []) {
      if (TOOLS.some((tool) => tool.id === id)) void openTool(id);
    }
  }

  // 5b. The project's saved comparisons (M25.C) restore as Workbench **tabs**,
  //     bound to their snapshot until the user reconnects a live project. They are
  //     never part of `LAYOUT`, so they are re-created here rather than by dockview.
  restoreSavedComparisons(loaded.compare ?? []);

  // 5c. Reconcile the project's popout windows with the loaded layout: a load replaces
  //    the whole project, so the previous project's popouts close and the views this layout
  //    shows popped out get a window (exactly one each). The restored shared state is
  //    flushed first (a popout pulls it as it boots — including the graphs it edits —
  //    and must not see the previous project's), and the step is **awaited** so the core
  //    holds the new aliases — and the `LAYOUT.popouts` the next push carries — inside the
  //    load's dirty baseline: reconciled after it, that change read as an edit and a
  //    freshly loaded project came up dirty.
  await flushAllUiState();
  const popouts = (layout?.popouts ?? []).filter(isPopoutView);
  await invoke("sync_popouts", { views: popouts }).catch((err) =>
    console.error("could not restore the popout windows", err),
  );
  void refreshPoppedViews();

  // 6. The project's annotations (M14): replace the store (this marks the project clean
  //    again via the baseline below). Applied before the undo history is reset.
  replaceAnnotations(snapshot.annotations ?? []);

  // 7. Rebase the undo history on the loaded project: the push that runs first seeds the
  //    core's base snapshot with the state just restored, so the load records no step
  //    and undo cannot step back across the project boundary.
  await resetProjectHistory();
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
    // Restoring state is not an edit: the core keeps its dirty baseline open until the
    // load has settled.
    await invoke("begin_project_baseline");
    try {
      await applyProject(loaded, stream.samples());
      setProjectPath(path);
      setProjectTitle(projectLabel(path));
      setCreatedMs(loaded.createdMs || null);
      // A file from an older format version is migrated in memory; the core keeps the
      // project dirty until a save writes the current one (see `signals.ts`).
      setUpgradedFrom(loaded.upgradedFrom ?? null);
      void setWindowTitle(basename(path));
      rememberRecent(path);
      // The restored state — including the popouts reconciled above — is the clean point:
      // flush the coalesced push so the settle that `end_project_baseline` arms locks a
      // baseline of exactly this state rather than of the last push to land.
      await flushProjectPush();
      // A live-link project watches its file while it is open (the core owns the watcher).
      void syncSourceWatch();
      if (loaded.linkMissing) void promptMissingLink(loaded.snapshot.source?.path ?? null);
      return true;
    } finally {
      // Re-arm the baseline even when the restore failed: state was partially replaced,
      // and dirty tracking must not stay suppressed.
      await invoke("end_project_baseline").catch((err) =>
        console.error("could not re-arm the dirty baseline", err),
      );
    }
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
