import type { NodeKindDef } from "../types";
import { secondsParam } from "../params";

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
  // Envelope/gate and delay-as-signal nodes: they take their control on input 1.
  {
    kind: "follow",
    label: "Follow",
    category: "control",
    inputs: 1,
    outputs: 1,
    params: [secondsParam("time", "Response", 0.05, 0.001, 1)],
    hint: "Follows the signal with a one-pole smoother, gliding sudden jumps.",
  },
  {
    kind: "afollow",
    label: "Follow (attack/release)",
    category: "control",
    inputs: 1,
    outputs: 1,
    params: [
      secondsParam("attack", "Attack", 0.01, 0.001, 1),
      secondsParam("release", "Release", 0.1, 0.001, 1),
    ],
    hint: "Follows the signal with separate rise (attack) and fall (release) times.",
  },
  {
    kind: "hold",
    label: "Hold",
    category: "control",
    inputs: 2,
    outputs: 1,
    params: [
      { key: "variability", label: "Variability", default: 0.1, min: 0, max: 1, step: 0.01 },
    ],
    hint: "Sample-and-hold the signal; input 1 = trigger signal (hold rate in Hz).",
  },
  {
    kind: "tap",
    label: "Tap delay (cv)",
    category: "control",
    inputs: 2,
    outputs: 1,
    params: [secondsParam("min", "Min", 0, 0, 5), secondsParam("max", "Max", 1, 0, 5)],
    hint: "Variable delay; input 1 = delay signal in seconds (clamped to min..max).",
  },
  // Generators (synth graphs).
];
