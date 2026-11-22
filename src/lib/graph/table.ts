import { nodeKind } from "./palette";
import type { NodeKindDef } from "./types";

/**
 * The variadic table a node kind may carry (see Rust `NodeTable`): a `wave_synth`'s
 * harmonic rows, or a `sequence`'s note rows — as many rows as the user wants.
 *
 * Rows live on the editor node (`data.table`, row-major) and are appended after the
 * kind's named params when the graph crosses IPC, so `GraphNode.params` stays the flat
 * `Vec<f32>` the core reads. Each column brings its own range (`NodeColumn`).
 */

/** How a table's rows are drawn: a waveform cycle, or a piano roll of notes. */
export type TableRole = "wave" | "notes";

/** A kind's table definition, or `null` when it has none. */
export function tableDef(kind: string | undefined): NodeKindDef["table"] {
  const def = kind ? nodeKind(kind) : undefined;
  return def?.table ?? null;
}

/** The role a kind's rows play, which picks the figure drawn for them. */
export function tableRole(kind: string | undefined): TableRole {
  return tableDef(kind)?.key === "notes" ? "notes" : "wave";
}

/** The number of values per row (the column count). */
export function rowWidth(kind: string | undefined): number {
  return Math.max(1, tableDef(kind)?.columns.length ?? 1);
}

/** One column's label and range, or `undefined` past the last column. */
export function columnAt(kind: string | undefined, index: number) {
  return tableDef(kind)?.columns[index];
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

/** One note bar of a piano roll, in a `width × height` box. */
export interface RollBar {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1, drawn as the bar's fill opacity. */
  velocity: number;
}

/**
 * A piano roll of a `sequence` table: `start, dur, midi note, velocity` per row.
 * Time runs left to right across the rows' full span; pitch bottom to top.
 */
export function pianoRoll(
  rows: readonly number[],
  width: number,
  boxWidth = 120,
  boxHeight = 36,
): RollBar[] {
  const stride = Math.max(1, width);
  const notes: { start: number; duration: number; pitch: number; velocity: number }[] = [];
  for (let index = 0; index + 3 < rows.length; index += stride) {
    notes.push({
      start: rows[index] ?? 0,
      duration: rows[index + 1] ?? 0,
      pitch: rows[index + 2] ?? 0,
      velocity: rows[index + 3] ?? 0,
    });
  }
  if (notes.length === 0) return [];
  const end = Math.max(...notes.map((note) => note.start + note.duration), 0.001);
  const low = Math.min(...notes.map((note) => note.pitch)) - 1;
  const high = Math.max(...notes.map((note) => note.pitch)) + 1;
  const span = Math.max(high - low, 2);
  const height = Math.max(boxHeight / span - 1, 2);
  return notes.map((note) => {
    const x = (Math.max(note.start, 0) / end) * boxWidth;
    const barWidth = Math.max((note.duration / end) * boxWidth, 1.5);
    const y = boxHeight - ((note.pitch - low) / span) * boxHeight - height;
    return {
      x,
      y: Math.min(Math.max(y, 0), boxHeight - height),
      width: Math.min(barWidth, boxWidth - x),
      height,
      velocity: Math.min(Math.max(note.velocity, 0.15), 1),
    };
  });
}

/** A node's table rows: its own, or the kind's defaults when it has none yet. */
export function rowsOf(kind: string, stored: readonly number[] | undefined): number[] {
  const rows = stored && stored.length > 0 ? stored : defaultRows(kind);
  const width = rowWidth(kind);
  // Whole rows only: a truncated tail would desync the columns.
  return rows.slice(0, Math.floor(rows.length / width) * width);
}
