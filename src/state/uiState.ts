import { createEffect, createRoot } from "solid-js";
import type { Annotation } from "../bindings/Annotation";
import { compareSignature } from "./compare/views";
import { analyzerBus, readBusMessage } from "./chartSync";
import { applySharedParams, sharedParams, type SharedParamsDto } from "./analysis";
import { setToolOptions, toolOptions } from "./analyzer";
import {
  filterEnabled,
  graphLayout,
  graphPristine,
  graphsReady,
  loadGraph,
  markGraphsReady,
  setFilterEnabled,
  type GraphLayout,
} from "./graph";
import { resetSystems } from "./workbench";
import {
  selectedAnnotationId,
  annotations,
  replaceAnnotations,
  setSelectedAnnotationId,
} from "./annotations";
import { applyProjectTitle, projectDisplayName, projectPath } from "./project";
import {
  setView,
  setWindowEnd,
  setWindowStart,
  viewEnd,
  viewStart,
  windowEnd,
  windowStart,
} from "./timeline";
import { initUiSync, pushUiState, registerUiState } from "./uiSync";
import { deepClone } from "../lib/clone";
import { isPopoutWindow } from "../lib/windowRole";

/**
 * The keys that make up a project's shared UI state (see `uiSync.ts`). Registering
 * here — before `initUiState` runs — keeps the sync in one place instead of
 * scattering it across the stores.
 */

interface TimelineState {
  windowStart: number;
  windowEnd: number;
  viewStart: number;
  viewEnd: number;
}

interface ProjectState {
  name: string;
  /**
   * The project's file, so the core can re-open this project as a comparison's
   * reference (and raise rather than duplicate a window already showing it).
   */
  path: string | null;
}

/** The two graph editors' layout plus the applied/bypassed flag, as the `graphs` key holds
 *  it (a graph popout must know the toggle to push the same filter the project has). */
interface GraphsState {
  filter?: GraphLayout;
  synth?: GraphLayout;
  enabled?: boolean;
}

/** A marker sourceId so a remote view applies to every chart in its group. */
const REMOTE_VIEW = "__remote__";

/**
 * The graph layout of one scope as JSON, for a cheap change test.
 *
 * A remote `graphs` patch must not rebuild stores it does not change: Node arrays are
 * replaced, their effects re-run (the filter push, the Timeline, the synth Live loop), and
 * two windows would spend every edit re-applying each other's graphs. Comparing the
 * serialized layout first keeps a filter edit from touching the synth graph (and vice
 * versa) and makes an echo a true no-op.
 */
function layoutKey(layout: GraphLayout | undefined): string {
  return JSON.stringify(layout ?? null);
}

/** Whether applying `layout` would change `scope`'s graph. */
function graphChanged(scope: "filter" | "synth", layout: GraphLayout | undefined): boolean {
  return layoutKey(layout) !== layoutKey(graphLayout(scope));
}

/** The `graphs` value this window last pushed or applied (see the effect in `initUiState`). */
let lastGraphsKey: string | undefined;

/** The whole `graphs` payload as JSON, with its defaults filled in. */
function graphsKey(layout: GraphsState): string {
  return JSON.stringify({
    filter: layout.filter ?? null,
    synth: layout.synth ?? null,
    enabled: layout.enabled ?? true,
  });
}

registerUiState("timeline", (value) => {
  const v = value as TimelineState;
  setWindowStart(v.windowStart);
  setWindowEnd(v.windowEnd);
  setView(v.viewStart, v.viewEnd);
});

registerUiState("params", (value) => {
  applySharedParams(value as Partial<SharedParamsDto>);
});

registerUiState("toolOptions", (value) => {
  setToolOptions(value as Record<string, Record<string, number>>);
});

registerUiState("project", (value) => {
  applyProjectTitle((value as ProjectState).name);
});

// Annotations ride the project's shared UI state so a project's windows stay in lockstep
// (ADR-11/ADR-18). A remote selection is applied without the UI side effects (opening
// the chart) that a local `selectAnnotation` performs.
registerUiState("annotations", (value) => {
  replaceAnnotations((value as Annotation[]) ?? []);
});

registerUiState("selectedAnnotationId", (value) => {
  setSelectedAnnotationId((value as string | null) ?? null);
});

// The **graphs** ride the shared state (like the annotations): a graph-editor popout is a
// view of one project's filter/synth graph, so it pulls them here and an edit in either
// window lands in the other. A popout pushes nothing until this key has been applied once
// (`graphsReady`), so its boot seed cannot overwrite the project's graphs.
registerUiState("graphs", (value) => {
  const layout = (value ?? {}) as GraphsState;
  // Apply each graph only when it actually changed. A replaced graph takes its subsystems
  // with it (their tabs re-open with the layout), so this also stops a filter edit from
  // closing the synth's subsystem tabs and vice versa.
  if (graphChanged("filter", layout.filter)) {
    resetSystems("filter");
    loadGraph("filter", layout.filter);
  }
  if (graphChanged("synth", layout.synth)) {
    resetSystems("synth");
    loadGraph("synth", layout.synth);
  }
  setFilterEnabled(layout.enabled ?? true);
  // Remember what we just applied, so the push effect below does not echo it back.
  lastGraphsKey = graphsKey({
    filter: graphLayout("filter"),
    synth: graphLayout("synth"),
    enabled: filterEnabled(),
  });
  markGraphsReady();
});

for (const group of ["time", "freq", "mod"] as const) {
  registerUiState(`view:${group}`, (value) => {
    analyzerBus.setData(
      "view",
      value == null ? null : { sourceId: REMOTE_VIEW, group, x: value as [number, number] },
    );
  });
}

// The **hovered cursor** rides the shared state too, so a chart in the main window
// mirrors the pointer in a popped-out one and back. Tagged per group like the views, so
// a frequency cursor never lands on a time chart. The local publishes come from the
// charts (`chartInteraction` / `mirrorCursor`); this only carries them across windows.
for (const group of ["time", "freq", "mod"] as const) {
  registerUiState(`cursor:${group}`, (value) => {
    analyzerBus.setData("cursorSync", {
      sourceId: REMOTE_VIEW,
      group,
      x: (value as number | null) ?? null,
    });
  });
}

/**
 * Pull the project's shared state and start pushing local edits. Call once per
 * window, after the stores exist.
 *
 * Order matters: the pull **must** finish before the push effects are created.
 * `pushUiState` is dropped until the initial sync has completed (`synced`), so an
 * effect created first would run once, be dropped, and never run again unless the user
 * happened to change that state — leaving a fresh project window with an empty shared
 * state. A peer read (the comparison, M25) would then see defaults for its reference.
 */
export async function initUiState(): Promise<void> {
  await initUiSync();

  createRoot(() => {
    createEffect(() =>
      pushUiState("timeline", {
        windowStart: windowStart(),
        windowEnd: windowEnd(),
        viewStart: viewStart(),
        viewEnd: viewEnd(),
      } satisfies TimelineState),
    );
    createEffect(() => pushUiState("params", sharedParams()));
    createEffect(() => pushUiState("toolOptions", deepClone(toolOptions)));
    createEffect(() => pushUiState("annotations", deepClone(annotations())));
    createEffect(() => pushUiState("selectedAnnotationId", selectedAnnotationId()));
    // Serializing the layouts reads the graph stores deeply, so any edit re-runs this.
    // Skip an unchanged value, so a window that only applied a remote layout (or whose
    // editor touched a derived flag) does not push it back.
    createEffect(() => {
      if (!graphsReady()) return;
      const payload = {
        filter: graphLayout("filter"),
        synth: graphLayout("synth"),
        enabled: filterEnabled(),
      };
      const key = graphsKey(payload);
      if (key === lastGraphsKey) return;
      lastGraphsKey = key;
      pushUiState("graphs", deepClone(payload));
    });
    // The project name is owned by the project window (a popout's source is only a
    // stub, so it must not push its derived name back).
    if (!isPopoutWindow) {
      createEffect(() =>
        pushUiState("project", {
          name: projectDisplayName(),
          path: projectPath(),
        } satisfies ProjectState),
      );
      // Two inputs of the core's dirty signature that are not in the snapshot it already
      // holds: the open compare views' bindings/offsets/fingerprints (M25.C), and whether
      // each graph editor is still seeded (the core's `isEmptyProject`). A popout's copies
      // of both are its own, so only the project window pushes them.
      createEffect(() => pushUiState("compareSignature", compareSignature()));
      createEffect(() =>
        pushUiState("graphPristine", {
          filter: graphPristine("filter"),
          synth: graphPristine("synth"),
        }),
      );
    }
    for (const group of ["time", "freq", "mod"] as const) {
      createEffect(() => {
        // Read every field of the message in every run (`readBusMessage`): returning early
        // on a constant tag would drop the position from this effect's dependencies.
        const view = readBusMessage(analyzerBus.data.view);
        // A cleared view (source replaced) propagates as `null` too, so the other
        // windows fit the new timeline instead of keeping a stale zoom.
        if (view == null) {
          pushUiState(`view:${group}`, null);
          return;
        }
        if (view.group === group && view.sourceId !== REMOTE_VIEW) {
          pushUiState(`view:${group}`, view.x);
        }
      });

      // Only the pointers this window owns are pushed; a remote cursor is applied, never
      // echoed back (`sourceId === REMOTE_VIEW`).
      createEffect(() => {
        const cursor = readBusMessage(analyzerBus.data.cursorSync);
        if (cursor == null || cursor.sourceId === REMOTE_VIEW) return;
        if (cursor.group === group) pushUiState(`cursor:${group}`, cursor.x);
      });
    }
  });
}
