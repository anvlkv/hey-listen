import { invoke } from "../../lib/ipc";
import { pcmStream } from "../../lib/pcmStream";
import { applySharedParams } from "../analysis";
import { setToolOptions } from "../analyzer";
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
import { resetHistory } from "../history";
import { replaceNotes } from "../notes";
import {
  closeSource,
  setError,
  setSource,
  setStatus,
  setWindowTitle,
  type ProbeInfo,
} from "../source";
import { setView, setWindowEnd, setWindowStart } from "../timeline";
import { restoreLayout } from "../workbench";
import { beginBaseline, endBaseline } from "./dirty";
import { basename, projectLabel } from "./paths";
import { rememberRecent } from "./recents";
import {
  setCreatedMs,
  setProjectError,
  setProjectPath,
  setProjectStatus,
  setProjectTitle,
} from "./signals";
import type { AnalysisWindowDto, LoadedProjectDto, SourceDescriptorDto } from "./types";

/**
 * Open a project file and restore every store + the Workbench tabs, so the analyzers
 * re-derive their results from the embedded audio (see
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

  // 6. The project's notes (M14): replace the store (this marks the project clean
  //    again via the baseline below). Applied before the undo history is reset.
  replaceNotes(loaded.notes ?? []);

  // 7. Start a fresh undo history for the loaded project (undo must not step
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
