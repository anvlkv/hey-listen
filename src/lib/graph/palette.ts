import type { GraphKind, NodeKindDef } from "./types";
import { NODE_KINDS } from "./kinds";

const KIND_BY_ID = new Map(NODE_KINDS.map((def) => [def.kind, def]));

export function nodeKind(kind: string): NodeKindDef | undefined {
  return KIND_BY_ID.get(kind);
}

const CATEGORY_LABELS: Record<string, string> = {
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
};

/** The palette for a graph kind, grouped for display. */
export function paletteFor(graph: GraphKind): { category: string; kinds: NodeKindDef[] }[] {
  const order = [
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
  ];
  return order
    .map((category) => ({
      category: CATEGORY_LABELS[category],
      kinds: NODE_KINDS.filter(
        (def) =>
          def.category === category && (graph === "filter" ? !def.synthOnly : !def.filterOnly),
      ),
    }))
    .filter((group) => group.kinds.length > 0);
}

/** Default parameter values for a kind, keyed by param name. */
export function defaultParams(def: NodeKindDef): Record<string, number> {
  return Object.fromEntries(def.params.map((param) => [param.key, param.default]));
}
