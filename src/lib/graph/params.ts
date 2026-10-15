import type { ParamDef } from "./types";

/** Parameter builders shared by the node-kind table. */
export function freqParam(defaultValue = 1_000): ParamDef {
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

export const Q_PARAM: ParamDef = { key: "q", label: "Q", default: 1, min: 0.1, max: 20, step: 0.1 };

/** Amplitude gain for shelf/bell filters (`1` is flat, `4` is +12 dB). */
export function gainParam(defaultValue = 1): ParamDef {
  return { key: "gain", label: "Gain", default: defaultValue, min: 0, max: 4, step: 0.05 };
}

/** Delay time in seconds. */
export function timeParam(defaultValue = 0.01, max = 0.2): ParamDef {
  return { key: "time", label: "Time", default: defaultValue, min: 0, max, step: 0.001, unit: "s" };
}

/** Pulse width in 0..1. */
export const WIDTH_PARAM: ParamDef = {
  key: "width",
  label: "Width",
  default: 0.5,
  min: 0.01,
  max: 0.99,
  step: 0.01,
};
