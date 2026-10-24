import { For, createSignal, Show } from "solid-js";
import { NoAudioState } from "./chartCommon";
import NoteSegmentChart from "./NoteSegmentChart";
import {
  cents,
  duration,
  hz,
  level,
  percent,
  periodicity,
  relative,
  span,
  spread,
} from "./noteMetricsFormat";
import type {
  AnalysisHandle,
  AnyAnalysisResult,
  AnalyzerId,
  NoteMetricsResult,
} from "../../state/analyzer";

/**
 * The `noteMetrics` view (M18): summary cards, a segment chart, and a scrollable
 * per-note table.
 *
 * These are **detected audio note segments** — not the project's user-authored
 * annotations (`docs/notes.md`). The chart places every note on the source timeline
 * (its own envelope, with the gaps left empty); the table is the detail: start/end,
 * the silence around each note, its level, its level against the loudest note, plus
 * the M19 voice-quality **proxies** (voicing, f0, jitter, shimmer, HNR) where the
 * note is long enough to measure them.
 */
export default function NoteMetricsView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const result = () => props.analysis.result() as NoteMetricsResult | null;
  /** The note under the chart's pointer, so its table row is easy to find. */
  const [hovered, setHovered] = createSignal<number | null>(null);

  return (
    <Show when={result()} fallback={<NoAudioState />}>
      {(value) => (
        <div class="analyzer-chart note-metrics" data-testid="analyzer.noteMetrics">
          <div class="readout-cards note-metrics-summary">
            <div class="readout-card">
              <div class="readout-card-label">Notes</div>
              <div class="readout-card-value" data-testid="noteMetrics.count">
                {value().noteCount}
              </div>
            </div>
            <div class="readout-card">
              <div class="readout-card-label">Gaps</div>
              <div class="readout-card-value">{value().gapCount}</div>
            </div>
            <div class="readout-card">
              <div class="readout-card-label">Total gap</div>
              <div class="readout-card-value">{duration(value().totalGapSecs)}</div>
            </div>
            <div class="readout-card">
              <div class="readout-card-label">Longest gap</div>
              <div class="readout-card-value">{duration(value().longestGapSecs)}</div>
            </div>
            <div class="readout-card">
              <div class="readout-card-label">Median note</div>
              <div class="readout-card-value">{duration(value().medianNoteSecs)}</div>
            </div>
            <div class="readout-card">
              <div class="readout-card-label">Median gap</div>
              <div class="readout-card-value">{duration(value().medianGapSecs)}</div>
            </div>
            <div class="readout-card" title="The gate actually used">
              <div class="readout-card-label">Gate</div>
              <div class="readout-card-value">{value().thresholdDb.toFixed(1)} dBFS</div>
            </div>
          </div>

          <Show
            when={value().notes.length > 0}
            fallback={
              <div class="analyzer-empty" data-testid="noteMetrics.empty">
                No notes detected in this window — lower <strong>Gate</strong>, make{" "}
                <strong>Gate floor</strong> more negative, or use a longer window.
              </div>
            }
          >
            <NoteSegmentChart id={props.id} result={result} onHover={setHovered} />

            <div class="note-metrics-scroll">
              <table class="note-metrics-table" data-testid="noteMetrics.table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Duration</th>
                    <th>Gap before</th>
                    <th>Gap after</th>
                    <th>RMS</th>
                    <th>Peak</th>
                    <th>Δ RMS</th>
                    <th>Δ peak</th>
                    <th title="Share of the note's own pitch frames with a detected pitch">
                      Voiced
                    </th>
                    <th title="Median fundamental over the note's voiced frames">f0</th>
                    <th title="Jitter proxy: spread of the detrended f0 track in cents — not clinical jitter">
                      Jitter
                    </th>
                    <th title="Shimmer proxy: spread of the note's frame RMS in dB — not clinical shimmer">
                      Shimmer
                    </th>
                    <th title="HNR proxy: mean 0–1 autocorrelation periodicity — not HNR in dB">
                      HNR
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={value().notes}>
                    {(note, index) => (
                      <tr
                        classList={{
                          "is-reference": index() === value().referenceNoteIndex,
                          "is-hovered": index() === hovered(),
                        }}
                        data-testid={`noteMetrics.row.${index()}`}
                      >
                        <td>{index() + 1}</td>
                        <td>{span(note.startSecs)}</td>
                        <td>{span(note.endSecs)}</td>
                        <td>{duration(note.durationSecs)}</td>
                        <td>{duration(note.gapBeforeSecs)}</td>
                        <td>{duration(note.gapAfterSecs)}</td>
                        <td>{level(note.rmsDb)}</td>
                        <td>{level(note.peakDb)}</td>
                        <td>{relative(note.rmsDbRelLoudest)}</td>
                        <td>{relative(note.peakDbRelLoudest)}</td>
                        <td>{percent(note.voicedFraction)}</td>
                        <td>{hz(note.f0MedianHz)}</td>
                        <td>{cents(note.jitterProxyCents)}</td>
                        <td>{spread(note.shimmerProxyDb)}</td>
                        <td>{periodicity(note.hnrProxy)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
