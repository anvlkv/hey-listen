import { createEffect, createRoot } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { Note } from "../../bindings/Note";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { noteHeading, noteSpan } from "../../lib/note";
import { chartTheme } from "../../state/themes";
import { NOTE_STRIP_H } from "../notes/strip";
import {
  createLaneDrag,
  drawLane,
  type LaneController,
  type LaneGeom,
  type LaneSelection,
} from "../notes/lane";
import type { AnalyzerId } from "../../state/analyzer";

/**
 * Note markers on the analyzer charts (M14): a chart draws **its own** notes
 * (full-strength anchors), every **other** note slightly muted, and the **focused**
 * note as a full-height rule with a label. A note is drawn in the **lane** along the
 * bottom of the plot (`components/notes/lane.ts`, which also owns the pointer gesture
 * — drag a handle to move / resize, drag empty space to select a span for a new note).
 * The frequency-axis `spectrum` draws none (a time marker has no meaning on a frequency
 * axis). Notes arrive on the shared [`analyzerBus`](../../state/chartSync.ts) (`notes`),
 * published by the notes store, so cross-window and store changes redraw in step. A
 * range note shows a handle on each edge. See `docs/notes.md`.
 */

/** The focused note's marker label font — larger than the axis font, so it reads. */
const NOTE_LABEL_FONT = "600 12px Inter, sans-serif";

/** Canvas geometry for the lane's markers. */
export type NoteGeom = LaneGeom;

/** The notes a chart draws: its own, the others (muted), and the focused one. */
export interface NoteGroups {
  own: Note[];
  others: Note[];
  focused: Note | null;
  /** Whether the Notes rail is open — closed draws the anchors dull (see [`drawNoteMarkers`]). */
  panelOpen: boolean;
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
  return { own, others, focused, panelOpen: message?.panelOpen ?? false };
}

/** Every note a chart's lane shows: its own, the others', and the focused one. */
export function laneNotes(tool: AnalyzerId | string): Note[] {
  const { own, others, focused } = noteGroups(tool);
  return focused ? [...own, ...others, focused] : [...own, ...others];
}

/** The focused note's marker label: its values line, else its heading. */
export function noteMarkerLabel(note: Note): string {
  return note.values?.text || noteHeading(note.body, 32) || "Annotation";
}

const inRange = (x: number, geom: NoteGeom) =>
  Number.isFinite(x) && x >= geom.left && x <= geom.right;

/** The lane's top edge inside the plot area. */
const laneTopOf = (geom: NoteGeom) => geom.top + geom.height - NOTE_STRIP_H;

/**
 * A note's grab handles in the lane: two caps joined by a span bar for a range, a
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
  const stripTop = laneTopOf(geom);
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

/** A note's anchor in the lane (a shaded span for a range note). */
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
  const stripTop = laneTopOf(geom);
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
 * Draw the note lane and its markers onto a 2-D context. Shared by the uPlot plugin
 * and the canvas heatmaps (`MatrixView` / `SpectrogramTab`) so the lane looks (and
 * behaves) identical everywhere.
 */
export function drawNoteMarkers(
  ctx: CanvasRenderingContext2D,
  geom: NoteGeom,
  groups: NoteGroups,
  opts: { selection?: LaneSelection; hint?: string | null } = {},
) {
  const { own, others, focused } = groups;
  const theme = chartTheme();
  drawLane(ctx, geom, {
    background: theme.ruler,
    color: theme.note,
    hintColor: theme.axis,
    hint: opts.hint ?? null,
    selection: opts.selection ?? null,
  });
  if (own.length === 0 && others.length === 0 && !focused) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(geom.left, geom.top, Math.max(0, geom.right - geom.left), geom.height);
  ctx.clip();

  // A closed rail keeps the anchors (they still mark where the notes are) but draws them
  // dull, so notes recede once the user is no longer working with them.
  const quiet = groups.panelOpen ? 1 : 0.55;
  for (const note of others) tick(ctx, geom, note, theme.note, 0.28 * quiet);
  for (const note of own) tick(ctx, geom, note, theme.note, 0.7 * quiet);
  ctx.globalAlpha = 1;

  // The focused note: a full-height rule on each edge (a shaded span for a range),
  // its handles in the lane, and its label. Only while the rail is open — that is
  // what "focused" means to the user.
  if (focused && groups.panelOpen) {
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
    if (inRange(x0, geom)) {
      // A label chip just above the lane, so it stays readable over a heatmap.
      const label = noteMarkerLabel(focused);
      ctx.font = NOTE_LABEL_FONT;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      const width = ctx.measureText(label).width;
      const px = Math.round(x0) + 0.5;
      let lx = px + 6;
      if (lx + width > geom.right) lx = Math.max(geom.left, px - 6 - width);
      const baseline = laneTopOf(geom) - 4;
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

/**
 * uPlot plugin: the lane's markers (own + muted others + the focused rule) on a chart,
 * with the lane gesture wired to the plot's overlay — drag a handle to move / resize a
 * note, drag empty lane space to select a span for a new one.
 */
export function noteMarkers(tool: AnalyzerId): UplotPluginFactory<AnalyzerBus> {
  return () => {
    let groups: NoteGroups = { own: [], others: [], focused: null, panelOpen: false };
    let lane: LaneController | undefined;
    let dispose: (() => void) | undefined;
    const listeners: [string, EventListener][] = [];

    return {
      hooks: {
        ready: (u) => {
          dispose = createRoot((root) => {
            lane = createLaneDrag(() => ({
              notes: () => laneNotes(tool),
              tool: () => tool,
              // **Plot-relative** coordinates: `u.over` *is* the plot area (uPlot positions
              // it at the plot's top-left), so the pointer and the mapper must both be
              // relative to it — `valToPos(..., true)` returns canvas pixels instead.
              timeAt: (time) => u.valToPos(time, "x"),
              timeFromX: (x) => u.posToVal(x, "x"),
            }));
            createEffect(() => {
              groups = noteGroups(tool);
              // `u.redraw()` (not `redraw(false)`, which commits without drawing unless a
              // scale change is pending) — a plugin-driven repaint must always repaint.
              u.redraw();
            });
            // Repaint while a selection is being dragged out in the lane.
            createEffect(() => {
              lane?.selection();
              u.redraw();
            });
            return root;
          });

          const onDown = (event: PointerEvent) => {
            if (!u.over || event.button !== 0 || !lane) return;
            const rect = u.over.getBoundingClientRect();
            const localY = event.clientY - rect.top;
            // Only the bottom lane grabs, so plot drag/zoom keeps working above it.
            if (localY < u.bbox.height - NOTE_STRIP_H) return;
            if (!lane.down(event.clientX - rect.left)) return;
            event.stopPropagation();
            event.preventDefault();
            u.over.setPointerCapture(event.pointerId);
          };

          const onMove = (event: PointerEvent) => {
            if (!u.over || !lane) return;
            const rect = u.over.getBoundingClientRect();
            lane.move(u.posToVal(event.clientX - rect.left, "x"));
          };

          const onUp = (event: PointerEvent) => {
            lane?.up();
            if (u.over?.hasPointerCapture(event.pointerId)) {
              u.over.releasePointerCapture(event.pointerId);
            }
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
