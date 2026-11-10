/**
 * Band-row labelling for the canvas heatmaps (M36).
 *
 * A matrix has anywhere from 12 rows (a chromagram) to 128 (mel), so a fixed
 * five-row loop either over-labels a chromagram or leaves a 64-band map unexplained.
 * These helpers pick the rows from the plot's height, format a row's real band range,
 * and shrink a label that would overflow the left margin.
 */

/** Minimum vertical spacing between two band labels, in CSS px. */
const BAND_LABEL_GAP = 15;
/** A tighter spacing for a descriptor that asks to name every row (a chromagram). */
const BAND_LABEL_GAP_DENSE = 11;

/**
 * The bottom-up band rows to label in a plot `height` px tall.
 *
 * Every row is labelled when they all fit; otherwise a stride is chosen so the labels
 * are at least [`BAND_LABEL_GAP`] apart, and the top row is kept (it is the one a
 * reader reconciles with the axis). `everyBand` relaxes the spacing for a small,
 * semantically named axis (twelve pitch classes).
 */
export function bandLabelRows(bins: number, height: number, everyBand = false): number[] {
  if (bins <= 0 || !(height > 0)) return [];
  const gap = everyBand ? BAND_LABEL_GAP_DENSE : BAND_LABEL_GAP;
  const capacity = Math.max(2, Math.floor(height / gap));
  if (bins <= capacity) return Array.from({ length: bins }, (_, row) => row);
  const step = Math.ceil((bins - 1) / (capacity - 1));
  const rows: number[] = [];
  for (let row = 0; row < bins; row += step) rows.push(row);
  const top = bins - 1;
  const last = rows[rows.length - 1];
  if (last !== top) {
    // Drop the last stride label when it would crowd the top row.
    if (top - last < step * 0.6) rows.pop();
    rows.push(top);
  }
  return rows;
}

/** A compact `lo–hi` frequency range (`0–200 Hz`, `0.8–1.6 kHz`) for a band label. */
export function formatBandRange(lo: number, hi: number): string {
  const kHz = Math.max(Math.abs(lo), Math.abs(hi)) >= 1000;
  const scale = kHz ? 1000 : 1;
  const digits = (value: number) => {
    const scaled = value / scale;
    return Math.abs(scaled) >= 100 || Number.isInteger(scaled)
      ? scaled.toFixed(0)
      : scaled.toFixed(1);
  };
  return `${digits(lo)}–${digits(hi)} ${kHz ? "kHz" : "Hz"}`;
}

/** `text`, truncated with an ellipsis when it is wider than `maxWidth`. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut--;
  return `${text.slice(0, cut)}…`;
}
