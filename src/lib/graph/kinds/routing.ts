import type { NodeKindDef } from "../types";

/** Node kinds: io, mixer. */
export const ROUTING: NodeKindDef[] = [
  {
    kind: "input",
    label: "Input",
    category: "io",
    inputs: 0,
    outputs: 1,
    params: [],
    filterOnly: true,
    hint: "Where the mono signal enters the filter graph.",
  },
  {
    kind: "output",
    label: "Output",
    category: "io",
    inputs: 1,
    outputs: 0,
    params: [],
    hint: "Where the graph's mono result is read.",
  },
  // Mixer / routing.
  {
    kind: "mix",
    label: "Mix",
    category: "mixer",
    inputs: 2,
    outputs: 1,
    params: [],
    hint: "Sums two signals into one.",
  },
  {
    kind: "split",
    label: "Split",
    category: "mixer",
    inputs: 1,
    outputs: 2,
    params: [],
    hint: "Copies a mono signal into two identical channels.",
  },
  {
    kind: "join",
    label: "Join",
    category: "mixer",
    inputs: 2,
    outputs: 1,
    params: [],
    hint: "Averages two channels back into one — use after stereo processing.",
  },
  // Math: combine or reshape signals (A op B for the binary nodes).
];
