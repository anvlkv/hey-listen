import { invoke } from "../lib/ipc";
import { listenThisWindow } from "../lib/windowEvents";
import type { UiSnapshot } from "../bindings/UiSnapshot";

/**
 * Cross-window UI-state sync.
 *
 * The Rust core owns the project's shared UI state (timeline window/view, analysis
 * params, per-tool options and chart views, project name, popped-out tools). Each
 * window registers a handler per key, pulls the whole state on load, and listens for
 * the patches the project's other windows make. Local edits are pushed back to the
 * core, which broadcasts them — so the main window and its popouts are views of one
 * state instead of diverging copies.
 *
 * A push is **coalesced** ([`PUSH_THROTTLE_MS`]). The keys this carries include ones
 * that change on every pointermove of a gesture — the analysis window, the timeline
 * view, a shared param, a per-tool option. Each push is an IPC round trip plus a
 * broadcast to every other window of the project, and each broadcast re-runs that
 * window's effects and repaints. At pointer rate that queued work faster than it
 * drained, so dragging the analysis window with a popout open stopped responding: the
 * in-page handler stayed cheap (~3 ms) while the cross-window callbacks piled up behind
 * it. Now a burst pushes its first value at once and then at most one per throttle
 * window, always with the latest value, so another window still follows a drag.
 *
 * See `src-tauri/src/commands/ui.rs`.
 */

type Apply = (value: unknown) => void;

/** One `ui-state` broadcast, as the core emits it. */
interface UiStateEvent {
  key: string;
  value: unknown;
  /** The revision the core stored the patch at. */
  revision?: number;
}

const applies = new Map<string, Apply>();

/** Suppress pushes while the initial snapshot is being applied. */
let synced = false;

/**
 * Coalescing window for a burst of pushes of one key, in ms. Short enough that another
 * window follows a drag imperceptibly, long enough that the cross-window work of a
 * pointer-rate gesture stays a fraction of a frame.
 */
const PUSH_THROTTLE_MS = 60;

/** The last value queued per key, sent when its throttle window closes. */
const queued = new Map<string, unknown>();
/** When each key was last pushed, to space the leading edges. */
const lastPushed = new Map<string, number>();
/** Keys with a flush already scheduled. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Register how a state `key` is applied to the local stores. */
export function registerUiState(key: string, apply: Apply) {
  applies.set(key, apply);
}

/**
 * Push a local edit for `key` to the core (which broadcasts it to the project). The
 * leading edge goes out immediately; a burst coalesces into a trailing push of the latest
 * value, so the final state always arrives.
 */
export function pushUiState(key: string, value: unknown) {
  if (!synced) return;
  queued.set(key, value);
  const since = performance.now() - (lastPushed.get(key) ?? Number.NEGATIVE_INFINITY);
  if (since >= PUSH_THROTTLE_MS) {
    flush(key);
    return;
  }
  if (!timers.has(key)) {
    timers.set(
      key,
      setTimeout(() => flush(key), PUSH_THROTTLE_MS - since),
    );
  }
}

/** The in-flight `set_ui_state` call per key, so a closing window can wait for its last edit. */
const inFlight = new Map<string, Promise<void>>();

/** Send `key`'s latest queued value now. */
function flush(key: string) {
  const timer = timers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(key);
  }
  if (!queued.has(key)) return;
  const value = queued.get(key);
  queued.delete(key);
  lastPushed.set(key, performance.now());
  const call = invoke("set_ui_state", { key, value }).then(
    () => undefined,
    (err) => console.error(`ui-state push failed for "${key}"`, err),
  );
  inFlight.set(key, call);
  void call.then(() => {
    if (inFlight.get(key) === call) inFlight.delete(key);
  });
}

/**
 * Send `key`'s queued edit now and resolve once the core has it.
 *
 * A window that edits shared state and then **destroys itself** must await this first: the push
 * is an IPC round trip, and tearing the webview down cancels whatever is still in flight, so the
 * project's other windows never see the edit. The annotation window's Done button is exactly
 * that case — the rail kept the old body (N3 flaked in CI).
 */
export async function flushUiState(key: string): Promise<void> {
  flush(key);
  await inFlight.get(key);
}

/**
 * Pull the project's shared state into the local stores, then start mirroring the
 * project's other windows. Call once, after the stores are registered.
 *
 * The listener is attached **before** the snapshot is fetched: a peer write in the gap
 * must not be lost (audit P2 #11). Patches that arrive during the fetch are buffered;
 * once the snapshot is applied, only the buffered patches **newer than the snapshot's
 * revision** are replayed (the rest are already in the snapshot), in revision order.
 */
export async function initUiSync(): Promise<void> {
  const queued: UiStateEvent[] = [];
  let receiving = true;
  await listenThisWindow<UiStateEvent>("ui-state", (event) => {
    if (receiving) {
      queued.push(event.payload);
      return;
    }
    applies.get(event.payload.key)?.(event.payload.value);
  });

  const snapshot = await invoke<UiSnapshot>("get_ui_state");
  for (const [key, value] of Object.entries(snapshot.values)) applies.get(key)?.(value);

  // Replay the patches the snapshot does not already contain, oldest first.
  receiving = false;
  queued
    .filter((event) => (event.revision ?? 0) > snapshot.revision)
    .sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0))
    .forEach((event) => applies.get(event.key)?.(event.value));

  synced = true;
}
