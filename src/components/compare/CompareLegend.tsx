import ChartLegend, { type ChartLegendEntry } from "../analyzer/chartLegend";
import { chartTheme } from "../../state/themes";
import { compareSideColor } from "./palette";

/**
 * The legend every compare chart shares (M23 Phase 3).
 *
 * It names the two sides in the same colours the header chip and the plotted series use
 * (`compareSideColor`), plus the Δ mark when the view draws one. A view that has
 * something extra to say passes it as the trailing `note` (the chart review's
 * convention, see [`ChartLegend`](../analyzer/chartLegend.tsx)).
 */
export default function CompareLegend(props: {
  /** Whether the view draws a Δ layer (line / heatmap / pairing). */
  delta?: boolean;
  /** The sides' project names. */
  aLabel?: string;
  bLabel?: string;
  note?: string;
}) {
  const entries = (): ChartLegendEntry[] => {
    const rows: ChartLegendEntry[] = [
      { label: `A · ${props.aLabel ?? "this project"}`, color: compareSideColor(0) },
      { label: `B · ${props.bLabel ?? "reference"}`, color: compareSideColor(1) },
    ];
    if (props.delta) {
      rows.push({ label: "Δ (B − A)", color: chartTheme().compareDelta, kind: "dashed" });
    }
    return rows;
  };

  return <ChartLegend entries={entries()} note={props.note} />;
}
