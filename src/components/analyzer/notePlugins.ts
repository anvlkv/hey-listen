import { createEffect, createRoot } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { Note } from "../../bindings/Note";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { dragNoteTo, refreshNoteValues } from "../../state/notes";
import { noteHeading } from "../../lib/note";
import { chartTheme } from "../../state/themes";
import type { AnalyzerId } from "../../state/analyzer";

/**
 * Note markers on the analyzer charts (M14): a chart draws **its own** notes
 * (full-strength ticks), every **other** note slightly muted, and the **focused**
 * note as a full-height rule with a label. The frequency-axis `spectrum` draws none
 * (a time marker has no meaning on a frequency axis). Notes arrive on the shared
 * [`analyzerBus`](../../state/chartSync.ts) (`notes`), published by the notes store,
 * so cross-window and store changes redraw in step. See `docs/notes.md`.
 */

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

/** A short tick at the top edge (a shaded span for a range note). */
function tick(
  ctx: CanvasRenderingContext2D,
  geom: NoteGeom,
  note: Note,
  color: string,
  alpha: number,
) {
  if (note.range) {
    const x0 = geom.xFor(note.range.startSecs);
    const x1 = geom.xFor(note.range.endSecs);
    if (x1 > geom.left && x0 < geom.right) {
      ctx.globalAlpha = alpha * 0.16;
      ctx.fillStyle = color;
      ctx.fillRect(x0, geom.top, Math.max(1, x1 - x0), geom.height);
    }
  }
  const x = geom.xFor(note.timeSecs);
  if (!inRange(x, geom)) return;
  const px = Math.round(x) + 0.5;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, geom.top);
  ctx.lineTo(px, geom.top + 7);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(px - 3, geom.top);
  ctx.lineTo(px + 3, geom.top);
  ctx.lineTo(px, geom.top + 5);
  ctx.closePath();
  ctx.fill();
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

  // The focused note: a full-height rule (a shaded span for a range) with its label.
  if (focused) {
    if (focused.range) {
      const x0 = geom.xFor(focused.range.startSecs);
      const x1 = geom.xFor(focused.range.endSecs);
      if (x1 > geom.left && x0 < geom.right) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = theme.note;
        ctx.fillRect(x0, geom.top, Math.max(1, x1 - x0), geom.height);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.note;
      ctx.lineWidth = 1;
      for (const edge of [x0, x1]) {
        if (!inRange(edge, geom)) continue;
        const px = Math.round(edge) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, geom.top);
        ctx.lineTo(px, geom.top + geom.height);
        ctx.stroke();
      }
    }
    const x = geom.xFor(focused.timeSecs);
    if (inRange(x, geom)) {
      const px = Math.round(x) + 0.5;
      ctx.strokeStyle = theme.note;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, geom.top);
      ctx.lineTo(px, geom.top + geom.height);
      ctx.stroke();
      const label = noteMarkerLabel(focused);
      ctx.font = theme.font;
      ctx.fillStyle = theme.note;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      const width = ctx.measureText(label).width;
      let lx = px + 4;
      if (lx + width > geom.right) lx = Math.max(geom.left, px - 4 - width);
      ctx.fillText(label, lx, geom.top + 3);
    }
  }
  ctx.restore();
}

/** How close (px) the pointer must be to a note's time to grab it. */
const GRAB_PX = 7;

/** The note whose time is within `GRAB_PX` of a plot-local x, or `null`. */
export function noteNear(
  groups: NoteGroups,
  xFor: (timeSecs: number) => number,
  localX: number,
): Note | null {
  const candidates: Note[] = [];
  if (groups.focused) candidates.push(groups.focused);
  candidates.push(...groups.own, ...groups.others);
  let best: Note | null = null;
  let bestDistance = GRAB_PX;
  for (const note of candidates) {
    const distance = Math.abs(xFor(note.timeSecs) - localX);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = note;
    }
  }
  return best;
}

/**
 * uPlot plugin: draws a chart's notes (own + muted others + the focused rule) and lets
 * the user **drag a note along the time axis** by grabbing its tick in the top band.
 */
export function noteMarkers(tool: AnalyzerId): UplotPluginFactory<AnalyzerBus> {
  return () => {
    let groups: NoteGroups = { own: [], others: [], focused: null };
    let dispose: (() => void) | undefined;
    let drag: { id: string } | null = null;
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

          /** The note whose time is within `GRAB_PX` of a plot-local x. */
          const noteAt = (localX: number): Note | null =>
            noteNear(groups, (time) => u.valToPos(time, "x", true), localX);

          const onDown = (event: PointerEvent) => {
            if (!u.over || event.button !== 0) return;
            const rect = u.over.getBoundingClientRect();
            const localX = event.clientX - rect.left;
            const localY = event.clientY - rect.top;
            // Only the top marker band grabs, so plot zoom/select keeps working below.
            if (localY < u.bbox.top || localY > u.bbox.top + 14) return;
            const note = noteAt(localX);
            if (!note) return;
            drag = { id: note.id };
            event.stopPropagation();
            event.preventDefault();
            u.over.setPointerCapture(event.pointerId);
          };

          const onMove = (event: PointerEvent) => {
            if (!drag || !u.over) return;
            event.stopPropagation();
            const rect = u.over.getBoundingClientRect();
            dragNoteTo(drag.id, u.posToVal(event.clientX - rect.left, "x"));
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
