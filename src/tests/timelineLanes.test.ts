import { expect, it } from "vitest";
import {
  drawWaveformLanes,
  laneAtY,
  type WaveformLanes,
} from "../components/timeline/waveformLanes";

/**
 * The Timeline's **lane painting** (M41 follow-up): the source lanes are the background and
 * a filter graph's output lanes are painted over them, one row each. The full canvas is an
 * E2E/screenshot concern; these checks pin the geometry that decides *which row* a lane
 * lands on and how a lane that is not the analysis pick is dulled.
 *
 * ```sh
 * npm run test:unit
 * ```
 */

/** One recorded stroke: its style, width, alpha and the y values it drew. */
interface Stroke {
  style: string;
  width: number;
  alpha: number;
  ys: number[];
}

/** A canvas 2D stand-in that records strokes instead of painting them. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; strokes: Stroke[] } {
  const strokes: Stroke[] = [];
  let ys: number[] = [];
  const ctx = {
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    beginPath() {
      ys = [];
    },
    moveTo(_x: number, y: number) {
      ys.push(y);
    },
    lineTo(_x: number, y: number) {
      ys.push(y);
    },
    stroke() {
      strokes.push({
        style: String(ctx.strokeStyle),
        width: ctx.lineWidth,
        alpha: ctx.globalAlpha,
        ys: [...ys],
      });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

/** Two 0.5 samples in two interleaved channels, drawn over three lane rows. */
const LANES: WaveformLanes = {
  top: 10,
  height: 300,
  left: 0,
  right: 2,
  rows: 3,
  samples: new Float32Array([0.5, 0.5, 0.5, 0.5]),
  frames: 2,
  channels: 2,
  sampleRate: 1,
  peaks: [],
};

/** The y band a lane row occupies (the area split equally between the rows). */
const band = (row: number) => {
  const laneH = LANES.height / LANES.rows;
  return [LANES.top + laneH * row, LANES.top + laneH * (row + 1)];
};

it("draws each channel in its own row of the lane area", () => {
  const { ctx, strokes } = fakeCtx();
  drawWaveformLanes(ctx, LANES, { wave: "#111", active: "mix" }, (x) => x);

  // Only the two channels the buffer has: the third row stays for a filter output.
  const envelopes = strokes.filter((stroke) => stroke.style === "#111");
  expect(envelopes).toHaveLength(2);
  envelopes.forEach((stroke, row) => {
    const [low, high] = band(row);
    expect(Math.min(...stroke.ys)).toBeGreaterThanOrEqual(low);
    expect(Math.max(...stroke.ys)).toBeLessThanOrEqual(high);
  });
});

it("draws a centre line on every row, including an empty one", () => {
  const { ctx, strokes } = fakeCtx();
  drawWaveformLanes(ctx, LANES, { wave: "#111", midline: "#222", active: "mix" }, (x) => x);

  // One stroke for all rows (`rows` is 3), two points each, one lane-height apart.
  expect(strokes[0].style).toBe("#222");
  expect(strokes[0].ys).toHaveLength(6);
  const laneH = LANES.height / LANES.rows;
  expect(strokes[0].ys[1] - strokes[0].ys[0]).toBeCloseTo(0);
  expect(strokes[0].ys[2] - strokes[0].ys[0]).toBeCloseTo(laneH);
});

it("cases an overlaid pass and dulls a lane that is not the analysis pick", () => {
  const { ctx, strokes } = fakeCtx();
  drawWaveformLanes(ctx, LANES, { wave: "#f80", casing: "#000", active: 0 }, (x) => x);

  // Per channel: a wide casing, then the waveform on top of it.
  const casing = strokes.filter((stroke) => stroke.style === "#000");
  const waves = strokes.filter((stroke) => stroke.style === "#f80");
  expect(casing).toHaveLength(2);
  expect(waves).toHaveLength(2);
  expect(casing.every((stroke) => stroke.width > 1)).toBe(true);
  expect(waves.every((stroke) => stroke.width === 1)).toBe(true);

  // The picked lane draws at full strength, the other one is slightly dull.
  expect(waves[0].alpha).toBe(1);
  expect(waves[1].alpha).toBeGreaterThan(0);
  expect(waves[1].alpha).toBeLessThan(1);
});

it("splits the lanes into as many rows as asked, whatever the channel count", () => {
  // A filter graph may declare more outputs than the source has channels.
  expect(laneAtY(10, 10, 300, 3)).toBe(0);
  expect(laneAtY(160, 10, 300, 3)).toBe(1);
  expect(laneAtY(305, 10, 300, 3)).toBe(2);
  expect(laneAtY(5, 10, 300, 3)).toBeNull();
});
