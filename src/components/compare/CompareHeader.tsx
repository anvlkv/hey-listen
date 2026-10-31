import { createMemo, createSignal, onMount, Show } from "solid-js";
import Button from "../Button";
import SelectField from "../SelectField";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";
import { compareTargets, refreshCompareTargets, shapeLabel } from "../../state/compare/picker";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, MismatchDto } from "../../state/compare/types";
import type { CompareTime } from "./time";

/**
 * A compare view's header (M25): the tab's title, both projects by name with their
 * source shape, the **comparability badge**, **Swap A/B** (display only), and the
 * reference picker. See `docs/comparison.md` → "The compare view".
 */
export default function CompareHeader(props: {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  swapped: boolean;
  reference: string;
  live: CompareLiveHandle;
  /** The relative display transform (M25.B). */
  time: CompareTime;
  /** Whether the family has a time axis (and so shows the fine-tune slider). */
  timeAxis: boolean;
  /** The fine-tune offset δ in seconds. */
  offset: number;
  onOffset: (seconds: number) => void;
  onSwap: () => void;
  onReferenceChange: (label: string) => void;
  onRetry: () => void;
}) {
  // The picker's options are the live projects (refreshed when the header mounts).
  const [ready, setReady] = createSignal(false);
  onMount(() => void refreshCompareTargets().finally(() => setReady(true)));

  // The reference select's options. Memoized so the array (and the option objects) keep
  // their identity between the view's frequent re-renders (the live poll), and so the
  // `keyed` Show below remounts the select only when the list really changed.
  const options = createMemo(() => {
    const targets = compareTargets().map((target) => ({
      value: target.label,
      label: `${target.name}${target.ready ? "" : " (no source)"}`,
    }));
    // A reference project that has since closed is no longer a target; keep it in the
    // list so the select shows the truth instead of silently switching to another.
    const known = targets.some((option) => option.value === props.reference);
    if (!known && props.reference) {
      return [{ value: props.reference, label: `${props.reference} (closed)` }, ...targets];
    }
    return targets;
  });

  const a = () => (props.swapped ? props.comparison.b : props.comparison.a);
  const b = () => (props.swapped ? props.comparison.a : props.comparison.b);
  const comparability = () => props.comparison.comparability;

  const badge = () => {
    if (!comparability().aligned) return { text: "Grids differ", cls: "warn" };
    if (comparability().filtersDiffer) return { text: "Filters differ", cls: "warn" };
    return { text: "Aligned", cls: "ok" };
  };

  /** The common-span line, when the relative windows do not line up exactly. */
  const spanNote = () => {
    if (!comparability().aligned) return null;
    const common = props.comparison.comparability.alignment.common;
    if (!common) return "The shifted windows do not meet — adjust the fine-tune offset";
    const start = props.time.delta(common.start);
    const end = props.time.delta(common.end);
    const extent = props.time.extent();
    if (start <= 1e-6 && end >= extent - 1e-6) return null;
    return `Delta over the common span ${start.toFixed(2)}–${end.toFixed(2)} s`;
  };

  return (
    <header class="compare-header" data-testid="compare.header">
      <div class="compare-title">
        <div class="compare-title-tool">
          Compare: {analyzerById(props.tool).title}
          <span class="compare-title-sep"> — </span>
          <span class="compare-project side-a">{a().project ?? "this project"}</span>
          <span class="compare-title-sep"> ↔ </span>
          <span class="compare-project side-b">{b().project ?? props.reference}</span>
        </div>
        <div class="compare-title-meta">
          <span class="compare-shape">{shapeLabel(a().source)}</span>
          <span class="compare-title-sep">↔</span>
          <span class="compare-shape">{shapeLabel(b().source)}</span>
        </div>
      </div>

      <div class="compare-tools">
        <span
          class={`compare-badge ${badge().cls}`}
          data-testid="compare.badge"
          title={mismatchTitle(comparability().mismatches)}
        >
          {badge().text}
        </span>
        <Show when={!props.live.open()}>
          <span class="compare-badge closed" data-testid="compare.peer-closed">
            Reference closed
          </span>
        </Show>
        {/* Remounted (`keyed`) when the target list changes: an in-place `options` update
            makes Kobalte's list state and selection invalidate each other until the stack
            overflows — which aborts the update that caused it (the reference picker,
            M25) — while a fresh mount settles. */}
        <Show when={ready() && options().length > 0 ? options() : null} keyed>
          {(list) => (
            <SelectField
              class="compare-reference-select"
              ariaLabel="Reference project"
              options={list}
              value={props.reference}
              onChange={(value) => props.onReferenceChange(value)}
            />
          )}
        </Show>
        <Show when={!props.live.open()}>
          <Button class="compare-btn" onClick={props.onRetry}>
            Retry
          </Button>
        </Show>
        <Button class="compare-btn" data-testid="compare.swap" onClick={props.onSwap}>
          Swap A/B
        </Button>
      </div>

      <Show when={props.timeAxis}>
        <div class="compare-offset" data-testid="compare.offset.row">
          <span class="compare-offset-label">Fine-tune B</span>
          <input
            class="compare-offset-slider"
            data-testid="compare.offset"
            type="range"
            min="-1"
            max="1"
            step="0.001"
            value={props.offset}
            aria-label="Fine-tune B"
            onInput={(event) => props.onOffset(Number(event.currentTarget.value))}
          />
          <span class="compare-offset-value" data-testid="compare.offset.value">
            {props.offset >= 0 ? "+" : ""}
            {(props.offset * 1000).toFixed(0)} ms
          </span>
          <Button
            class="compare-btn compare-offset-reset"
            data-testid="compare.offset.reset"
            onClick={() => props.onOffset(0)}
          >
            Reset
          </Button>
        </div>
      </Show>

      <Show when={spanNote()}>
        {(text) => (
          <div class="compare-overlap" data-testid="compare.span">
            {text()}
          </div>
        )}
      </Show>
    </header>
  );
}

/** A badge tooltip listing every differing setting, with both values. */
function mismatchTitle(mismatches: MismatchDto[]): string {
  if (mismatches.length === 0) return "The two results share a grid, so B − A is computed.";
  return mismatches
    .map((mismatch) => `${mismatch.key}: ${formatValue(mismatch.a)} → ${formatValue(mismatch.b)}`)
    .join("\n");
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join("–");
  if (value == null) return "—";
  return String(value);
}
