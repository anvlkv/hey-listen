import type { GraphScope, NodeCategory, NodeDef, NodeKindDef } from "./types";
import catalog from "../../bindings/nodeCatalog.json";

/**
 * The node palette, generated from the one Rust table in
 * `src-tauri/src/audio/graph/nodes` (`cargo test` writes `src/bindings/nodeCatalog.json`).
 * Do not hand-edit it: add a kind in Rust and regenerate.
 */
export const NODE_KINDS = catalog as NodeDef[];

const KIND_BY_ID = new Map(NODE_KINDS.map((def) => [def.kind, def]));

export function nodeKind(kind: string): NodeKindDef | undefined {
  return KIND_BY_ID.get(kind);
}

/** Whether a kind wraps an inner graph (edited in its own subsystem tab). */
export function isSubsystemKind(kind: string | undefined): boolean {
  return !!kind && nodeKind(kind)?.subsystem === true;
}

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  io: "Graph",
  generator: "Generators",
  mixer: "Routing",
  math: "Math",
  processor: "Filters",
  filtercv: "Filters (control)",
  dynamics: "Dynamics",
  modulation: "Modulation",
  reverb: "Reverb",
  control: "Control",
  subsystem: "Subsystems",
};

const CATEGORY_ORDER: NodeCategory[] = [
  "io",
  "generator",
  "mixer",
  "math",
  "processor",
  "filtercv",
  "dynamics",
  "modulation",
  "reverb",
  "control",
  "subsystem",
];

/**
 * The palette for a graph scope, grouped for display. A subsystem may hold both
 * generators and an `input`, so it sees the whole catalog.
 */
export function paletteFor(scope: GraphScope): { category: string; kinds: NodeKindDef[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category: CATEGORY_LABELS[category],
    kinds: NODE_KINDS.filter((def) => {
      if (scope === "filter") return !def.synthOnly;
      if (scope === "synth") return !def.filterOnly;
      return true;
    }).filter((def) => def.category === category),
  })).filter((group) => group.kinds.length > 0);
}

/** Default parameter values for a kind, keyed by param name. */
export function defaultParams(def: NodeKindDef): Record<string, number> {
  return Object.fromEntries(def.params.map((param) => [param.key, param.default]));
}

/** The port's label from the catalog (the same names DOT writes). */
export function portLabel(kind: string | undefined, side: "in" | "out", index: number): string {
  const def = kind ? nodeKind(kind) : undefined;
  const ports = side === "in" ? def?.inputPorts : def?.outputPorts;
  if (ports?.[index]) return ports[index];
  return side === "in" ? "in" : "out";
}
