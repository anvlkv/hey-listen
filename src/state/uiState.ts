import { createEffect, createRoot } from "solid-js";
import type { Note } from "../bindings/Note";
import { analyzerBus, readBusMessage } from "./chartSync";
import { applySharedParams, sharedParams, type SharedParamsDto } from "./analysis";
import { setToolOptions, toolOptions } from "./analyzer";
import { focusedNoteId, notes, replaceNotes, setFocusedNoteId } from "./notes";
import { applyProjectTitle, projectDisplayName } from "./project";
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
}

/** A marker sourceId so a remote view applies to every chart in its group. */
const REMOTE_VIEW = "__remote__";

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

// Notes ride the project's shared UI state so a project's windows stay in lockstep
// (ADR-11/ADR-18). A remote focus is applied without the UI side effects (opening the
// chart / selecting) that a local `selectNote` performs.
registerUiState("notes", (value) => {
  replaceNotes((value as Note[]) ?? []);
});

registerUiState("focusedNoteId", (value) => {
  setFocusedNoteId((value as string | null) ?? null);
});

for (const group of ["time", "freq"] as const) {
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
for (const group of ["time", "freq"] as const) {
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
 */
export async function initUiState(): Promise<void> {
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
    createEffect(() => pushUiState("notes", deepClone(notes())));
    createEffect(() => pushUiState("focusedNoteId", focusedNoteId()));
    // The project name is owned by the project window (a popout's source is only a
    // stub, so it must not push its derived name back).
    if (!isPopoutWindow) {
      createEffect(() =>
        pushUiState("project", { name: projectDisplayName() } satisfies ProjectState),
      );
    }
    for (const group of ["time", "freq"] as const) {
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

  await initUiSync();
}
