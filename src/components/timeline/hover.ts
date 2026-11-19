import { batch, createSignal, type Accessor } from "solid-js";
import { chartTheme } from "../../state/themes";
import { RULER_H } from "./constants";

/**
 * The Timeline's **hover crosshair** (D-01): while the pointer is over the waveform a
 * dashed vertical rule follows it, and a compact chip in the move-bar band at the top of
 * the waveform reads the hovered time (`m:ss.mmm`) and its sample index. `interaction.ts`
 * writes the hover through `setHover` / `clear`, `draw.ts` paints it once per repaint, and
 * the two formatters are pure so they unit-test without a DOM.
 *
 * The chip and dash geometry lives here rather than in `constants.ts`: only this module
 * draws the readout, so `constants.ts` keeps the geometry the drawing **and** the pointer
 * handling share.
 */

/** The chip's height (CSS px): fits 10 px text inside the move-bar band at the wave top. */
export const HOVER_CHIP_H = 14;
/** Horizontal padding between the chip's edge and its text. */
export const HOVER_CHIP_PAD = 5;
/** Gap between the crosshair (or the canvas edge) and the chip. */
export const HOVER_CHIP_GAP = 6;
/** Chip text: small and slightly heavier so it reads over the waveform in any theme. */
export const HOVER_FONT = "500 10px Inter, sans-serif";
/** The crosshair's dash pattern — the same 4/4 the chart-cursor mirror (`mirror`) uses. */
export const HOVER_DASH = [4, 4];

/** `m:ss.mmm`, clamped at zero, or `—` for a non-finite time. */
export function formatHoverTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  // Whole milliseconds first, so 59.9999 reads `1:00.000` rather than `0:60.000`.
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const minutes = Math.floor(ms / 60_000);
  const rest = ms - minutes * 60_000;
  return `${minutes}:${(rest / 1000).toFixed(3).padStart(6, "0")}`;
}

/** The sample index at `seconds`: `Math.round(seconds * sampleRate)`, grouped (`1,234`). */
export function formatSampleIndex(seconds: number, sampleRate: number): string {
  if (!Number.isFinite(seconds) || !Number.isFinite(sampleRate)) return "—";
  return Math.round(Math.max(0, seconds) * sampleRate).toLocaleString("en-US");
}

/** What `drawHover` needs: the pointer x, the time it points at, and the canvas box. */
export interface HoverDrawOptions {
  /** Pointer x, in CSS pixels: the rule's x and the chip's anchor. */
  x: number;
  /** Hovered source time, in seconds. */
  time: number;
  /** The source's sample rate, for the sample index. */
  sampleRate: number;
  /** Canvas width (CSS px): the chip is kept inside it. */
  width: number;
  /** Canvas height (CSS px): where the rule stops. */
  height: number;
}

/**
 * Paint the hover: a 1 px dashed rule in the theme's `hover` role from the ruler to the
 * canvas bottom, plus the time/sample readout chip anchored in the move-bar band (it starts
 * at `RULER_H`, so it never covers the ruler labels) and clamped inside the canvas.
 */
export function drawHover(ctx: CanvasRenderingContext2D, opts: HoverDrawOptions): void {
  const { x, time, sampleRate, width, height } = opts;
  const theme = chartTheme();
  const px = Math.round(x) + 0.5;

  ctx.save();
  ctx.strokeStyle = theme.hover;
  ctx.lineWidth = 1;
  ctx.setLineDash(HOVER_DASH);
  ctx.beginPath();
  ctx.moveTo(px, RULER_H);
  ctx.lineTo(px, height);
  ctx.stroke();
  ctx.restore();

  const label = `${formatHoverTime(time)} · #${formatSampleIndex(time, sampleRate)}`;
  ctx.save();
  ctx.font = HOVER_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const chipW = Math.ceil(ctx.measureText(label).width) + HOVER_CHIP_PAD * 2;
  // Beside the pointer normally, flipped to its left near the right edge, then clamped — so
  // it follows the pointer without ever running off the canvas.
  const maxLeft = Math.max(HOVER_CHIP_GAP, width - HOVER_CHIP_GAP - chipW);
  let left = x + HOVER_CHIP_GAP;
  if (left > maxLeft) left = x - HOVER_CHIP_GAP - chipW;
  left = Math.min(Math.max(HOVER_CHIP_GAP, left), maxLeft);
  // An opaque `surface` fill keeps the chip legible over the waveform in any theme; the
  // quiet `axis` border separates it from the move bar's fill underneath.
  ctx.fillStyle = theme.surface;
  ctx.fillRect(left, RULER_H, chipW, HOVER_CHIP_H);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = theme.axis;
  ctx.strokeRect(left + 0.5, RULER_H + 0.5, chipW - 1, HOVER_CHIP_H - 1);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.handleLabel;
  ctx.fillText(label, left + HOVER_CHIP_PAD, RULER_H + HOVER_CHIP_H / 2 + 0.5);
  ctx.restore();
}

/** The Timeline's hover state: the hovered source time (or `null`) and the pointer x. */
export interface TimelineHover {
  /** The hovered time in source seconds, or `null` when the pointer is not over the waveform. */
  hoverTime: Accessor<number | null>;
  /** The pointer x (CSS px) the crosshair and its readout chip follow. */
  hoverX: Accessor<number>;
  /** Record a hover; a `null` time means "in the lane", where nothing is drawn. */
  setHover: (time: number | null, x: number) => void;
  /** Drop the hover: the pointer left the canvas or a gesture took it over. */
  clear: () => void;
}

/** The two signals behind the crosshair, written by `interaction.ts` in one batch per move. */
export function createHover(): TimelineHover {
  const [hoverTime, setHoverTime] = createSignal<number | null>(null);
  const [hoverX, setHoverX] = createSignal(0);
  return {
    hoverTime,
    hoverX,
    setHover: (time, x) =>
      batch(() => {
        setHoverTime(time);
        setHoverX(x);
      }),
    clear: () =>
      batch(() => {
        setHoverTime(null);
        setHoverX(0);
      }),
  };
}
