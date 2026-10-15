import { createSignal, type Accessor } from "solid-js";
import type { Note } from "../../bindings/Note";
import { analyzerById, isAnalyzerId, type AnalyzerId } from "../../state/analyzer";
import {
  createNote,
  dragNoteEndTo,
  dragNoteTo,
  refreshNoteValues,
  selectNote,
  setFocusedNote,
} from "../../state/notes";
import { noteLabel, noteSpan, noteTimeText } from "../../lib/note";
import { source } from "../../state/source";

/**
 * The **note lane** (M14): the thin strip along the bottom of the Timeline and of every
 * time chart, where notes are created, moved and resized.
 *
 * One pointer state machine serves all three hosts (the Timeline canvas, the uPlot
 * charts, the canvas heatmaps), so the lane behaves identically everywhere:
 *
 * - press on a note's **handle** → drag it: a point note moves, a range resizes from
 *   whichever edge was grabbed (grabbing anywhere across a range takes its nearer edge);
 * - press on **empty lane space** and drag → a live **selection**; releasing it creates a
 *   **range** note over that span (a bare click does nothing, so the lane is safe to
 *   click through).
 *
 * Creating a note selects it and opens its editor, but **never moves the analysis
 * window** — a note is an annotation *on* the analysis, not a request to reframe it.
 * Grabbing a note's handle and clicking it behave the same way: a drag moves/resizes it
 * and a click just selects it. Only the row's **Analyze** button reframes (see
 * `state/notes/focus.ts`). See `docs/notes.md`.
 */

/** Which edge of a note's span a lane handle moves. */
export type NoteEdge = "start" | "end";

/** A span being dragged out in the lane (source seconds), or `null`. */
export type LaneSelection = { start: number; end: number } | null;

/** Canvas geometry for the lane: its bounds inside the drawing surface, plus a mapper. */
export interface LaneGeom {
  xFor: (timeSecs: number) => number;
  top: number;
  height: number;
  left: number;
  right: number;
}

/** How close (px) the pointer must be to a note handle to grab it. */
export const LANE_HIT_PX = 10;

/** The note handle nearest lane-local `x`, or `null` for empty lane space. */
export function noteHandleAt(
  notes: Note[],
  timeAt: (timeSecs: number) => number,
  x: number,
): { note: Note; edge: NoteEdge } | null {
  let best: { note: Note; edge: NoteEdge } | null = null;
  let bestDistance = LANE_HIT_PX;
  for (const note of notes) {
    const span = noteSpan(note);
    if (span.end > span.start) {
      // A range is grabbable anywhere across its span; the nearer edge wins.
      const x0 = timeAt(span.start);
      const x1 = timeAt(span.end);
      const edge: NoteEdge = Math.abs(x - x0) <= Math.abs(x - x1) ? "start" : "end";
      const inside = x >= Math.min(x0, x1) && x <= Math.max(x0, x1);
      const distance = inside ? 0 : Math.min(Math.abs(x - x0), Math.abs(x - x1));
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { note, edge };
      }
      continue;
    }
    const distance = Math.abs(timeAt(span.start) - x);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = { note, edge: "start" };
    }
  }
  return best;
}

/** The span a lane drag from `anchor` to `head` covers, ordered and clamped. */
export function laneSelection(
  anchor: number,
  head: number,
  duration: number,
): {
  start: number;
  end: number;
} {
  const lo = Math.max(0, Math.min(anchor, head));
  const hi = Math.max(anchor, head);
  return { start: lo, end: duration > 0 ? Math.min(hi, duration) : hi };
}

/** What the lane's pointer handlers need to know about their host. */
export interface LaneHost {
  /** The notes the lane shows (its own, other charts', the focused one). */
  notes: () => Note[];
  /** The chart a note created in this lane belongs to (`null` = a Timeline note). */
  tool: () => AnalyzerId | null;
  /** A time → lane-local x mapper, for hit-testing handles (the same one it draws with). */
  timeAt: (timeSecs: number) => number;
  /** A lane-local x → time mapper, for a new selection. */
  timeFromX: (x: number) => number;
}

/** The lane's drag state, driven by whichever host owns the pointer. */
export interface LaneController {
  /** Begin a drag at lane-local `x`. Returns `true` when the lane took the gesture. */
  down: (x: number) => boolean;
  /** Report a move (a source time), while a drag is in progress. */
  move: (timeSecs: number) => void;
  /** Finish the drag: commit a resize, or create the selected note. */
  up: () => void;
  /** The span being dragged out, for the host to draw (`null` when there is none). */
  selection: Accessor<LaneSelection>;
}

/** Create the lane's drag state for one host. */
export function createLaneDrag(host: () => LaneHost): LaneController {
  const [selection, setSelection] = createSignal<LaneSelection>(null);
  let drag:
    { kind: "handle"; id: string; edge: NoteEdge } | { kind: "select"; anchor: number } | null =
    null;
  let moved = false;

  const down = (x: number): boolean => {
    const { notes, timeAt, timeFromX } = host();
    moved = false;
    const hit = noteHandleAt(notes(), timeAt, x);
    if (hit) {
      drag = { kind: "handle", id: hit.note.id, edge: hit.edge };
      return true;
    }
    const anchor = timeFromX(x);
    drag = { kind: "select", anchor };
    setSelection({ start: anchor, end: anchor });
    return true;
  };

  const move = (timeSecs: number) => {
    if (!drag) return;
    moved = true;
    if (drag.kind === "handle") {
      // The start edge moves a point note or resizes a range from the left; the end
      // edge resizes it.
      if (drag.edge === "end") dragNoteEndTo(drag.id, timeSecs);
      else dragNoteTo(drag.id, timeSecs);
      return;
    }
    setSelection(laneSelection(drag.anchor, timeSecs, source()?.duration ?? 0));
  };

  const up = () => {
    const active = drag;
    const sel = selection();
    drag = null;
    setSelection(null);
    if (!active) return;
    if (active.kind === "handle") {
      if (moved) {
        // The note moved: re-snapshot its values and keep it selected.
        refreshNoteValues(active.id);
        setFocusedNote(active.id);
      } else {
        selectNote(active.id);
      }
      return;
    }
    if (!moved || !sel) return;
    const isRange = sel.end > sel.start;
    createNote({
      timeSecs: sel.start,
      range: isRange ? { startSecs: sel.start, endSecs: sel.end } : null,
      tool: host().tool(),
    });
  };

  return { down, move, up, selection };
}

/**
 * Draw the lane: its background, a hint while it is empty, and the live selection.
 * The hosts draw their notes on top (see `analyzer/notePlugins.ts`).
 */
export function drawLane(
  ctx: CanvasRenderingContext2D,
  geom: LaneGeom,
  opts: {
    /** The lane's background fill. */
    background: string;
    /** The note colour: the selection fill / edge rule. */
    color: string;
    /** The hint text colour (muted). */
    hintColor: string;
    hint: string | null;
    selection: LaneSelection;
  },
) {
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = opts.background;
  ctx.fillRect(geom.left, geom.top, Math.max(0, geom.right - geom.left), geom.height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = opts.color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(geom.left, geom.top + 0.5);
  ctx.lineTo(geom.right, geom.top + 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (opts.selection) {
    const [x0, x1] = [geom.xFor(opts.selection.start), geom.xFor(opts.selection.end)];
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = opts.color;
    ctx.fillRect(Math.min(x0, x1), geom.top + 1, Math.max(1, Math.abs(x1 - x0)), geom.height - 2);
    ctx.globalAlpha = 1;
  } else if (opts.hint) {
    ctx.fillStyle = opts.hintColor;
    ctx.globalAlpha = 0.75;
    ctx.font = "11px Inter, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(opts.hint, geom.left + 8, geom.top + geom.height / 2);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/**
 * The note's hover hint text (title · tool · time · values line, plus what the pointer
 * can do with it — the lane's handles are small, so the hint teaches them).
 */
export function noteHintText(note: Note): string {
  const tool = note.tool && isAnalyzerId(note.tool) ? analyzerById(note.tool).title : "Timeline";
  const values = note.values ? ` · ${note.values.text}` : "";
  const action = note.range ? "drag an edge to resize" : "drag to move";
  return `${noteLabel(note)} · ${tool} · ${noteTimeText(note)}${values} — ${action}`;
}
