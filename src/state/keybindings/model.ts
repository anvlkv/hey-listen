import type { CommandId } from "./types";

/**
 * The pure persistence model for bindings ([`hotkeys.md`](../../../docs/hotkeys.md) →
 * "Persistence"). Bindings are app-level chrome, stored in `localStorage` — never in the
 * project file — as a versioned overrides map:
 *
 * ```json
 * { "version": 1, "bindings": { "transport.playPause": "Space" } }
 * ```
 *
 * Only overrides are stored; a missing command id falls back to its default, and `null`
 * is a deliberate unbind. This module is node-safe: the reactive store owns the
 * `localStorage` access.
 */

/** Schema version of the stored document. */
export const BINDINGS_VERSION = 1;

/** The `localStorage` key holding the overrides document. */
export const BINDINGS_STORAGE_KEY = "hey-listen:keybindings";

/** The stored document. */
export interface StoredBindings {
  version: number;
  bindings: Record<string, string | null>;
}

/**
 * Resolve every known command: an override wins, a missing/invalid one falls back to the
 * default. Ids not in `defaults` are dropped.
 */
export function mergeBindings(
  defaults: Record<CommandId, string | null>,
  overrides: Record<string, string | null>,
): Record<CommandId, string | null> {
  const resolved: Record<string, string | null> = {};
  for (const [id, fallback] of Object.entries(defaults)) {
    const override = Object.prototype.hasOwnProperty.call(overrides, id)
      ? overrides[id]
      : undefined;
    resolved[id] = typeof override === "string" || override === null ? override : fallback;
  }
  return resolved as Record<CommandId, string | null>;
}

/** A plain object with string keys (not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the overrides map out of raw storage. Missing or malformed input yields `{}`; only
 * string and `null` values survive (anything else is dropped).
 */
export function parseStored(raw: string | null): Record<string, string | null> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed) || !isRecord(parsed.bindings)) return {};

  const overrides: Record<string, string | null> = {};
  for (const [id, value] of Object.entries(parsed.bindings)) {
    if (typeof value === "string" || value === null) overrides[id] = value;
  }
  return overrides;
}

/** Serialize the overrides map into the versioned document. */
export function serializeStored(overrides: Record<string, string | null>): string {
  const stored: StoredBindings = { version: BINDINGS_VERSION, bindings: overrides };
  return JSON.stringify(stored);
}
