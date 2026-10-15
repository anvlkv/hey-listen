import type { NodeKindDef } from "../types";

/** Node kinds: modulation. */
export const MODULATION: NodeKindDef[] = [
  {
    kind: "chorus",
    label: "Chorus",
    category: "modulation",
    inputs: 1,
    outputs: 1,
    params: [
      {
        key: "separation",
        label: "Spread",
        default: 0.015,
        min: 0.001,
        max: 0.05,
        step: 0.001,
        unit: "s",
      },
      {
        key: "variation",
        label: "Depth",
        default: 0.005,
        min: 0.0005,
        max: 0.02,
        step: 0.0005,
        unit: "s",
      },
      { key: "rate", label: "Rate", default: 0.5, min: 0.05, max: 8, step: 0.05, unit: "Hz" },
    ],
    hint: "Thickens the signal with several short, modulated delay copies.",
  },
  {
    kind: "flanger",
    label: "Flanger",
    category: "modulation",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "feedback", label: "Feedback", default: 0.5, min: -0.95, max: 0.95, step: 0.05 },
      {
        key: "min_delay",
        label: "Min",
        default: 0.005,
        min: 0.0005,
        max: 0.05,
        step: 0.0005,
        unit: "s",
      },
      {
        key: "max_delay",
        label: "Max",
        default: 0.01,
        min: 0.001,
        max: 0.05,
        step: 0.0005,
        unit: "s",
      },
      { key: "rate", label: "Rate", default: 0.1, min: 0.02, max: 5, step: 0.02, unit: "Hz" },
    ],
    hint: "A short, swept delay creating a whooshing comb-filter (jet) effect.",
  },
  {
    kind: "phaser",
    label: "Phaser",
    category: "modulation",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "feedback", label: "Feedback", default: 0.5, min: -0.95, max: 0.95, step: 0.05 },
      { key: "rate", label: "Rate", default: 0.1, min: 0.02, max: 5, step: 0.02, unit: "Hz" },
    ],
    hint: "A swept all-pass cascade creating a notchy phase (swoosh) effect.",
  },
  // Reverb. fundsp's full reverbs are stereo-only (2 in / 2 out) and cannot compile
  // under the mono net, so only its mono all-pass diffusion element is offered here.
];
