import ChartLegend, { type ChartLegendEntry } from "../analyzer/chartLegend";
import { chartTheme } from "../../state/themes";
import { compareSideColor } from "./palette";

/**
 * The legend every compare chart shares (M23 Phase 3).
 *
 * It names the displayed sides in the same colours the header chip and the plotted
 * series use (`compareSideColor`), plus the Δ mark when the view draws one. A view that
 * has something extra to say passes it as the trailing `note` (the chart review's
 * convention, see [`ChartLegend`](../analyzer/chartLegend.tsx)).
 */
export default function CompareLegend(props: {
  swapped: boolean;
  /** Whether the view draws a Δ layer (line / heatmap / pairing). */
  delta?: boolean;
  /** The displayed sides' project names. */
  aLabel?: string;
  bLabel?: string;
  note?: string;
}) {
  const entries = (): ChartLegendEntry[] => {
    // Colour 0 is the **displayed** A side and colour 1 the displayed B side; after a
    // swap those are the reference and the owner, so the letter follows `swapped`
    // exactly as the chart series labels do.
    const first = `${props.swapped ? "B" : "A"} · ${props.aLabel ?? "this project"}`;
    const second = `${props.swapped ? "A" : "B"} · ${props.bLabel ?? "reference"}`;
    const rows: ChartLegendEntry[] = [
      { label: first, color: compareSideColor(0) },
      { label: second, color: compareSideColor(1) },
    ];
    if (props.delta) {
      rows.push({
        label: props.swapped ? "Δ (A − B)" : "Δ (B − A)",
        color: chartTheme().compareDelta,
        kind: "dashed",
      });
    }
    return rows;
  };

  return <ChartLegend entries={entries()} note={props.note} />;
}
