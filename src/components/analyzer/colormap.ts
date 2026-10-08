/**
 * Piecewise-linear perceptually ordered colormap (dark → blue → teal → gold →
 * white), shared by the spectrogram and the generic matrix heatmaps.
 */
export function spectroColormap(t: number): [number, number, number] {
  const stops: [number, number[]][] = [
    [0.0, [10, 16, 40]],
    [0.25, [34, 80, 160]],
    [0.5, [46, 160, 160]],
    [0.75, [230, 200, 60]],
    [1.0, [255, 255, 235]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  const last = stops[stops.length - 1][1];
  return [last[0], last[1], last[2]];
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
