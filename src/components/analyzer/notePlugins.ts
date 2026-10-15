import { createEffect, createRoot } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { Note } from "../../bindings/Note";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { dragNoteEndTo, dragNoteTo, refreshNoteValues } from "../../state/notes";
import { noteHeading, noteSpan } from "../../lib/note";
import { chartTheme } from "../../state/themes";
import { NOTE_STRIP_H } from "../notes/strip";
import type { AnalyzerId } from "../../state/analyzer";

/**
 * Note markers on the analyzer charts (M14): a chart draws **its own** notes
 * (full-strength anchors), every **other** note slightly muted, and the **focused**
 * note as a full-height rule with a label. The anchors live in a thin **strip** along
 * the bottom of the plot (`components/notes/strip.ts`), which keeps them clear of
 * uPlot's drag/zoom area. A range note shows **two handles** — one per edge, joined by
 * a span bar — and either edge can be dragged. The frequency-axis `spectrum` draws
 * none (a time marker has no meaning on a frequency axis). Notes arrive on the shared
 * [`analyzerBus`](../../state/chartSync.ts) (`notes`), published by the notes store,
 * so cross-window and store changes redraw in step. See `docs/notes.md`.
 */

/** The focused note's marker label font — larger than the axis font, so it reads. */
const NOTE_LABEL_FONT = "600 12px Inter, sans-serif";

/** Which edge of a note's anchor a pointer grabbed. */
export type NoteEdge = "start" | "end";

/** Canvas geometry for the markers: the plot area plus a time → x mapper. */
export interface NoteGeom {
  xFor: (timeSecs: number) => number;
  top: number;
  height: number;
  left: number;
  right: number;
}

/** The notes a chart draws: its own, the others (muted), and the focused one. */
export interface NoteGroups {
  own: Note[];
  others: Note[];
  focused: Note | null;
}

/** Partition the bus notes for a chart with `tool` (reads the bus reactively). */
export function noteGroups(tool: AnalyzerId | string): NoteGroups {
  const message = analyzerBus.data.notes;
  const all = message?.notes ?? [];
  const focusedId = message?.focusedId ?? null;
  const focused = focusedId ? (all.find((note) => note.id === focusedId) ?? null) : null;
  const own: Note[] = [];
  const others: Note[] = [];
  for (const note of all) {
    if (note.id === focusedId) continue;
    (note.tool === tool ? own : others).push(note);
  }
  return { own, others, focused };
}

/** The focused note's marker label: its values line, else its heading. */
export function noteMarkerLabel(note: Note): string {
  return note.values?.text || noteHeading(note.body, 32) || "Note";
}

const inRange = (x: number, geom: NoteGeom) =>
  Number.isFinite(x) && x >= geom.left && x <= geom.right;

/** The strip's top edge inside the plot area. */
const stripTopOf = (geom: NoteGeom) => geom.top + geom.height - NOTE_STRIP_H;

/**
 * A note's grab handles in the strip: two caps joined by a span bar for a range, a
 * single tab for a point note. The geometry the pointer hit-test uses, so a click
 * always lands on a handle the user can see.
 */
function drawHandles(
  ctx: CanvasRenderingContext2D,
  geom: NoteGeom,
  note: Note,
  color: string,
  cap: number,
) {
  const span = noteSpan(note);
  const stripTop = stripTopOf(geom);
  const x0 = Math.round(geom.xFor(span.start));
  const x1 = Math.round(geom.xFor(span.end));
  const top = stripTop + 1;
  const height = NOTE_STRIP_H - 2;
  ctx.fillStyle = color;
  if (span.end > span.start) {
    ctx.fillRect(x0, stripTop + 4, Math.max(1, x1 - x0), 3);
    ctx.fillRect(x0 - 3, top, 6, height);
    ctx.fillRect(x1 - 3, top, 6, height);
    return;
  }
  ctx.fillRect(x0 - 1, top, 2, height);
  ctx.fillRect(x0 - cap / 2, top, cap, 3);
}

/** A note's anchor in the bottom strip (a shaded span for a range note). */
function tick(
  ctx: CanvasRenderingContext2D,
  geom: NoteGeom,
  note: Note,
  color: string,
  alpha: number,
) {
  const span = noteSpan(note);
  if (span.end > span.start) {
    const x0 = geom.xFor(span.start);
    const x1 = geom.xFor(span.end);
    if (x1 > geom.left && x0 < geom.right) {
      ctx.globalAlpha = alpha * 0.16;
      ctx.fillStyle = color;
      ctx.fillRect(x0, geom.top, Math.max(1, x1 - x0), geom.height);
    }
  }
  const x = geom.xFor(span.start);
  if (!inRange(x, geom)) return;
  const stripTop = stripTopOf(geom);
  // A faint stem rising out of the lane, then the handle(s) inside it.
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, stripTop - 6);
  ctx.lineTo(Math.round(x) + 0.5, stripTop);
  ctx.stroke();
  ctx.globalAlpha = alpha;
  drawHandles(ctx, geom, note, color, 6);
}

/**
 * Draw the note markers onto a 2-D context. Shared by the uPlot plugin and the canvas
 * heatmaps (`MatrixView` / `SpectrogramTab`) so the markers look identical everywhere.
 */
export function drawNoteMarkers(ctx: CanvasRenderingContext2D, geom: NoteGeom, groups: NoteGroups) {
  const { own, others, focused } = groups;
  if (own.length === 0 && others.length === 0 && !focused) return;
  const theme = chartTheme();
  ctx.save();
  ctx.beginPath();
  ctx.rect(geom.left, geom.top, Math.max(0, geom.right - geom.left), geom.height);
  ctx.clip();

  // Other charts' notes first (muted), then this chart's own.
  for (const note of others) tick(ctx, geom, note, theme.note, 0.28);
  for (const note of own) tick(ctx, geom, note, theme.note, 0.7);
  ctx.globalAlpha = 1;

  // The focused note: a full-height rule on each edge (a shaded span for a range),
  // its handles in the lane, and its label.
  if (focused) {
    const span = noteSpan(focused);
    const x0 = geom.xFor(span.start);
    const x1 = geom.xFor(span.end);
    if (focused.range && x1 > geom.left && x0 < geom.right) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = theme.note;
      ctx.fillRect(x0, geom.top, Math.max(1, x1 - x0), geom.height);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.note;
    ctx.lineWidth = span.end > span.start ? 1 : 1.5;
    for (const edge of span.end > span.start ? [x0, x1] : [x0]) {
      if (!inRange(edge, geom)) continue;
      const px = Math.round(edge) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, geom.top);
      ctx.lineTo(px, geom.top + geom.height);
      ctx.stroke();
    }
    drawHandles(ctx, geom, focused, theme.note, 8);
    const px = Math.round(x0) + 0.5;
    if (inRange(x0, geom)) {
      // A label chip just above the lane, so it stays readable over a heatmap.
      const label = noteMarkerLabel(focused);
      ctx.font = NOTE_LABEL_FONT;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      const width = ctx.measureText(label).width;
      let lx = px + 6;
      if (lx + width > geom.right) lx = Math.max(geom.left, px - 6 - width);
      const baseline = stripTopOf(geom) - 4;
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = theme.background;
      ctx.fillRect(lx - 3, baseline - 15, width + 6, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.note;
      ctx.fillText(label, lx, baseline);
    }
  }
  ctx.restore();
}

/** How close (px) the pointer must be to a note's edge to grab it. */
const GRAB_PX = 7;

/** The note edge within `GRAB_PX` of a plot-local x, or `null`. */
export function noteEdgeNear(
  groups: NoteGroups,
  xFor: (timeSecs: number) => number,
  localX: number,
): { note: Note; edge: NoteEdge } | null {
  const candidates: Note[] = [];
  if (groups.focused) candidates.push(groups.focused);
  candidates.push(...groups.own, ...groups.others);
  let best: { note: Note; edge: NoteEdge } | null = null;
  let bestDistance = GRAB_PX;
  for (const note of candidates) {
    const span = noteSpan(note);
    // A range has two handles; a point note only its anchor (dragging it moves it).
    const edges: NoteEdge[] = span.end > span.start ? ["start", "end"] : ["start"];
    for (const edge of edges) {
      const distance = Math.abs(xFor(edge === "end" ? span.end : span.start) - localX);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { note, edge };
      }
    }
  }
  return best;
}

/**
 * uPlot plugin: draws a chart's notes (own + muted others + the focused rule) and lets
 * the user **drag a note along the time axis** by grabbing a handle in the bottom strip.
 */
export function noteMarkers(tool: AnalyzerId): UplotPluginFactory<AnalyzerBus> {
  return () => {
    let groups: NoteGroups = { own: [], others: [], focused: null };
    let dispose: (() => void) | undefined;
    let drag: { id: string; edge: NoteEdge } | null = null;
    const listeners: [string, EventListener][] = [];

    return {
      hooks: {
        ready: (u) => {
          dispose = createRoot((root) => {
            createEffect(() => {
              groups = noteGroups(tool);
              u.redraw(false);
            });
            return root;
          });

          /** The note edge within `GRAB_PX` of a plot-local x. */
          const edgeAt = (localX: number) =>
            noteEdgeNear(groups, (time) => u.valToPos(time, "x", true), localX);

          const onDown = (event: PointerEvent) => {
            if (!u.over || event.button !== 0) return;
            const rect = u.over.getBoundingClientRect();
            const localX = event.clientX - rect.left;
            const localY = event.clientY - rect.top;
            // Only the bottom note lane grabs, so plot drag/zoom keeps working above.
            if (localY < u.bbox.top + u.bbox.height - NOTE_STRIP_H) return;
            const hit = edgeAt(localX);
            if (!hit) return;
            drag = { id: hit.note.id, edge: hit.edge };
            event.stopPropagation();
            event.preventDefault();
            u.over.setPointerCapture(event.pointerId);
          };

          const onMove = (event: PointerEvent) => {
            if (!drag || !u.over) return;
            event.stopPropagation();
            const rect = u.over.getBoundingClientRect();
            const time = u.posToVal(event.clientX - rect.left, "x");
            // The start edge moves (a point) or resizes (a range); the end edge resizes.
            if (drag.edge === "end") dragNoteEndTo(drag.id, time);
            else dragNoteTo(drag.id, time);
          };

          const onUp = (event: PointerEvent) => {
            if (!drag) return;
            const id = drag.id;
            drag = null;
            if (u.over?.hasPointerCapture(event.pointerId)) {
              u.over.releasePointerCapture(event.pointerId);
            }
            refreshNoteValues(id);
          };

          for (const [type, handler] of [
            ["pointerdown", onDown],
            ["pointermove", onMove],
            ["pointerup", onUp],
            ["pointercancel", onUp],
          ] as [string, EventListener][]) {
            u.over.addEventListener(type, handler, { capture: true });
            listeners.push([type, handler]);
          }
        },
        draw: (u) => {
          if (!u.ctx) return;
          drawNoteMarkers(
            u.ctx,
            {
              xFor: (time) => u.valToPos(time, "x", true),
              top: u.bbox.top,
              height: u.bbox.height,
              left: u.bbox.left,
              right: u.bbox.left + u.bbox.width,
            },
            groups,
          );
        },
        destroy: (u) => {
          for (const [type, handler] of listeners) {
            u.over.removeEventListener(type, handler, { capture: true });
          }
          listeners.length = 0;
          dispose?.();
        },
      },
    };
  };
}
