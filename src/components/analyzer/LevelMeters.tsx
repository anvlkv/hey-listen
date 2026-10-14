import { For } from "solid-js";
import type { LevelsResult } from "../../state/analyzer";

/** dBFS positions of the scale ruler (loud → quiet). */
const SCALE = [0, -12, -24, -36, -48, -60];
const FLOOR = -60;

/** Map a dBFS value to a 0…100 % position on the meter (0 dBFS = full). */
function pct(db: number): number {
  const clamped = Math.max(FLOOR, Math.min(0, db));
  return ((clamped - FLOOR) / -FLOOR) * 100;
}

/**
 * Peak / RMS level meters (M11.A) for the `levels` tool: a dBFS-scaled bar per
 * value with a peak-hold marker, so the crest factor reads at a glance. Pure DOM —
 * the levels tool is the one place a *meter*, not a chart, is what the tool is. See
 * `docs/analysis-tools.md`.
 */
export default function LevelMeters(props: { result: LevelsResult }) {
  const rows = () => [
    { key: "peak", label: "Peak", db: props.result.peakDb, hold: props.result.peakDb },
    { key: "rms", label: "RMS", db: props.result.rmsDb, hold: props.result.peakDb },
  ];

  return (
    <div class="meters" data-testid="analyzer.meters">
      <For each={rows()}>
        {(row) => (
          <div class="meter-row">
            <span class="meter-label">{row.label}</span>
            <div class="meter-track">
              <span class="meter-mask" style={{ left: `${pct(row.db)}%` }} />
              <span class="meter-hold" style={{ left: `${pct(row.hold)}%` }} />
            </div>
            <span class="meter-value">{row.db.toFixed(1)} dBFS</span>
          </div>
        )}
      </For>
      <div class="meter-row meter-ruler">
        <span class="meter-label" />
        <div class="meter-track meter-track-ruler">
          <For each={SCALE}>
            {(db) => (
              <span class="meter-tick" style={{ left: `${pct(db)}%` }}>
                {db}
              </span>
            )}
          </For>
        </div>
        <span class="meter-value" />
      </div>
    </div>
  );
}
