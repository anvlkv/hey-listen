import { chartTheme } from "../../state/themes";

/**
 * Comparison side colours (M23 Phase 3).
 *
 * A side maps to **one** colour everywhere — the header chip, the chart legend and the
 * chart series — so the same pair always reads the same way. The theme owns the palette
 * (`ChartTheme.comparePalette`); `compareA` / `compareB` remain its first two entries for
 * the existing chart code.
 */

/** The colour for the `index`th displayed side: A = 0, B = 1, … */
export function compareSideColor(index: number): string {
  const theme = chartTheme();
  return theme.comparePalette[index] ?? theme.compareDelta;
}
