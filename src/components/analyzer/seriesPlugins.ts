import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { AnalyzerBus } from "../../state/chartSync";
import { chartTheme } from "../../state/themes";

/**
 * Plugins for the generic [`SeriesView`](./SeriesView.tsx) (M11.A): a horizontal
 * reference line (a target such as −14 LUFS, or a 0 dBFS ceiling) and a semitone
 * grid for pitch tracks on a log-frequency y-axis. Both read `chartTheme()` inside
 * the draw hook, so a theme switch is picked up on the next redraw.
 */

/** A dashed horizontal line at `value` on the y-scale, with a small left label. */
export const referenceLine = (spec: {
  value: number;
  label: string;
}): UplotPluginFactory<AnalyzerBus> => () => ({
  hooks: {
    draw: (u) => {
      if (!u.ctx) return;
      const y = u.valToPos(spec.value, "y", true);
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

/**
 * Faint gridlines at the C / E / G semitone frequencies across the visible
 * y-range (Hz). Meaningful on a log-frequency axis (see `SeriesView` `yScale:
 * "log"`), where semitones are evenly spaced, so a pitch track reads like a
 * piano roll.
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
      ctx.save();
      ctx.strokeStyle = chartTheme().grid;
      ctx.lineWidth = 1;
      // MIDI note index range visible on the axis (A4 = 69 = 440 Hz). C=0, E=4, G=7.
      const midiLo = Math.floor(69 + 12 * Math.log2(scale.min / 440));
      const midiHi = Math.ceil(69 + 12 * Math.log2(scale.max / 440));
      for (let midi = midiLo; midi <= midiHi; midi++) {
        const pitchClass = ((midi % 12) + 12) % 12;
        if (pitchClass !== 0 && pitchClass !== 4 && pitchClass !== 7) continue;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const y = u.valToPos(freq, "y", true);
        if (!Number.isFinite(y) || y < top || y > bottom) continue;
        const py = Math.round(y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(bbox.left, py);
        ctx.lineTo(bbox.left + bbox.width, py);
        ctx.stroke();
      }
      ctx.restore();
    },
  },
});
