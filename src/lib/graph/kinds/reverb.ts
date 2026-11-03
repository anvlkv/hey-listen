import type { NodeKindDef, ParamDef } from "../types";
import { timeParam } from "../params";

/** A stereo reverb's room size, in metres. */
const room = (minimum = 10): ParamDef => ({
  key: "room",
  label: "Room",
  default: minimum,
  min: minimum,
  max: 30,
  step: 0.5,
  unit: "m",
});

/** A reverb's decay time, in seconds. */
const decay = (): ParamDef => ({
  key: "time",
  label: "Time",
  default: 2,
  min: 0.1,
  max: 20,
  step: 0.1,
  unit: "s",
});

/** A reverb mix control (`damping` or `diffusion`). */
const mix = (key: string, label: string): ParamDef => ({
  key,
  label,
  default: 0.5,
  min: 0,
  max: 1,
  step: 0.01,
});

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
    params: [room(), decay(), mix("damping", "Damping")],
    hint: "Stereo room reverb (32-channel FDN) — inputs: left, right; outputs: left, right.",
  },
  {
    kind: "reverb2_stereo",
    label: "Reverb 2 (hq)",
    category: "reverb",
    inputs: 2,
    outputs: 2,
    params: [
      room(),
      decay(),
      mix("diffusion", "Diffusion"),
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
      decay(),
      mix("diffusion", "Diffusion"),
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
    params: [room(15), decay()],
    hint: "Stereo reverb with a slow fade-in envelope — inputs: left, right.",
  },
  // Control sources (usable in either graph).
];
