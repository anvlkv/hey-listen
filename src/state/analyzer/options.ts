import { createStore } from "solid-js/store";
import { ANALYZERS } from "./defs";
import type { AnalyzerId } from "./types";

type ToolOptionsState = Record<string, Record<string, number>>;

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
