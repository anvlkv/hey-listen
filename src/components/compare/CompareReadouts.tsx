import { For, Show } from "solid-js";
import { readoutsFor, type ReadoutResult } from "../analyzer/readouts";
import { shapeLabel } from "../../state/compare/picker";
import type { ComparisonDto, MismatchDto } from "../../state/compare/types";

/** Human names for the scalar fields a readout comparison reports. */
const FIELD_LABELS: Record<string, string> = {
  peak: "Peak",
  rms: "RMS",
  peakDb: "Peak (dB)",
  rmsDb: "RMS (dB)",
  lufs: "Integrated",
  lra: "LRA",
};

/** One field's value with the unit its key implies. */
function formatField(key: string, value: number): string {
  if (key.endsWith("Db")) return `${value.toFixed(2)} dB`;
  if (key === "lufs") return `${value.toFixed(1)} LUFS`;
  if (key === "lra") return `${value.toFixed(1)} LU`;
  return value.toFixed(4);
}

/** A signed delta with the field's unit. */
function formatDeltaField(key: string, value: number): string {
  const sign = value >= 0 ? "+" : "";
  if (key.endsWith("Db")) return `${sign}${value.toFixed(2)} dB`;
  if (key === "lufs" || key === "lra") return `${sign}${value.toFixed(1)}`;
  return `${sign}${value.toFixed(4)}`;
}

/**
 * The **readouts** compare view (M25): three columns — A, B and Δ — over a scalar
 * result (levels, integrated loudness, LRA). The canonical summaries sit above, so the
 * same numbers an agent reads are visible here. `Swap A/B` is display-only; the Δ
 * column flips sign.
 */
export default function CompareReadouts(props: { comparison: ComparisonDto; swapped: boolean }) {
  const fields = () =>
    props.comparison.diff?.kind === "scalar" ? props.comparison.diff.fields : [];
  const sideA = () => (props.swapped ? props.comparison.b : props.comparison.a);
  const sideB = () => (props.swapped ? props.comparison.a : props.comparison.b);

  const cards = (side: "a" | "b") => {
    const result = (side === "a" ? sideA() : sideB()).result;
    return result ? readoutsFor(result as ReadoutResult) : [];
  };

  return (
    <div class="compare-readouts">
      <div class="compare-summary">
        <div class="compare-summary-side">
          <div class="compare-summary-label">A · {sideA().project ?? "this project"}</div>
          <div class="compare-summary-text">{sideA().summary.text}</div>
          <div class="compare-summary-meta">{shapeLabel(sideA().source)}</div>
        </div>
        <div class="compare-summary-side">
          <div class="compare-summary-label">B · {sideB().project ?? "reference"}</div>
          <div class="compare-summary-text">{sideB().summary.text}</div>
          <div class="compare-summary-meta">{shapeLabel(sideB().source)}</div>
        </div>
      </div>

      <Show
        when={props.comparison.diff}
        fallback={<div class="analyzer-empty">{mismatchText(props.comparison)}</div>}
      >
        <table class="compare-table" data-testid="compare.readouts">
          <thead>
            <tr>
              <th>Field</th>
              <th>{props.swapped ? "B" : "A"}</th>
              <th>{props.swapped ? "A" : "B"}</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            <For each={fields()}>
              {(field) => (
                <tr>
                  <td class="compare-field">{FIELD_LABELS[field.key] ?? field.key}</td>
                  <td>{formatField(field.key, props.swapped ? field.b : field.a)}</td>
                  <td>{formatField(field.key, props.swapped ? field.a : field.b)}</td>
                  <td class="compare-delta">
                    {formatDeltaField(field.key, props.swapped ? -field.delta : field.delta)}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>

      <div class="compare-cards">
        <For each={["a", "b"] as const}>
          {(side) => (
            <div class={`compare-card-column ${side === "a" ? "side-a" : "side-b"}`}>
              <div class="compare-card-heading">{side === "a" ? "A" : "B"}</div>
              <For each={cards(side)}>
                {(spec) => (
                  <div class="readout-card" title={spec.title}>
                    <div class="readout-card-label">{spec.label}</div>
                    <div class="readout-card-value">{spec.value}</div>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/** The "why there is no delta" line, or the generic empty state. */
function mismatchText(comparison: ComparisonDto): string {
  if (comparison.comparability.mismatches.length === 0) {
    return "No comparable values in this window.";
  }
  return `No delta: ${comparison.comparability.mismatches.map(describeMismatch).join("; ")}.`;
}

function describeMismatch(mismatch: MismatchDto): string {
  return `${mismatch.key} ${formatValue(mismatch.a)} → ${formatValue(mismatch.b)}`;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join("–");
  if (value == null) return "—";
  return String(value);
}
