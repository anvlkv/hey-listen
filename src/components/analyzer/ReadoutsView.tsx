import { For, Show } from "solid-js";
import { readoutsFor, type ReadoutResult } from "./readouts";
import LevelMeters from "./LevelMeters";
import { NoAudioState } from "./chartCommon";
import type { AnalysisHandle, AnyAnalysisResult, LevelsResult } from "../../state/analyzer";

/**
 * Readout-only analyzer view (M5): for tools with a single scalar result (levels,
 * tempo, integrated loudness, loudness range) the body is just the labeled values —
 * no chart. The `levels` tool also draws peak / RMS meter bars (M11.A). See
 * `docs/analysis-tools.md`.
 */
export default function ReadoutsView(props: {
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const result = () => props.analysis.result();
  return (
    <Show
      when={result()}
      fallback={<NoAudioState />}
    >
      {(value) => (
        <div class="analyzer-chart">
          <Show when={value().tool === "levels"}>
            <LevelMeters result={value() as LevelsResult} />
          </Show>
          <div class="readout-cards">
            <For each={readoutsFor(value() as ReadoutResult)}>
              {(spec) => (
                <div class="readout-card" title={spec.title}>
                  <div class="readout-card-label">{spec.label}</div>
                  <div class="readout-card-value">{spec.value}</div>
                </div>
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}
