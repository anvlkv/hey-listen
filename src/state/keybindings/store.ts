import { createSignal, type Accessor } from "solid-js";
import { DEFAULT_BINDINGS } from "./defaults";
import { BINDINGS_STORAGE_KEY, mergeBindings, parseStored, serializeStored } from "./model";
import { normalizeBinding } from "./parse";
import type { CommandId } from "./types";

/**
 * The reactive binding store ([`hotkeys.md`](../../../docs/hotkeys.md) → "Persistence").
 * It merges the stored overrides over [`DEFAULT_BINDINGS`](./defaults.ts) once at module
 * load and persists only the overrides. This is the one module in the keybinding core
 * allowed to touch `localStorage`/`window`, and every access is guarded so importing the
 * store in the node unit suite is safe.
 */

type Overrides = Record<string, string | null>;

/** `localStorage` when available; `null` in node, private mode or a locked store. */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Read the stored overrides map; any storage failure reads as "no overrides". */
function readOverrides(): Overrides {
  const store = storage();
  if (!store) return {};
  try {
    return parseStored(store.getItem(BINDINGS_STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Persist the overrides map; a storage failure only costs persistence, not the session. */
function writeOverrides(overrides: Overrides): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(BINDINGS_STORAGE_KEY, serializeStored(overrides));
  } catch {
    // Not persisting is fine; the binding still applies for this session.
  }
}

let overrides: Overrides = readOverrides();

/** The resolved bindings (defaults merged with overrides). */
const [resolved, setResolved] = createSignal<Record<CommandId, string | null>>(
  mergeBindings(DEFAULT_BINDINGS, overrides),
);

/** The raw overrides, so `isModified` stays reactive. */
const [overrideState, setOverrideState] = createSignal<Overrides>(overrides);

/** Replace the overrides, then refresh the resolved view and persist. */
function commit(next: Overrides): void {
  overrides = next;
  setOverrideState(next);
  setResolved(mergeBindings(DEFAULT_BINDINGS, next));
  writeOverrides(next);
}

/** An accessor for one command's current resolved binding. */
export function bindingFor(id: CommandId): Accessor<string | null> {
  return () => resolved()[id] ?? null;
}

/** One command's current resolved binding. */
export function getBinding(id: CommandId): string | null {
  return resolved()[id] ?? null;
}

/**
 * Rebind one command. The string is normalized first; an invalid chord is ignored, so a
 * rejected keystroke never destroys the current binding. `null` deliberately unbinds.
 */
export function setBinding(id: CommandId, binding: string | null): void {
  if (binding === null) {
    commit({ ...overrides, [id]: null });
    return;
  }
  const normalized = normalizeBinding(binding);
  if (normalized === null) return;
  commit({ ...overrides, [id]: normalized });
}

/** Drop one command's override, restoring its default. */
export function resetBinding(id: CommandId): void {
  const next = { ...overrides };
  delete next[id];
  commit(next);
}

/** Drop every override, restoring the whole default table. */
export function resetAllBindings(): void {
  commit({});
}

/** Whether this command has an override (i.e. it differs from the default table). */
export function isModified(id: CommandId): boolean {
  return Object.prototype.hasOwnProperty.call(overrideState(), id);
}

/** The whole resolved binding table. */
export function allResolvedBindings(): Record<CommandId, string | null> {
  return resolved();
}

/** Re-read the overrides and refresh, e.g. after another window rebinds. */
function syncFromStorage(): void {
  overrides = readOverrides();
  setOverrideState(overrides);
  setResolved(mergeBindings(DEFAULT_BINDINGS, overrides));
}

// One listener for the app's life: a second project window (or a popout) rebinds live.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === BINDINGS_STORAGE_KEY) syncFromStorage();
  });
}
