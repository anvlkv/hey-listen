import {
  FREQ_AXIS_SPACE,
  TIME_AXIS_SPACE,
  timeAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "../analyzer/axisFormat";
import { chartAxisStyle } from "../analyzer/chartCommon";

/**
 * The axis objects the compare charts share (M25.A). Each uPlot compare view repeats
 * the same time / amplitude axis pair; keeping the shapes here then also keeps the
 * "time (s)" label, tick format and spacing consistent across the families.
 */

/** The time x-axis. */
export function timeAxis() {
  return {
    ...chartAxisStyle(),
    label: "time (s)",
    size: X_AXIS_SIZE,
    space: TIME_AXIS_SPACE,
    values: timeAxisValues,
  };
}

/** A linear y-axis with a plain label. */
export function valueAxis(label: string) {
  return {
    ...chartAxisStyle(),
    label,
    size: Y_AXIS_SIZE,
    space: Y_AXIS_SPACE,
  };
}

/** A modulation-rate x-axis. */
export function rateAxis(label = "modulation rate (Hz)") {
  return {
    ...chartAxisStyle(),
    label,
    size: X_AXIS_SIZE,
    space: FREQ_AXIS_SPACE,
  };
}
