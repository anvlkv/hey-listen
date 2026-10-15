import type { NodeKindDef } from "../types";

/** Node kinds: dynamics. */
export const DYNAMICS: NodeKindDef[] = [
  {
    kind: "limiter",
    label: "Limiter",
    category: "dynamics",
    inputs: 1,
    outputs: 1,
    params: [
      {
        key: "attack",
        label: "Attack",
        default: 0.005,
        min: 0.001,
        max: 0.1,
        step: 0.001,
        unit: "s",
      },
      { key: "release", label: "Release", default: 0.1, min: 0.01, max: 1, step: 0.01, unit: "s" },
    ],
    hint: "Prevents the signal from exceeding full scale (look-ahead limiter).",
  },
  {
    kind: "limiter_stereo",
    label: "Limiter (stereo)",
    category: "dynamics",
    inputs: 2,
    outputs: 2,
    params: [
      {
        key: "attack",
        label: "Attack",
        default: 0.005,
        min: 0.001,
        max: 0.1,
        step: 0.001,
        unit: "s",
      },
      { key: "release", label: "Release", default: 0.1, min: 0.01, max: 1, step: 0.01, unit: "s" },
    ],
    hint: "Stereo look-ahead limiter — holds both channels within full scale.",
  },
  {
    kind: "compressor",
    label: "Compressor",
    category: "dynamics",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "threshold", label: "Thresh", default: -18, min: -60, max: 0, step: 0.5, unit: "dB" },
      { key: "ratio", label: "Ratio", default: 4, min: 1, max: 20, step: 0.1 },
      {
        key: "attack",
        label: "Attack",
        default: 0.01,
        min: 0.0005,
        max: 0.5,
        step: 0.001,
        unit: "s",
      },
      { key: "release", label: "Release", default: 0.1, min: 0.01, max: 2, step: 0.01, unit: "s" },
    ],
    hint: "Reduces dynamic range: quietens peaks that rise above the threshold.",
  },
  {
    kind: "gate",
    label: "Noise gate",
    category: "dynamics",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "threshold", label: "Thresh", default: -40, min: -80, max: 0, step: 0.5, unit: "dB" },
      {
        key: "attack",
        label: "Attack",
        default: 0.002,
        min: 0.0005,
        max: 0.1,
        step: 0.0005,
        unit: "s",
      },
      { key: "release", label: "Release", default: 0.05, min: 0.01, max: 1, step: 0.01, unit: "s" },
    ],
    hint: "Mutes the signal when it falls below a threshold (downward expander).",
  },
  // Modulation.
];
