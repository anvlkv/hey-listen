import { createEffect, createRoot } from "solid-js";
import { toSpec } from "../../lib/graph";
import { sharedParams } from "../analysis";
import { toolOptions } from "../analyzer";
import { FILTER_GRAPH, filterEnabled, SYNTH_GRAPH } from "../graph";
import { notes } from "../notes";
import { source } from "../source";
import { viewEnd, viewStart, windowEnd, windowStart } from "../timeline";
import { layoutJson, openTools } from "../workbench";
import { setDirty } from "./signals";

/**
 * Unsaved-work tracking: a signature of every piece of state the project file
 * stores, compared against the last clean point (initial state, save, or load).
 */

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
    notes: notes(),
  });
}

/** The signature at the last clean point (initial state, save, or load). */
let baseline = projectSignature();
/** True while restoring state, so the restore itself doesn't flag the project dirty. */
let baselining = true;

/**
 * How long the restored state may keep settling before it becomes the clean point.
 *
 * A restore is not one synchronous step: dockview re-serializes its layout a tick after
 * `fromJSON` (and re-syncs `openTools`), and the project's popout windows are reconciled a
 * tick after that. A single macrotask raced those — under load, a freshly **loaded project
 * came up marked dirty** because the settled layout differed from the baseline. So the
 * baseline is re-armed until the state has been quiet for this long.
 */
const SETTLE_MS = 300;

/** The pending settle timer (see [`endBaseline`]). */
let settle: number | undefined;

/** Take the current state as the clean baseline and clear the unsaved marker. */
export function markClean() {
  baseline = projectSignature();
  setDirty(false);
}

/** Suppress the dirty effect while a load/new restores state. */
export function beginBaseline() {
  baselining = true;
  window.clearTimeout(settle);
  settle = undefined;
}

/**
 * Re-arm the baseline once restored state has settled. The state becomes clean after
 * [`SETTLE_MS`] without a change; every change made while restoring pushes that deadline
 * out (see the effect below), so nothing the restore itself settles on is marked dirty.
 */
export function endBaseline() {
  armSettle();
}

/** Restart the quiet period that ends a restore. */
function armSettle() {
  window.clearTimeout(settle);
  settle = window.setTimeout(() => {
    baselining = false;
    markClean();
  }, SETTLE_MS);
}

createRoot(() => {
  createEffect(() => {
    const signature = projectSignature();
    if (baselining) {
      baseline = signature; // the restored state becomes the clean baseline
      armSettle(); // …and a later settling change extends the quiet period
      return;
    }
    setDirty(signature !== baseline);
  });
});

// The app starts clean: suppress the initial effect run.
endBaseline();
