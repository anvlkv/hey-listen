/**
 * fundsp graph model shared by the filter and synth editors.
 *
 * The model mirrors fundsp's `Net`: nodes are pushed, then their **inputs** are
 * connected (each input takes exactly one source), and the graph's result is read
 * from the single **Output** node. The filter graph also has an **Input** node.
 *
 * The palette here must stay in sync with the Rust compiler
 * (`src-tauri/src/audio/graph.rs` → `make_unit` / `kind_arity`); the compiler rejects
 * unknown kinds and impossible wiring, so drift surfaces as a `graph-error`.
 */

/** A graph as it crosses IPC to the Rust core (camelCase keys). */
export interface GraphSpec {
  nodes: SpecNode[];
  edges: SpecEdge[];
}

export interface SpecNode {
  id: string;
  kind: string;
  params: number[];
}

export interface SpecEdge {
  from: string;
  fromPort: number;
  to: string;
  toPort: number;
}

/** The two graph editors (each its own Workbench tab). */
export type GraphKind = "filter" | "synth";

/** One editable numeric parameter of a node kind. */
export interface ParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

/** A node kind offered in the palette. */
export interface NodeKindDef {
  kind: string;
  label: string;
  category: "io" | "mixer" | "processor" | "control" | "generator";
  /** Visible input handles (one connection each). */
  inputs: number;
  outputs: number;
  params: ParamDef[];
  /** Only offered in filter graphs (the signal entry point). */
  filterOnly?: boolean;
  /** Only offered in synth graphs (sound generators). */
  synthOnly?: boolean;
}

function freqParam(defaultValue = 1_000): ParamDef {
  return {
    key: "freq",
    label: "Freq",
    default: defaultValue,
    min: 20,
    max: 20_000,
    step: 1,
    unit: "Hz",
  };
}

const Q_PARAM: ParamDef = { key: "q", label: "Q", default: 1, min: 0.1, max: 20, step: 0.1 };

/** Every node kind the editor can place. */
export const NODE_KINDS: NodeKindDef[] = [
  // Anchors. The filter graph's input; both graphs' output.
  {
    kind: "input",
    label: "Input",
    category: "io",
    inputs: 0,
    outputs: 1,
    params: [],
    filterOnly: true,
  },
  { kind: "output", label: "Output", category: "io", inputs: 1, outputs: 0, params: [] },
  // Mixer.
  { kind: "mix", label: "Mix", category: "mixer", inputs: 2, outputs: 1, params: [] },
  // Processors.
  {
    kind: "gain",
    label: "Gain",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [{ key: "gain", label: "Gain", default: 1, min: 0, max: 4, step: 0.05 }],
  },
  { kind: "lowpass", label: "Low-pass", category: "processor", inputs: 1, outputs: 1, params: [freqParam(), Q_PARAM] },
  { kind: "highpass", label: "High-pass", category: "processor", inputs: 1, outputs: 1, params: [freqParam(), Q_PARAM] },
  { kind: "bandpass", label: "Band-pass", category: "processor", inputs: 1, outputs: 1, params: [freqParam(), Q_PARAM] },
  { kind: "notch", label: "Notch", category: "processor", inputs: 1, outputs: 1, params: [freqParam(), Q_PARAM] },
  { kind: "peak", label: "Peak", category: "processor", inputs: 1, outputs: 1, params: [freqParam(), Q_PARAM] },
  { kind: "moog", label: "Moog", category: "processor", inputs: 1, outputs: 1, params: [freqParam(), Q_PARAM] },
  { kind: "butterpass", label: "Butterworth", category: "processor", inputs: 1, outputs: 1, params: [freqParam()] },
  { kind: "dcblock", label: "DC block", category: "processor", inputs: 1, outputs: 1, params: [] },
  {
    kind: "delay",
    label: "Delay",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [{ key: "time", label: "Time", default: 0.25, min: 0, max: 2, step: 0.01, unit: "s" }],
  },
  {
    kind: "limiter",
    label: "Limiter",
    category: "processor",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "attack", label: "Attack", default: 0.005, min: 0.001, max: 0.1, step: 0.001, unit: "s" },
      { key: "release", label: "Release", default: 0.1, min: 0.01, max: 1, step: 0.01, unit: "s" },
    ],
  },
  // Control sources (usable in either graph).
  {
    kind: "dc",
    label: "Constant",
    category: "control",
    inputs: 0,
    outputs: 1,
    params: [{ key: "value", label: "Value", default: 1, min: -1, max: 1, step: 0.01 }],
  },
  {
    kind: "sine_lfo",
    label: "Sine LFO",
    category: "control",
    inputs: 0,
    outputs: 1,
    params: [
      { key: "freq", label: "Rate", default: 1, min: 0.05, max: 20, step: 0.05, unit: "Hz" },
      { key: "amp", label: "Amount", default: 1, min: -2, max: 2, step: 0.01 },
      { key: "offset", label: "Offset", default: 0, min: -1, max: 1, step: 0.01 },
    ],
  },
  // Generators (synth graphs).
  { kind: "sine", label: "Sine", category: "generator", inputs: 0, outputs: 1, params: [freqParam(440)], synthOnly: true },
  { kind: "saw", label: "Saw", category: "generator", inputs: 0, outputs: 1, params: [freqParam(440)], synthOnly: true },
  { kind: "square", label: "Square", category: "generator", inputs: 0, outputs: 1, params: [freqParam(440)], synthOnly: true },
  { kind: "triangle", label: "Triangle", category: "generator", inputs: 0, outputs: 1, params: [freqParam(440)], synthOnly: true },
  { kind: "white", label: "White noise", category: "generator", inputs: 0, outputs: 1, params: [], synthOnly: true },
  { kind: "pink", label: "Pink noise", category: "generator", inputs: 0, outputs: 1, params: [], synthOnly: true },
];

const KIND_BY_ID = new Map(NODE_KINDS.map((def) => [def.kind, def]));

export function nodeKind(kind: string): NodeKindDef | undefined {
  return KIND_BY_ID.get(kind);
}

const CATEGORY_LABELS: Record<string, string> = {
  io: "Graph",
  mixer: "Routing",
  processor: "Filters",
  control: "Control",
  generator: "Generators",
};

/** The palette for a graph kind, grouped for display. */
export function paletteFor(graph: GraphKind): { category: string; kinds: NodeKindDef[] }[] {
  const order = ["io", "generator", "mixer", "processor", "control"];
  return order
    .map((category) => ({
      category: CATEGORY_LABELS[category],
      kinds: NODE_KINDS.filter(
        (def) =>
          def.category === category &&
          (graph === "filter" ? !def.synthOnly : !def.filterOnly),
      ),
    }))
    .filter((group) => group.kinds.length > 0);
}

/** Default parameter values for a kind, keyed by param name. */
export function defaultParams(def: NodeKindDef): Record<string, number> {
  return Object.fromEntries(def.params.map((param) => [param.key, param.default]));
}

/**
 * Minimal structural shape of an editor node/edge, so `toSpec` does not depend on
 * the solid-flow store types (avoids a cycle with `state/graph.ts`).
 */
export interface SpecInputNode {
  id: string;
  data: { kind: string; params: Record<string, number> };
}

export interface SpecInputEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** A handle id as a port index (`"0"`/`"1"` → 0/1; missing → 0). */
export function handlePort(handle: string | null | undefined): number {
  const port = Number(handle);
  return Number.isInteger(port) && port >= 0 ? port : 0;
}

/** Convert editor nodes/edges into the IPC graph spec (positional params). */
export function toSpec(
  nodes: readonly SpecInputNode[],
  edges: readonly SpecInputEdge[],
): GraphSpec {
  return {
    nodes: nodes.map((node) => {
      const def = nodeKind(node.data.kind);
      const params = def
        ? def.params.map((param) => node.data.params[param.key] ?? param.default)
        : [];
      return { id: node.id, kind: node.data.kind, params };
    }),
    edges: edges.map((edge) => ({
      from: edge.source,
      fromPort: handlePort(edge.sourceHandle),
      to: edge.target,
      toPort: handlePort(edge.targetHandle),
    })),
  };
}
