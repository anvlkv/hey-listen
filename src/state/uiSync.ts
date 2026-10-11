import { invoke } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";

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
 * See `src-tauri/src/commands/ui.rs`.
 */

type Apply = (value: unknown) => void;

const applies = new Map<string, Apply>();

/** Suppress pushes while the initial snapshot is being applied. */
let synced = false;

/** Register how a state `key` is applied to the local stores. */
export function registerUiState(key: string, apply: Apply) {
  applies.set(key, apply);
}

/** Push a local edit for `key` to the core (which broadcasts it to the project). */
export function pushUiState(key: string, value: unknown) {
  if (!synced) return;
  void invoke("set_ui_state", { key, value });
}

/**
 * Pull the project's shared state into the local stores, then start mirroring the
 * project's other windows. Call once, after the stores are registered.
 */
export async function initUiSync(): Promise<void> {
  const snapshot = await invoke<Record<string, unknown>>("get_ui_state");
  for (const [key, value] of Object.entries(snapshot)) applies.get(key)?.(value);
  synced = true;

  await listen<{ key: string; value: unknown; source: string }>("ui-state", (event) => {
    applies.get(event.payload.key)?.(event.payload.value);
  });
}
