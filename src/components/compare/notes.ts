import type { NotesDiffDto } from "../../state/compare/types";

/**
 * The `noteMetrics` compare table's rows (M25.A).
 *
 * A matched pair is one row with both sides and their deltas; a note that exists on
 * one side only is still a row — the interesting half of a note comparison is the note
 * the other project does not have. Rows are ordered by the time each note starts.
 */

export type NoteRowKind = "pair" | "onlyA" | "onlyB";

export interface NoteRow {
  kind: NoteRowKind;
  aStart: number | null;
  bStart: number | null;
  dt: number | null;
  aDuration: number | null;
  bDuration: number | null;
  durationDelta: number | null;
  aRmsDb: number | null;
  bRmsDb: number | null;
  rmsDeltaDb: number | null;
}

/** Flatten a notes delta into ordered table rows (matched pairs and unmatched notes). */
export function noteRows(diff: NotesDiffDto): NoteRow[] {
  const rows: NoteRow[] = diff.pairs.map((pair) => ({
    kind: "pair",
    aStart: pair.aStart,
    bStart: pair.bStart,
    dt: pair.dt,
    aDuration: pair.aDuration,
    bDuration: pair.bDuration,
    durationDelta: pair.durationDelta,
    aRmsDb: pair.aRmsDb,
    bRmsDb: pair.bRmsDb,
    rmsDeltaDb: pair.rmsDeltaDb,
  }));
  for (const start of diff.onlyAStarts) {
    rows.push({
      kind: "onlyA",
      aStart: start,
      bStart: null,
      dt: null,
      aDuration: null,
      bDuration: null,
      durationDelta: null,
      aRmsDb: null,
      bRmsDb: null,
      rmsDeltaDb: null,
    });
  }
  for (const start of diff.onlyBStarts) {
    rows.push({
      kind: "onlyB",
      aStart: null,
      bStart: start,
      dt: null,
      aDuration: null,
      bDuration: null,
      durationDelta: null,
      aRmsDb: null,
      bRmsDb: null,
      rmsDeltaDb: null,
    });
  }
  const time = (row: NoteRow) => row.aStart ?? row.bStart ?? 0;
  return rows.sort((x, y) => time(x) - time(y));
}

/** The row label a table shows (`#` column). */
export function rowLabel(row: NoteRow, index: number): string {
  return row.kind === "pair" ? `${index + 1}` : row.kind === "onlyA" ? "A only" : "B only";
}
