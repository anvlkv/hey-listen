import type { ToolParamField } from "../types";

/**
 * The optional window gate shared by the gated scalar series (M21.B).
 *
 * `gateDb` is relative to the window's loudest frame: a frame quieter than that
 * becomes a gap, so a recording's pre-roll or background cannot drag a measurement.
 * `0` disables it, which is the default; `gateFloorDb` is an absolute dBFS floor.
 */
export const GATE_PARAMS: ToolParamField[] = [
  {
    key: "gateDb",
    label: "Gate",
    kind: "number",
    value: 0,
    min: 0,
    max: 120,
    step: 1,
    suffix: "dB",
    title:
      "0 disables gating. Above 0, frames quieter than this far below the window peak become gaps, so pre-roll and background do not skew the measurement.",
  },
  {
    key: "gateFloorDb",
    label: "Gate floor",
    kind: "number",
    value: -120,
    min: -120,
    max: 0,
    step: 1,
    suffix: "dBFS",
    title: "Absolute floor for that gate; frames quieter than this are always gaps.",
  },
];
