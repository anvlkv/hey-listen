import { nodeKind } from "./palette";
import type { NodeKindDef } from "./types";

/**
 * The variadic table a node kind may carry (see Rust `NodeTable`): a `wave_synth`'s
 * harmonic rows, `amp` and `phase` per partial — as many rows as the user wants.
 *
 * Rows live on the editor node (`data.table`, row-major) and are appended after the
 * kind's named params when the graph crosses IPC, so `GraphNode.params` stays the flat
 * `Vec<f32>` the core reads.
 */

/** A kind's table definition, or `null` when it has none. */
export function tableDef(kind: string | undefined): NodeKindDef["table"] {
  const def = kind ? nodeKind(kind) : undefined;
  return def?.table ?? null;
}

/** The number of values per row (the column count). */
export function rowWidth(kind: string | undefined): number {
  return Math.max(1, tableDef(kind)?.columns.length ?? 1);
}

/** The rows a node starts from when it is created (row-major, a copy). */
export function defaultRows(kind: string | undefined): number[] {
  return [...(tableDef(kind)?.defaultRows ?? [])];
}

/** How many complete rows `rows` holds. */
export function rowCount(kind: string | undefined, rows: readonly number[]): number {
  return Math.floor(rows.length / rowWidth(kind));
}

/**
 * The cycle the rows describe, as `points` samples over one period, normalized to ±1
 * so it can be drawn. Row `n` is partial `n + 1`: `amp * sin(2π(n + 1)t + 2π·phase)`.
 */
export function waveCycle(rows: readonly number[], width: number, points = 96): number[] {
  const columns = Math.max(1, width);
  const values = Array.from({ length: points }, (_, index) => {
    const t = index / points;
    let sample = 0;
    for (let row = 0; row * columns < rows.length; row++) {
      const amp = rows[row * columns] ?? 0;
      const phase = rows[row * columns + 1] ?? 0;
      if (amp === 0) continue;
      sample += amp * Math.sin(2 * Math.PI * ((row + 1) * t + phase));
    }
    return sample;
  });
  const peak = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  return peak > 0 ? values.map((value) => value / peak) : values;
}

/** An SVG path for the cycle, in a `width × height` box. */
export function cyclePath(
  rows: readonly number[],
  columns: number,
  width = 120,
  height = 36,
): string {
  const cycle = waveCycle(rows, columns);
  const mid = height / 2;
  return cycle
    .map((value, index) => {
      const x = (index / Math.max(cycle.length - 1, 1)) * width;
      const y = mid - value * (mid - 1);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

/** A node's table rows: its own, or the kind's defaults when it has none yet. */
export function rowsOf(kind: string, stored: readonly number[] | undefined): number[] {
  const rows = stored && stored.length > 0 ? stored : defaultRows(kind);
  const width = rowWidth(kind);
  // Whole rows only: a truncated tail would desync the columns.
  return rows.slice(0, Math.floor(rows.length / width) * width);
}
