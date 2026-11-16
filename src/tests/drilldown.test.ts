import { describe, expect, it } from "vitest";
import {
  candidateGrid,
  contributionGrid,
  drilldownOf,
  drilldownScale,
  frameProfile,
  nearestFrame,
  rateSnapshotAt,
} from "../components/analyzer/drilldown";
import type { SeriesResult } from "../state/analyzer";

/** A minimal calibrated series result with one optional drill-down payload. */
function series(payload: {
  contribution?: unknown;
  rateContribution?: unknown;
  candidates?: unknown;
  times: number[];
}): SeriesResult {
  return {
    tool: "roughness",
    sampleRate: 48_000,
    hopSize: 480,
    windowStart: 0,
    times: payload.times,
    values: payload.times.map(() => 0.5),
    minValue: 0,
    maxValue: 1,
    calibrated: true,
    calibrationDbSpl: 94,
    ...(payload.contribution ? { contribution: payload.contribution } : {}),
    ...(payload.rateContribution ? { rateContribution: payload.rateContribution } : {}),
    ...(payload.candidates ? { candidates: payload.candidates } : {}),
  } as unknown as SeriesResult;
}

const TIMES = [0, 1, 2, 3];

describe("contributionGrid", () => {
  it("normalises a frame-major contribution payload", () => {
    const grid = contributionGrid(
      series({
        times: TIMES,
        contribution: {
          frames: 4,
          bins: 2,
          times: TIMES,
          bands: [100, 200],
          values: [1, 2, 3, 4, 5, 6, 7, 8],
          label: "band modulation",
          unit: "asper",
        },
      }),
    );
    expect(grid).not.toBeNull();
    expect(grid!.frames).toBe(4);
    expect(grid!.rows).toBe(2);
    expect(grid!.rowLabel).toBe("band (Hz)");
    expect(grid!.unit).toBe("asper");
    expect(frameProfile(grid!, 2)).toEqual([5, 6]);
  });

  it("refuses an incomplete grid rather than inventing cells", () => {
    const result = series({
      times: TIMES,
      contribution: {
        frames: 4,
        bins: 2,
        times: TIMES,
        bands: [100, 200],
        values: [1, 2, 3],
        label: "band modulation",
        unit: null,
      },
    });
    expect(contributionGrid(result)).toBeNull();
  });

  it("is null for a tool without a contribution payload", () => {
    expect(contributionGrid(series({ times: TIMES }))).toBeNull();
  });
});

describe("candidateGrid", () => {
  it("derives the frame count from the frame-major values", () => {
    const grid = candidateGrid(
      series({
        times: TIMES,
        candidates: { bins: 2, freqs: [200, 400], values: [1, 0, 0.5, 0.5, 0, 1, 0.25, 0.75] },
      }),
    );
    expect(grid).not.toBeNull();
    expect(grid!.frames).toBe(4);
    expect(grid!.rows).toBe(2);
    expect(grid!.rowLabel).toBe("semitone (Hz)");
    expect(grid!.domain).toEqual([0, 1]);
    expect(frameProfile(grid!, 3)).toEqual([0.25, 0.75]);
  });

  it("refuses a grid longer than its time axis", () => {
    const grid = candidateGrid(
      series({
        times: [0, 1],
        candidates: { bins: 2, freqs: [200, 400], values: [1, 0, 0, 1, 1, 1] },
      }),
    );
    expect(grid).toBeNull();
  });
});

describe("drilldownOf", () => {
  it("prefers a contribution grid over a candidate grid", () => {
    const grid = drilldownOf(
      series({
        times: TIMES,
        contribution: {
          frames: 4,
          bins: 1,
          times: TIMES,
          bands: [100],
          values: [1, 2, 3, 4],
          label: "band modulation",
          unit: null,
        },
        candidates: { bins: 1, freqs: [200], values: [1, 1, 1, 1] },
      }),
    );
    expect(grid!.cellLabel).toBe("band modulation");
  });
});

describe("nearestFrame", () => {
  it("picks the closest column", () => {
    const grid = contributionGrid(
      series({
        times: TIMES,
        contribution: {
          frames: 4,
          bins: 1,
          times: TIMES,
          bands: [100],
          values: [1, 2, 3, 4],
          label: "band modulation",
          unit: null,
        },
      }),
    )!;
    expect(nearestFrame(grid, -10)).toBe(0);
    expect(nearestFrame(grid, 1.6)).toBe(2);
    expect(nearestFrame(grid, 99)).toBe(3);
  });
});

describe("drilldownScale", () => {
  it("spans zero to the largest cell (and clamps the ramp)", () => {
    const grid = contributionGrid(
      series({
        times: TIMES,
        contribution: {
          frames: 4,
          bins: 1,
          times: TIMES,
          bands: [100],
          values: [0, 1, 2, 4],
          label: "band modulation",
          unit: "asper",
        },
      }),
    )!;
    const scale = drilldownScale(grid);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(4);
    expect(scale.position(4)).toBe(1);
    expect(scale.position(-1)).toBe(0);
    // A square-root distribution: a quarter of the domain sits at the ramp's middle, so
    // a small share of a frame still gets a visible colour.
    expect(scale.position(1)).toBeCloseTo(0.5, 6);
    expect(scale.at(0.5)).toBeCloseTo(1, 6);
  });

  it("keeps a probability grid on 0…1", () => {
    const grid = candidateGrid(
      series({
        times: TIMES,
        candidates: { bins: 1, freqs: [200], values: [0.2, 0.4, 0.6, 0.8] },
      }),
    )!;
    const scale = drilldownScale(grid);
    expect(scale.max).toBe(1);
  });
});

describe("rateSnapshotAt", () => {
  const rate = {
    frames: 2,
    bands: 2,
    rates: 2,
    bandHz: [100, 200],
    rateHz: [4, 8],
    // frame 0: [[1, 2], [3, 4]]; frame 1: [[5, 6], [7, 8]]
    values: [1, 2, 3, 4, 5, 6, 7, 8],
  };

  it("slices one frame, band-major, with the whole grid's maximum", () => {
    const snapshot = rateSnapshotAt(series({ times: TIMES, rateContribution: rate }), 1);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.values).toEqual([5, 6, 7, 8]);
    expect(snapshot!.rates).toEqual([4, 8]);
    expect(snapshot!.bands).toEqual([100, 200]);
    expect(snapshot!.max).toBe(8);
  });

  it("is null outside the grid or without a rate spectrum", () => {
    const result = series({ times: TIMES, rateContribution: rate });
    expect(rateSnapshotAt(result, 2)).toBeNull();
    expect(rateSnapshotAt(series({ times: TIMES }), 0)).toBeNull();
  });
});
