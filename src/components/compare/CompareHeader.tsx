import { createSignal, onMount, Show } from "solid-js";
import Button from "../Button";
import SelectField from "../SelectField";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";
import { compareTargets, refreshCompareTargets, shapeLabel } from "../../state/compare/picker";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, MismatchDto } from "../../state/compare/types";

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
  onSwap: () => void;
  onReferenceChange: (label: string) => void;
  onRetry: () => void;
}) {
  // The picker's options are the live projects (refreshed when the header mounts).
  const [ready, setReady] = createSignal(false);
  onMount(() => void refreshCompareTargets().finally(() => setReady(true)));

  const options = () => {
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
  };

  const a = () => (props.swapped ? props.comparison.b : props.comparison.a);
  const b = () => (props.swapped ? props.comparison.a : props.comparison.b);
  const comparability = () => props.comparison.comparability;

  const badge = () => {
    if (!comparability().aligned) return { text: "Grids differ", cls: "warn" };
    if (comparability().filtersDiffer) return { text: "Filters differ", cls: "warn" };
    return { text: "Aligned", cls: "ok" };
  };

  /** The overlap line, when it differs from both windows (so it is worth naming). */
  const overlapNote = () => {
    const overlap = props.comparison.comparability.overlap;
    if (!overlap) return null;
    const same = (span: { start: number; end: number }) =>
      Math.abs(span.start - overlap.start) < 1e-6 && Math.abs(span.end - overlap.end) < 1e-6;
    const differs = !same(props.comparison.a.window) || !same(props.comparison.b.window);
    if (!differs) return null;
    return `Delta over the overlap ${overlap.start.toFixed(2)}–${overlap.end.toFixed(2)} s`;
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
        <Show when={ready() && options().length > 0}>
          <SelectField
            class="compare-reference-select"
            ariaLabel="Reference project"
            options={options()}
            value={props.reference}
            onChange={(value) => props.onReferenceChange(value)}
          />
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

      <Show when={overlapNote()}>{(text) => <div class="compare-overlap">{text()}</div>}</Show>
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
