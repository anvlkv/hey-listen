import { createStore } from "solid-js/store";
import { ANALYZERS } from "./defs";
import { analyzerById } from "./lookup";
import type { AnalyzerId } from "./types";

type ToolOptionsState = Record<string, Record<string, number>>;

/**
 * Canonical engine option keys — the camelCase names `ToolOptions` accepts in
 * `src-tauri/src/audio/analysis/types.rs`. Keep this list in step with that struct
 * and the Rust catalog's option metadata.
 */
const ENGINE_KEYS = [
  "nMels",
  "nMfcc",
  "nBands",
  "rolloffPercent",
  "yinThreshold",
  "minF0Hz",
  "maxF0Hz",
  "barLength",
  "windowMs",
  "fMinHz",
  "fMaxHz",
  "frameMs",
  "hopMs",
  "gateDb",
  "gateFloorDb",
  "hysteresisDb",
  "minNoteMs",
  "minGapMs",
  "envelopePoints",
  "pitchFrameMs",
  "pitchHopMs",
  "modMinHz",
  "modMaxHz",
  "detrend",
  "minVoicedSecs",
  "topPeaks",
] as const;

/** snake_case aliases accepted at the MCP / CLI boundary (mirrors the Rust side). */
const OPTION_ALIASES: Record<string, string> = {
  n_mels: "nMels",
  n_mfcc: "nMfcc",
  n_bands: "nBands",
  rolloff_percent: "rolloffPercent",
  yin_threshold: "yinThreshold",
  min_f0_hz: "minF0Hz",
  max_f0_hz: "maxF0Hz",
  bar_length: "barLength",
  window_ms: "windowMs",
  f_min_hz: "fMinHz",
  f_max_hz: "fMaxHz",
  frame_ms: "frameMs",
  hop_ms: "hopMs",
  gate_db: "gateDb",
  gate_floor_db: "gateFloorDb",
  hysteresis_db: "hysteresisDb",
  min_note_ms: "minNoteMs",
  min_gap_ms: "minGapMs",
  envelope_points: "envelopePoints",
  pitch_frame_ms: "pitchFrameMs",
  pitch_hop_ms: "pitchHopMs",
  mod_min_hz: "modMinHz",
  mod_max_hz: "modMaxHz",
  min_voiced_secs: "minVoicedSecs",
  top_peaks: "topPeaks",
};

const ENGINE_KEY_SET = new Set<string>(ENGINE_KEYS);

/** Resolve a canonical camelCase engine key, accepting its snake_case alias. */
function canonicalKey(key: string): string | null {
  const canonical = OPTION_ALIASES[key] ?? key;
  return ENGINE_KEY_SET.has(canonical) ? canonical : null;
}

function initialToolOptions(): ToolOptionsState {
  const state: ToolOptionsState = {};
  for (const def of ANALYZERS) {
    const values: Record<string, number> = {};
    for (const field of def.params ?? []) values[field.key] = field.value;
    state[def.id] = values;
  }
  return state;
}

/** Per-tool option values (not shared across tools), keyed by tool id then param. */
export const [toolOptions, setToolOptions] = createStore<ToolOptionsState>(initialToolOptions());

export function setToolOption(id: AnalyzerId, key: string, value: number) {
  setToolOptions(id, key, value);
}

/** Reset every per-tool option to its default (New Project). */
export function resetToolOptions() {
  setToolOptions(initialToolOptions());
}

/**
 * Validate and canonicalize a per-tool option patch from MCP: keys must be an engine
 * option or a param the tool declares, and values must be finite numbers. Unknown
 * keys fail loudly instead of being accepted and silently ignored (M16).
 */
export function applyOptionPatch(
  id: AnalyzerId,
  patch: Record<string, unknown>,
): Record<string, number> {
  const declared = new Set((analyzerById(id).params ?? []).map((field) => field.key));
  const out: Record<string, number> = {};
  for (const [rawKey, value] of Object.entries(patch)) {
    const key = canonicalKey(rawKey);
    if (key == null && !declared.has(rawKey)) {
      throw new Error(`unknown option for ${id}: ${rawKey}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`option ${rawKey} for ${id} must be a number`);
    }
    out[key ?? rawKey] = value;
  }
  return out;
}

/**
 * The engine option values to send with `run_analysis`: the canonical engine keys a
 * tool's store holds, with chart-display toggles (`target: "view"`) and anything
 * unknown stripped. The engine rejects unknown keys, so this boundary filter is what
 * keeps the store's display state from reaching Rust. Only engine values are read, so
 * flipping a display toggle does not re-run the analysis.
 */
export function engineOptions(
  id: AnalyzerId,
  values: Record<string, number> = toolOptions[id] ?? {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(values)) {
    const canonical = canonicalKey(key);
    if (canonical != null) out[canonical] = values[key];
  }
  return out;
}

/** A tool's engine option defaults — the compact `list_analyzers` option map. */

/**
 * Restore the per-tool store from a saved project, filling in each tool's declared
 * defaults for keys the file predates (M16 added the pitch f0 options). Unknown tool
 * ids / keys are kept so a round-trip through a newer file does not lose them.
 */
export function optionDefaults(id: AnalyzerId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of analyzerById(id).params ?? []) {
    if (field.target !== "view") out[field.key] = field.value;
  }
  return out;
}

export function loadToolOptions(loaded: ToolOptionsState) {
  const defaults = initialToolOptions();
  const next: ToolOptionsState = {};
  for (const def of ANALYZERS) {
    next[def.id] = { ...defaults[def.id], ...(loaded[def.id] ?? {}) };
  }
  for (const [id, values] of Object.entries(loaded)) {
    next[id] = { ...(next[id] ?? {}), ...values };
  }
  setToolOptions(next);
}
