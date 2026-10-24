import { createEffect, createRoot } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import uPlot from "uplot";
import type { NoteMetric } from "../../bindings/NoteMetric";
import type { AnalyzerBus } from "../../state/chartSync";
import { chartTheme } from "../../state/themes";
import { gapSpans, noteAt, type GapSpan } from "../../lib/noteSegments";
import { duration } from "./noteMetricsFormat";
import { NOTE_STRIP_H } from "../notes/strip";

/**
 * The note-segment overlay: everything the segment chart encodes beyond the envelope
 * line itself.
 *
 * - **Blocks** — each note's span filled from the plot floor to its **peak**, with a
 *   stronger fill up to its **RMS**. The cap between the two is the note's crest.
 * - **Ruler** — a bar along the top edge, split into the **voiced** share (solid) and
 *   the rest (faint), so voicing reads along the timeline.
 * - **Gaps** — a faint band and the gap's duration, so silence is measured, not just
 *   absent.
 * - **Gate** — the threshold that produced the segments, drawn when it falls in view.
 * - **Labels** — the note number above its peak (the loudest in the reference colour).
 * - **Hover** — the note under the pointer is outlined and reported to the view, which
 *   highlights its table row.
 *
 * Labels are dropped — not shrunk — when a span is too narrow, and colliding labels are
 * skipped, so a dense call sequence stays readable. The result is read through an
 * accessor so a new analysis repaints without rebuilding the chart; a redraw on hover
 * happens only when the note under the pointer changes.
 */

/** The slice of the result the overlay draws. */
export interface SegmentView {
  windowStart: number;
  notes: NoteMetric[];
  reference: number | null;
  threshold: number;
}

/** Ruler height, in CSS px. */
const SEGMENT_RULER_H = 5;
/** A note narrower than this (CSS px) cannot hold a readable index label. */
const NOTE_LABEL_MIN_WIDTH = 22;
/** Clearance between the ruler and the topmost note label baseline, in CSS px. */
const NOTE_LABEL_TOP_GAP = 16;
/** A gap narrower than this (CSS px) cannot hold a duration label. */
const GAP_LABEL_MIN_WIDTH = 46;
/** Ruler alpha for a note whose voicing could not be measured. */
const UNMEASURED_ALPHA = 0.35;

export const noteSegments =
  (
    getView: () => SegmentView,
    onHover?: (index: number | null) => void,
  ): UplotPluginFactory<AnalyzerBus> =>
  () => {
    let view: SegmentView = { windowStart: 0, notes: [], reference: null, threshold: 0 };
    let gaps: GapSpan[] = [];
    let hovered: number | null = null;
    let dispose: (() => void) | undefined;
    let pointerLeave: (() => void) | undefined;

    return {
      hooks: {
        ready: (u) => {
          dispose = createRoot((root) => {
            createEffect(() => {
              view = getView();
              // Gaps are cheap to derive but drawn on every pan/zoom frame, so derive
              // them once per result (not once per frame).
              gaps = gapSpans(view);
              u.redraw();
            });
            return root;
          });
          pointerLeave = () => {
            if (hovered === null) return;
            hovered = null;
            onHover?.(null);
            u.redraw();
          };
          u.over.addEventListener("pointerleave", pointerLeave);
        },

        // Report the note under the pointer (the view highlights its table row) and
        // repaint only when that note changes.
        setCursor: (u) => {
          const left = u.cursor.left;
          const next =
            left != null && left >= 0
              ? (noteAt(view.notes, u.posToVal(left, "x"))?.index ?? null)
              : null;
          if (next === hovered) return;
          hovered = next;
          onHover?.(next);
          u.redraw();
        },

        // Behind the series: fills, gap bands, the gate.
        drawClear: (u) => {
          if (view.notes.length === 0) return;
          const f = frame(u);
          if (!f) return;
          const { ctx, left, right, top, bottom, ratio, theme } = f;

          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top, right - left, bottom - top);
          ctx.clip();

          // Gaps: a soft band so silence has a shape of its own.
          ctx.fillStyle = theme.grid;
          ctx.globalAlpha = 0.55;
          for (const gap of gaps) {
            const x0 = u.valToPos(gap.startSecs, "x", true);
            const x1 = u.valToPos(gap.endSecs, "x", true);
            if (x1 < left || x0 > right) continue;
            ctx.fillRect(x0, top, Math.max(1, x1 - x0), bottom - top);
          }
          ctx.globalAlpha = 1;

          // The gate that produced the segments, when it falls inside the view.
          const yScale = u.scales.y;
          if (
            typeof yScale.min === "number" &&
            typeof yScale.max === "number" &&
            view.threshold > yScale.min &&
            view.threshold < yScale.max
          ) {
            const y = Math.round(u.valToPos(view.threshold, "y", true)) + 0.5;
            ctx.strokeStyle = theme.axis;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = Math.max(1, ratio);
            ctx.setLineDash([2 * ratio, 3 * ratio]);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }

          // Note blocks: outer = peak, inner = RMS. The cap between them is the crest.
          for (const note of view.notes) {
            const x0 = u.valToPos(note.startSecs, "x", true);
            const x1 = u.valToPos(note.endSecs, "x", true);
            if (x1 < left || x0 > right) continue;
            const width = Math.max(1, x1 - x0);
            const peak = clamp(u.valToPos(note.peakDb, "y", true), top, bottom);
            const rms = clamp(u.valToPos(note.rmsDb, "y", true), top, bottom);
            ctx.fillStyle = theme.series;
            ctx.globalAlpha = 0.09;
            ctx.fillRect(x0, peak, width, bottom - peak);
            ctx.globalAlpha = 0.16;
            ctx.fillRect(x0, rms, width, bottom - rms);
          }

          ctx.restore();
        },

        // Over the series: rules, ruler, labels, hover.
        draw: (u) => {
          if (view.notes.length === 0) return;
          const f = frame(u);
          if (!f) return;
          const { ctx, left, right, top, bottom, ratio, theme } = f;
          const rulerH = SEGMENT_RULER_H * ratio;

          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top, right - left, bottom - top);
          ctx.clip();

          // Hover: a wash over the whole span, so the table row and the chart agree.
          const hoveredNote = hovered == null ? undefined : view.notes[hovered];
          if (hoveredNote) {
            const x0 = u.valToPos(hoveredNote.startSecs, "x", true);
            const x1 = u.valToPos(hoveredNote.endSecs, "x", true);
            ctx.globalAlpha = 0.07;
            ctx.fillStyle = theme.hover;
            ctx.fillRect(x0, top, Math.max(1, x1 - x0), bottom - top);
            ctx.globalAlpha = 1;
          }

          for (const [index, note] of view.notes.entries()) {
            const x0 = u.valToPos(note.startSecs, "x", true);
            const x1 = u.valToPos(note.endSecs, "x", true);
            if (x1 < left || x0 > right) continue;
            const width = Math.max(1, x1 - x0);

            // Peak (dashed) and RMS (solid) rules across the note.
            if (width >= 2 * ratio) {
              const peakY = Math.round(u.valToPos(note.peakDb, "y", true)) + 0.5;
              const rmsY = Math.round(u.valToPos(note.rmsDb, "y", true)) + 0.5;
              ctx.strokeStyle = theme.seriesMax;
              ctx.globalAlpha = 0.85;
              ctx.lineWidth = Math.max(1, ratio);
              ctx.setLineDash([3 * ratio, 3 * ratio]);
              ctx.beginPath();
              ctx.moveTo(x0, peakY);
              ctx.lineTo(x1, peakY);
              ctx.stroke();
              ctx.setLineDash([]);

              ctx.strokeStyle = theme.axis;
              ctx.globalAlpha = 0.8;
              ctx.lineWidth = Math.max(1.5, 2 * ratio);
              ctx.beginPath();
              ctx.moveTo(x0, rmsY);
              ctx.lineTo(x1, rmsY);
              ctx.stroke();
            }

            // The ruler: the note's extent, split by how much of it was voiced.
            const voiced = note.voicedFraction;
            const isReference = index === view.reference;
            ctx.fillStyle = isReference ? theme.reference : theme.series;
            if (voiced == null) {
              ctx.globalAlpha = UNMEASURED_ALPHA;
              ctx.fillRect(x0, top, width, rulerH);
            } else {
              const split = x0 + width * clamp(voiced, 0, 1);
              ctx.globalAlpha = 0.85;
              ctx.fillRect(x0, top, Math.max(1, split - x0), rulerH);
              ctx.globalAlpha = 0.28;
              ctx.fillRect(split, top, Math.max(1, x1 - split), rulerH);
            }
          }

          ctx.globalAlpha = 1;
          ctx.font = theme.font;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";

          // Note numbers above each peak, skipped when they would collide.
          const labelFloor = top + rulerH + NOTE_LABEL_TOP_GAP * ratio;
          let noteLabelRight = -Infinity;
          for (const [index, note] of view.notes.entries()) {
            if (note.envelopeDb.length === 0) continue;
            const x0 = u.valToPos(note.startSecs, "x", true);
            const x1 = u.valToPos(note.endSecs, "x", true);
            const width = x1 - x0;
            if (x1 < left || x0 > right || width < NOTE_LABEL_MIN_WIDTH * ratio) continue;
            const label = String(index + 1);
            const half = ctx.measureText(label).width / 2;
            const center = (x0 + x1) / 2;
            if (center - half < noteLabelRight + 4 * ratio || center + half > right) continue;
            noteLabelRight = center + half;

            const isReference = index === view.reference;
            ctx.globalAlpha = isReference ? 0.95 : 0.8;
            ctx.fillStyle = isReference ? theme.reference : theme.axis;
            const peakY = u.valToPos(Math.max(...note.envelopeDb), "y", true);
            ctx.fillText(label, center, Math.max(labelFloor, peakY - 5 * ratio));
          }

          // Gap durations, just above the annotation lane.
          const gapBaseline = bottom - NOTE_STRIP_H - 4 * ratio;
          let gapLabelRight = -Infinity;
          for (const gap of gaps) {
            const x0 = u.valToPos(gap.startSecs, "x", true);
            const x1 = u.valToPos(gap.endSecs, "x", true);
            const width = x1 - x0;
            if (x1 < left || x0 > right || width < GAP_LABEL_MIN_WIDTH * ratio) continue;
            const label = duration(gap.durationSecs);
            const half = ctx.measureText(label).width / 2;
            const center = (x0 + x1) / 2;
            if (center - half < gapLabelRight + 4 * ratio) continue;
            gapLabelRight = center + half;
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = theme.axis;
            ctx.fillText(label, center, gapBaseline);
          }
          ctx.globalAlpha = 1;

          // Hover edges last, so they read over the blocks.
          if (hoveredNote) {
            ctx.strokeStyle = theme.hover;
            ctx.globalAlpha = 0.75;
            ctx.lineWidth = Math.max(1, ratio);
            for (const x of [
              u.valToPos(hoveredNote.startSecs, "x", true),
              u.valToPos(hoveredNote.endSecs, "x", true),
            ]) {
              const px = Math.round(x) + 0.5;
              if (px < left || px > right) continue;
              ctx.beginPath();
              ctx.moveTo(px, top);
              ctx.lineTo(px, bottom);
              ctx.stroke();
            }
          }

          ctx.restore();
        },

        destroy: (u) => {
          if (pointerLeave) u.over.removeEventListener("pointerleave", pointerLeave);
          pointerLeave = undefined;
          dispose?.();
          onHover?.(null);
        },
      },
    };
  };

/** Clamp `value` into `[lo, hi]`. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** The canvas geometry + theme both draw passes start from. */
interface Frame {
  ctx: CanvasRenderingContext2D;
  left: number;
  right: number;
  top: number;
  bottom: number;
  ratio: number;
  theme: ReturnType<typeof chartTheme>;
}

function frame(u: uPlot): Frame | null {
  if (!u.ctx) return null;
  const { bbox } = u;
  return {
    ctx: u.ctx,
    left: bbox.left,
    right: bbox.left + bbox.width,
    top: bbox.top,
    bottom: bbox.top + bbox.height,
    ratio: uPlot.pxRatio || 1,
    theme: chartTheme(),
  };
}
