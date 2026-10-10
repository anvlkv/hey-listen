import { For, Show } from "solid-js";
import { readoutsFor, type ReadoutResult } from "./readouts";
import { NoAudioState } from "./chartCommon";
import type { AnalysisHandle, AnyAnalysisResult } from "../../state/analyzer";

/**
 * Readout-only analyzer view (M5): for tools with a single scalar result (levels,
 * tempo, integrated loudness, loudness range) the body is just the labeled values —
 * no chart. See `docs/analysis-tools.md`.
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
