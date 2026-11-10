import { For, Show } from "solid-js";

/** One entry in a [`ChartLegend`]: the label and the mark as the chart draws it. */
export interface ChartLegendEntry {
  label: string;
  /** The mark's colour — a `chartTheme()` role, never a literal. */
  color: string;
  /** The mark's shape: a line (default), a dashed line, a filled band, or a two-tone split. */
  kind?: "line" | "dashed" | "fill" | "split";
  /** An optional live value (e.g. what the series reads under the cursor). */
  value?: string | null;
}

/**
 * The compact series legend shared by the analyzer charts (M36).
 *
 * The wrapper disables uPlot's native legend, so every chart used to hand-roll its own
 * swatches. This is the one legend: a single wrapping row along the chart's **bottom
 * edge** (the chart review's chrome convention), so it scales to many series and can
 * never cover the data. Chart colours come from `chartTheme()`, so a series colour always
 * maps to the same labelled mark. See `docs/chart-review/chart-recommendations.md` item 13.
 */
export default function ChartLegend(props: {
  entries: ChartLegendEntry[];
  /** A trailing fact about the whole chart (a gate, a unit, the axis mode). */
  note?: string;
}) {
  return (
    <div class="chart-legend">
      <For each={props.entries}>
        {(entry) => (
          <span class="chart-legend-item">
            <span
              class={`chart-legend-mark is-${entry.kind ?? "line"}`}
              style={{ "--legend-color": entry.color }}
            >
              <Show when={(entry.kind ?? "line") === "split"}>
                <i />
                <i />
              </Show>
            </span>
            {entry.label}
            <Show when={entry.value}>
              <span class="chart-legend-value">{entry.value}</span>
            </Show>
          </span>
        )}
      </For>
      <Show when={props.note}>
        <span class="chart-legend-note">{props.note}</span>
      </Show>
    </div>
  );
}
