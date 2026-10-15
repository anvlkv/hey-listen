import type { NodeKindDef } from "../types";

/** Node kinds: control. */
export const CONTROL: NodeKindDef[] = [
  {
    kind: "dc",
    label: "Constant",
    category: "control",
    inputs: 0,
    outputs: 1,
    params: [{ key: "value", label: "Value", default: 1, min: -1, max: 1, step: 0.01 }],
    hint: "A constant value (DC) — used to set control inputs.",
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
    hint: "A slow sine oscillator for modulating parameters.",
  },
  // Generators (synth graphs).
];
