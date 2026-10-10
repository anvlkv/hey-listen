import { createEffect, createRoot } from "solid-js";
import { analyzerBus } from "./chartSync";
import { applySharedParams, sharedParams, type SharedParamsDto } from "./analysis";
import { setToolOptions, toolOptions } from "./analyzer";
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

/** Deep-read a store so the effect tracks every leaf, returning a plain object. */
function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => snapshot(item)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object)) {
      out[key] = snapshot((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
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

for (const group of ["time", "freq"] as const) {
  registerUiState(`view:${group}`, (value) => {
    analyzerBus.setData("view", { sourceId: REMOTE_VIEW, group, x: value as [number, number] });
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
    createEffect(() => pushUiState("toolOptions", snapshot(toolOptions)));
    // The project name is owned by the project window (a popout's source is only a
    // stub, so it must not push its derived name back).
    if (!isPopoutWindow) {
      createEffect(() =>
        pushUiState("project", { name: projectDisplayName() } satisfies ProjectState),
      );
    }
    for (const group of ["time", "freq"] as const) {
      createEffect(() => {
        const view = analyzerBus.data.view;
        if (view?.group === group && view.sourceId !== REMOTE_VIEW) {
          pushUiState(`view:${group}`, view.x);
        }
      });
    }
  });

  await initUiSync();
}
