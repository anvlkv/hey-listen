import { createEffect, createRoot, on, createSignal } from "solid-js";
import type { ProjectSnapshot } from "../../bindings/ProjectSnapshot";
import { invoke } from "../../lib/ipc";
import { isPopoutWindow } from "../../lib/windowRole";
import { listenThisWindow } from "../../lib/windowEvents";
import { applySharedParams, sharedParams } from "../analysis";
import { loadToolOptions, toolOptions } from "../analyzer";
import { annotations, replaceAnnotations } from "../annotations";
import { filterEnabled, graphLayout, loadGraph, setFilterEnabled } from "../graph";
import { resetSystems } from "../workbench";
import { source, sourceRevision } from "../source";
import {
  setView,
  setWindowEnd,
  setWindowStart,
  viewEnd,
  viewStart,
  windowEnd,
  windowStart,
} from "../timeline";
import { layoutRevision, openTools, restoreLayout } from "../workbench";
import { createMute, createPusher } from "./pushQueue";
import { projectDisplayName } from "./signals";
import { currentDescriptor, currentLayout, currentSetup } from "./snapshot";
import type { LayoutDto } from "./types";

/**
 * The project-state push: the frontend half of the core-owned undo/redo
 * (ADR-37).
 *
 * Every settled change to the project's content is pushed to the core, which owns the
 * snapshot and the undo/redo stacks. A restore comes back the other way: the
 * `project-restore` event re-applies a snapshot, and the mute flag keeps that restore
 * from being pushed back as a new edit.
 *
 * Only the **project** window pushes — a popout's source is a stub and its dockview is
 * its own, so its state is not the project's. Every window applies a restore.
 */

/** How long a restore keeps the push muted: the layout re-serializes over a tick. */
const RESTORE_SETTLE_MS = 400;

/** Whether undo/redo would do something, as the core broadcasts it. */
interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

const [canUndo, setCanUndo] = createSignal(false);
const [canRedo, setCanRedo] = createSignal(false);
export { canRedo, canUndo };

const mute = createMute();

/** Assemble the project content the core records (the same shape a save writes). */
async function assembleSnapshot(): Promise<ProjectSnapshot> {
  const layout = await currentLayout();
  return {
    name: projectDisplayName(),
    source: currentDescriptor(),
    setup: currentSetup(),
    // `LAYOUT` is frontend-owned JSON: the core stores it opaquely.
    layout: layout as unknown as ProjectSnapshot["layout"],
    annotations: annotations(),
    // The core fills this from its saved comparisons — the full snapshots are not ours.
    compare: [],
  };
}

async function sendSnapshot(): Promise<void> {
  if (mute.active) return;
  const snapshot = await assembleSnapshot();
  // A restore can start while the layout is being serialized.
  if (mute.active) return;
  await invoke("push_project_state", { snapshot }).catch((err) =>
    console.error("could not push the project state", err),
  );
}

/** The coalesced push: one send per gesture, always with the latest state. */
const pusher = createPusher(sendSnapshot, { muted: () => mute.active });

let unmuteTimer: number | undefined;
let release: (() => void) | undefined;

/** Mute the push while a restore is applied, and until it has settled. */
function holdPush() {
  release?.();
  release = mute.hold();
  if (unmuteTimer !== undefined) clearTimeout(unmuteTimer);
  unmuteTimer = window.setTimeout(() => {
    unmuteTimer = undefined;
    release?.();
    release = undefined;
  }, RESTORE_SETTLE_MS);
}

/** Re-apply a restored snapshot through the stores' existing restore helpers. */
function applyRestore(snapshot: ProjectSnapshot) {
  holdPush();
  // `LAYOUT` is the frontend-owned save shape (`./types`).
  const layout = snapshot.layout as unknown as LayoutDto | null;
  // Graphs first, so a mounted graph tab shows the restored graph. A restored graph
  // replaces its subsystems too (their tabs close and re-open with the layout).
  resetSystems("filter");
  resetSystems("synth");
  loadGraph("filter", layout?.graphs?.filter);
  loadGraph("synth", layout?.graphs?.synth);
  setFilterEnabled(snapshot.setup.filterEnabled);
  applySharedParams(snapshot.setup.shared);
  loadToolOptions(snapshot.setup.toolOptions);
  setWindowStart(snapshot.setup.window.startSecs);
  setWindowEnd(snapshot.setup.window.endSecs);
  setView(snapshot.setup.view.startSecs, snapshot.setup.view.endSecs);
  replaceAnnotations(snapshot.annotations);
  restoreLayout(layout?.dockview ?? null);
  // The shared keys (timeline, params, options, name, annotations) arrive as `ui-state`
  // patches after this event and are applied by `state/uiState.ts`.
}

/** Push the project state now, coalesced with a burst of edits. */
export function pushProjectSnapshot() {
  pusher.request();
}

/**
 * Push the project state now and wait for the core to have it, so a New / Open can seed
 * the history base from exactly this state.
 */
export async function flushProjectPush(): Promise<void> {
  pusher.request();
  await pusher.flush();
}

/**
 * Rebase the core's history on the current state (New / Open / a source change): both
 * stacks empty and this state becomes the base, so undo cannot step across the boundary.
 */
export async function resetProjectHistory(): Promise<void> {
  await flushProjectPush();
  await invoke("reset_history").catch((err) =>
    console.error("could not reset the undo history", err),
  );
}

/**
 * Read every store the snapshot covers, without building the snapshot: the effect then
 * re-runs on any edit and the (coalesced) send assembles the state once.
 *
 * Serializing a Solid store is what reads it deeply — every property read subscribes
 * this effect to it (`dirty.ts` reads the same stores the same way).
 */
function trackProjectState() {
  // The project's display name is project content (`META`-adjacent identity).
  projectDisplayName();
  sharedParams();
  JSON.stringify(toolOptions);
  JSON.stringify([graphLayout("filter"), graphLayout("synth")]);
  filterEnabled();
  annotations();
  windowStart();
  windowEnd();
  viewStart();
  viewEnd();
  openTools();
  // The dockview layout is tracked by its revision, not by serializing it here.
  layoutRevision();
  source();
  sourceRevision();
}

/**
 * Start pushing this window's project state and following its restores. Call once per
 * window, after `initUiState` has pulled the shared state.
 */
export function initProjectHistory(): void {
  void listenThisWindow<ProjectSnapshot>("project-restore", (event) => {
    applyRestore(event.payload);
  }).then(() =>
    listenThisWindow<HistoryState>("history-state", (event) => {
      setCanUndo(event.payload.canUndo);
      setCanRedo(event.payload.canRedo);
    }),
  );

  createRoot(() => {
    if (!isPopoutWindow) {
      // Capture every change to the tracked stores; the initial run pushes the state
      // `initUiState` pulled, which seeds the history base.
      createEffect(() => {
        trackProjectState();
        pushProjectSnapshot();
      });
      // A replaced source replaces the whole timeline, so the history must not step
      // across it.
      createEffect(on(sourceRevision, () => void resetProjectHistory(), { defer: true }));
    }
  });

  // A window opened mid-project starts from the project's current availability.
  void invoke<boolean>("can_undo")
    .then(setCanUndo)
    .catch(() => undefined);
  void invoke<boolean>("can_redo")
    .then(setCanRedo)
    .catch(() => undefined);
}
