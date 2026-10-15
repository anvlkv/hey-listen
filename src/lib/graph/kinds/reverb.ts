import type { NodeKindDef } from "../types";
import { timeParam } from "../params";

/** Node kinds: reverb. */
export const REVERB: NodeKindDef[] = [
  {
    kind: "schroeder",
    label: "Schroeder",
    category: "reverb",
    inputs: 1,
    outputs: 1,
    params: [
      { key: "coefficient", label: "Coef", default: 0.5, min: -0.95, max: 0.95, step: 0.05 },
      timeParam(),
    ],
    hint: "An all-pass diffusion element (Schroeder all-pass); stack several to build a reverb.",
  },
  {
    kind: "schroeder_cv",
    label: "Schroeder (cv)",
    category: "reverb",
    inputs: 2,
    outputs: 1,
    params: [timeParam()],
    hint: "Schroeder all-pass with a control-driven coefficient — inputs: audio, coefficient.",
  },
  // Full stereo reverbs (2 in / 2 out): pair with `split`/`join` to fit the mono
  // pipeline. fundsp's high-quality reverbs take a loop-filter node from positional
  // params (its cutoff frequency).
  {
    kind: "reverb_stereo",
    label: "Reverb",
    category: "reverb",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "room", label: "Room", default: 10, min: 10, max: 30, step: 0.5, unit: "m" },
      { key: "time", label: "Time", default: 2, min: 0.1, max: 20, step: 0.1, unit: "s" },
      { key: "damping", label: "Damping", default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    hint: "Stereo room reverb (32-channel FDN) — inputs: left, right; outputs: left, right.",
  },
  {
    kind: "reverb2_stereo",
    label: "Reverb 2 (hq)",
    category: "reverb",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "room", label: "Room", default: 10, min: 10, max: 30, step: 0.5, unit: "m" },
      { key: "time", label: "Time", default: 2, min: 0.1, max: 20, step: 0.1, unit: "s" },
      { key: "diffusion", label: "Diffusion", default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: "mod_speed", label: "Mod", default: 1, min: 0, max: 2, step: 0.01 },
      {
        key: "loop_filter",
        label: "Loop filter",
        default: 8_000,
        min: 100,
        max: 20_000,
        step: 100,
        unit: "Hz",
      },
    ],
    hint: "High-quality stereo reverb with a damped feedback loop — inputs: left, right.",
  },
  {
    kind: "reverb3_stereo",
    label: "Reverb 3",
    category: "reverb",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "time", label: "Time", default: 2, min: 0.1, max: 20, step: 0.1, unit: "s" },
      { key: "diffusion", label: "Diffusion", default: 0.5, min: 0, max: 1, step: 0.01 },
      {
        key: "loop_filter",
        label: "Loop filter",
        default: 8_000,
        min: 100,
        max: 20_000,
        step: 100,
        unit: "Hz",
      },
    ],
    hint: "All-pass-loop stereo reverb — inputs: left, right; outputs: left, right.",
  },
  {
    kind: "reverb4_stereo",
    label: "Reverb 4 (fade)",
    category: "reverb",
    inputs: 2,
    outputs: 2,
    params: [
      { key: "room", label: "Room", default: 15, min: 15, max: 30, step: 0.5, unit: "m" },
      { key: "time", label: "Time", default: 2, min: 0.1, max: 20, step: 0.1, unit: "s" },
    ],
    hint: "Stereo reverb with a slow fade-in envelope — inputs: left, right.",
  },
  // Control sources (usable in either graph).
];
