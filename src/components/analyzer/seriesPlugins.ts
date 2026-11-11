import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { AnalyzerBus } from "../../state/chartSync";
import { noteName } from "../../state/analyzer/format";
import { chartTheme } from "../../state/themes";
import { reactiveData } from "./verticalMarkers";

/**
 * Plugins for the generic [`SeriesView`](./SeriesView.tsx) (M11.A) and the linked
 * waveform half of [`SignalDiagnostic`](./SignalDiagnostic.tsx) (M36): a horizontal
 * reference line (a target such as −14 LUFS, or a 0 dBFS ceiling), a semitone grid for
 * pitch tracks on a log-frequency y-axis, and full-scale clipping marks. Every plugin
 * reads `chartTheme()` inside the draw hook, so a theme switch is picked up on the next
 * redraw.
 */

/**
 * A dashed horizontal line at `value` on a named y-scale (default `"y"`), with a small
 * left label. The scale is explicit so a reliability threshold can sit on a
 * right-hand `y2` axis (a confidence track) without touching the level axis.
 */
export const referenceLine =
  (spec: { value: number; label: string }, scale = "y"): UplotPluginFactory<AnalyzerBus> =>
  () => ({
    hooks: {
      draw: (u) => {
        if (!u.ctx) return;
        const y = u.valToPos(spec.value, scale, true);
        if (!Number.isFinite(y) || y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;
        const { ctx, bbox } = u;
        ctx.save();
        ctx.strokeStyle = chartTheme().reference;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        const py = Math.round(y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(bbox.left, py);
        ctx.lineTo(bbox.left + bbox.width, py);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = chartTheme().font;
        ctx.fillStyle = chartTheme().reference;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(spec.label, bbox.left + 6, py - 3);
        ctx.restore();
      },
    },
  });

/** Semitones visible before the grid thins to the C/E/G rules. */
const SEMITONE_ALL = 24;
/** Semitones visible before the octave-C labels are dropped. */
const SEMITONE_LABELS = 36;

/**
 * Faint gridlines at semitone frequencies across the visible y-range (Hz).
 *
 * Meaningful on a log-frequency axis (`SeriesView` `yScale: "log"`), where semitones
 * are evenly spaced, so a pitch track reads like a piano roll. When the visible range
 * is narrow enough, every semitone is ruled and the octave Cs are labelled with their
 * note name; a wide view thins to C/E/G to stay legible.
 */
export const semitoneGrid = (): UplotPluginFactory<AnalyzerBus> => () => ({
  hooks: {
    draw: (u) => {
      if (!u.ctx) return;
      const scale = u.scales.y;
      if (typeof scale.min !== "number" || typeof scale.max !== "number") return;
      if (!(scale.min > 0) || !(scale.max > scale.min)) return;
      const { ctx, bbox } = u;
      const top = bbox.top;
      const bottom = bbox.top + bbox.height;
      // MIDI note index range visible on the axis (A4 = 69 = 440 Hz).
      const midiLo = Math.floor(69 + 12 * Math.log2(scale.min / 440));
      const midiHi = Math.ceil(69 + 12 * Math.log2(scale.max / 440));
      const visibleSemitones = midiHi - midiLo;
      const everySemitone = visibleSemitones <= SEMITONE_ALL;
      const labelled = visibleSemitones <= SEMITONE_LABELS;

      ctx.save();
      ctx.strokeStyle = chartTheme().gridFaint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let midi = midiLo; midi <= midiHi; midi++) {
        const pitchClass = ((midi % 12) + 12) % 12;
        if (!everySemitone && pitchClass !== 0 && pitchClass !== 4 && pitchClass !== 7) continue;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const y = u.valToPos(freq, "y", true);
        if (!Number.isFinite(y) || y < top || y > bottom) continue;
        const px = Math.round(y) + 0.5;
        ctx.moveTo(bbox.left, px);
        ctx.lineTo(bbox.left + bbox.width, px);
      }
      ctx.stroke();

      if (labelled) {
        ctx.fillStyle = chartTheme().axis;
        ctx.font = chartTheme().font;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        for (let midi = midiLo; midi <= midiHi; midi++) {
          if (((midi % 12) + 12) % 12 !== 0) continue;
          const freq = 440 * Math.pow(2, (midi - 69) / 12);
          const y = u.valToPos(freq, "y", true);
          if (!Number.isFinite(y) || y < top || y > bottom) continue;
          ctx.fillText(noteName(freq), bbox.left + 4, y - 2);
        }
      }
      ctx.restore();
    },
  },
});

/** The ring radius (px) that marks an octave-ambiguous f0 frame. */
const AMBIGUOUS_RING_RADIUS = 4;

/**
 * Ring the primary track's points where the detector flags an **octave-ambiguous**
 * frame (M36): the f0 estimate has a comparable candidate an octave away, so the line
 * alone would look more certain than the result is.
 *
 * The flags are parallel to the x column and only pYIN reports them, so an absent (or
 * all-false) list draws nothing and YIN/autocorrelation are unchanged. Positions come
 * from the chart's own scales, so the rings follow zoom and pan; `reactiveData`
 * repaints them when a new result arrives without rebuilding the chart.
 */
export const octaveAmbiguityMarks =
  (getFlags: () => boolean[] | null): UplotPluginFactory<AnalyzerBus> =>
  () => {
    const flags = reactiveData(getFlags, null as boolean[] | null);
    return {
      hooks: {
        ready: flags.ready,
        draw: (u) => {
          const marked = flags.current();
          const xs = u.data[0];
          const ys = u.data[1];
          if (!marked || !xs || !ys || !u.ctx) return;
          const { ctx, bbox } = u;
          const right = bbox.left + bbox.width;
          const bottom = bbox.top + bbox.height;
          ctx.save();
          ctx.strokeStyle = chartTheme().markerBeat;
          ctx.lineWidth = 1.5;
          let lastX = -Infinity;
          for (let i = 0; i < marked.length && i < xs.length; i++) {
            if (!marked[i]) continue;
            const value = ys[i];
            if (typeof value !== "number" || !Number.isFinite(value)) continue;
            const x = u.valToPos(xs[i], "x", true);
            const y = u.valToPos(value, "y", true);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            if (x < bbox.left || x > right || y < bbox.top || y > bottom) continue;
            // One ring per few pixels: a dense ambiguous stretch reads as a band, not a blur.
            if (x - lastX < AMBIGUOUS_RING_RADIUS) continue;
            lastX = x;
            ctx.beginPath();
            ctx.arc(x, y, AMBIGUOUS_RING_RADIUS, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        },
        destroy: flags.destroy,
      },
    };
  };

/** The waveform columns the clipping plugin reads (source seconds + the envelope). */
export interface ClippingColumns {
  xs: readonly number[];
  /** The positive peak envelope (linear amplitude). */
  max: readonly number[];
  /** The negative peak envelope (linear amplitude). */
  min: readonly number[];
}

/**
 * Mark the buckets that reach **full scale** (`max >= 1` or `min <= -1`): a short tick
 * against the plot's top and bottom edges, placed through `u.valToPos()` so the marks
 * follow zoom, pan and a data refresh. One mark per pixel column at most, so a fully
 * clipped stretch reads as a band rather than a thicket. `WaveformResult.clippedBuckets`
 * carries the count for a readout.
 */
export const clippingMarks =
  (columns: () => ClippingColumns | null): UplotPluginFactory<AnalyzerBus> =>
  () => ({
    hooks: {
      draw: (u) => {
        const data = columns();
        if (!data || !u.ctx) return;
        const count = Math.min(data.xs.length, data.max.length, data.min.length);
        if (count === 0) return;
        const { ctx, bbox } = u;
        const bottom = bbox.top + bbox.height;
        ctx.save();
        // The peak colour: clipping is a property of the peak the chart already draws.
        ctx.strokeStyle = chartTheme().seriesMax;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let lastX = -Infinity;
        for (let i = 0; i < count; i++) {
          const positive = data.max[i] >= 1;
          const negative = data.min[i] <= -1;
          if (!positive && !negative) continue;
          const x = u.valToPos(data.xs[i], "x", true);
          if (!Number.isFinite(x) || x < bbox.left || x > bbox.left + bbox.width) continue;
          if (x - lastX < 1) continue;
          lastX = x;
          const px = Math.round(x) + 0.5;
          if (positive) {
            ctx.moveTo(px, bbox.top);
            ctx.lineTo(px, bbox.top + 4);
          }
          if (negative) {
            ctx.moveTo(px, bottom);
            ctx.lineTo(px, bottom - 4);
          }
        }
        ctx.stroke();
        ctx.restore();
      },
    },
  });
