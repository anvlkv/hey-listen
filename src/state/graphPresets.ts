import { createStore } from "solid-js/store";
import { nodeKind, type GraphKind } from "../lib/graph";
import { updateParam } from "./graph";

/**
 * Session-scoped named parameter presets for the graph editors (D-16).
 *
 * Presets are keyed by node **kind**, so one saved on a kind in the filter graph is
 * offered on the same kind in the synth graph. They live in memory only — closing the
 * app forgets them, and the project file carries no preset data.
 */
export interface GraphPreset {
  id: string;
  /** The kind whose parameters the values belong to. */
  kind: string;
  name: string;
  values: Record<string, number>;
}

let nextId = 1;

const [presets, setPresets] = createStore<GraphPreset[]>([]);

/** The presets of one node kind, in save order. */
export function presetsFor(kind: string): GraphPreset[] {
  return presets.filter((preset) => preset.kind === kind);
}

/** Capture a node's `values` under `name` for `kind`; a same-named preset is replaced. */
export function savePreset(
  kind: string,
  name: string,
  values: Record<string, number>,
): GraphPreset {
  const def = nodeKind(kind);
  const snapshot: Record<string, number> = {};
  for (const param of def?.params ?? []) {
    const current = values[param.key];
    snapshot[param.key] = Number.isFinite(current) ? current : param.default;
  }
  const existing = presets.find((preset) => preset.kind === kind && preset.name === name);
  if (existing) {
    setPresets((preset) => preset.id === existing.id, "values", snapshot);
    return { ...existing, values: snapshot };
  }
  const preset: GraphPreset = { id: `preset-${nextId++}`, kind, name, values: snapshot };
  setPresets((all) => [...all, preset]);
  return preset;
}

/** Apply a preset to a node, clamped to each parameter's declared range. */
export function applyPreset(graph: GraphKind, nodeId: string, preset: GraphPreset): void {
  const def = nodeKind(preset.kind);
  if (!def) return;
  for (const param of def.params) {
    const value = preset.values[param.key];
    if (!Number.isFinite(value)) continue;
    updateParam(graph, nodeId, param.key, Math.min(param.max, Math.max(param.min, value)));
  }
}

export function deletePreset(id: string): void {
  setPresets((all) => all.filter((preset) => preset.id !== id));
}
