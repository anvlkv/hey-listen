import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { Show } from "solid-js";
import { mirrorCursor, syncView } from "./syncPlugins";
import { referenceLine } from "./seriesPlugins";
import {
  FREQ_AXIS_SPACE,
  frequencyAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "./axisFormat";
import { chartAxisStyle, frequencyDbTooltip } from "./chartCommon";
import type { UplotZoom } from "./uplotZoom";
import { analyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";

/**
 * The SMR y-range always contains the 0 dB threshold, so "above / below the masking
 * threshold" is readable even when every bin sits on one side of it.
 */
function smrRange(_u: unknown, min: number, max: number): [number, number] {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const pad = Math.max((hi - lo) * 0.08, 0.5);
  return [lo - pad, hi + pad];
}

/**
 * The **signal-to-mask-ratio panel** of the masking view (M36).
 *
 * `SMR(i) = L(i) − Tg(i)` has a meaning of its own (dB above the estimated threshold),
 * so it gets its own aligned panel rather than sharing the level panel's y-scale with
 * the spectrum and `Tq`/`Tg` curves. A `0 dB` rule marks the threshold, and the panel
 * joins the `"freq"` sync group (`syncView` / `mirrorCursor`), so zoom and the cursor
 * stay locked to the level panel above it.
 */
export default function MaskingSmrPanel(props: {
  zoom: UplotZoom;
  freqs: number[];
  smrDb: number[];
}) {
  const data = (): uPlot.AlignedData => [
    props.freqs,
    props.smrDb.map((value) => (Number.isFinite(value) ? value : null)),
  ];

  return (
    <Show when={activeThemeId()} keyed>
      <SolidUplot
        autoResize
        pluginBus={analyzerBus}
        plugins={[
          cursor(),
          tooltip(frequencyDbTooltip(() => "linearHz")),
          mirrorCursor("freq"),
          syncView("freq"),
          referenceLine({ value: 0, label: "0 dB (threshold)" }),
        ]}
        onCreate={props.zoom.onReady}
        data={data()}
        series={[
          {},
          {
            label: "SMR",
            stroke: chartTheme().seriesMax,
            width: 1.25,
            fill: chartTheme().waveFill,
          },
        ]}
        scales={{ x: { time: false }, y: { range: smrRange } }}
        axes={[
          {
            ...chartAxisStyle(),
            label: "frequency (Hz)",
            size: X_AXIS_SIZE,
            space: FREQ_AXIS_SPACE,
            values: frequencyAxisValues,
          },
          {
            ...chartAxisStyle(),
            label: "SMR (dB)",
            size: Y_AXIS_SIZE,
            space: Y_AXIS_SPACE,
          },
        ]}
      />
    </Show>
  );
}
