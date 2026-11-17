import { createMemo, createSignal, onMount, Show } from "solid-js";
import type { SavedComparisonInfo } from "../../bindings/SavedComparisonInfo";
import Button from "../Button";
import SelectField from "../SelectField";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";
import {
  compareTargets,
  refreshCompareTargets,
  showCompareNotice,
} from "../../state/compare/picker";
import { fetchSaved, showReference } from "../../state/compare/views";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { CompareBinding } from "../../state/compare/views";
import type { CompareSideDto, ComparisonDto, MismatchDto, Span } from "../../state/compare/types";
import { compareSideColor } from "./palette";
import type { CompareTime } from "./time";

/** The select value that reconnects the compare view to the project's saved snapshot. */
const SAVED_VALUE = "__saved__";

/**
 * A compare view's header (M25; saved references in M25.C): the tab's title, both
 * projects by name with their source shape, the **comparability badge**, the fine-tune
 * offset δ, and the reference picker. See `docs/comparison.md` → "The compare view".
 */
export default function CompareHeader(props: {
  /** The comparison's stable id (addresses its saved snapshot when the reference is saved). */
  id: string;
  tool: AnalyzerId;
  comparison: ComparisonDto;
  /** The live project label, or the saved reference's name. */
  reference: string;
  /** Whether `reference` names the project's saved snapshot (M25.C). */
  saved: boolean;
  live: CompareLiveHandle;
  /** The relative display transform (M25.B). */
  time: CompareTime;
  /** Whether the family has a time axis (and so shows the fine-tune slider). */
  timeAxis: boolean;
  /** The fine-tune offset δ in seconds. */
  offset: number;
  onOffset: (seconds: number) => void;
  onBindingChange: (binding: CompareBinding) => void;
  onRetry: () => void;
}) {
  // The picker's options are the live projects (refreshed when the header mounts), plus
  // this tool's latest saved comparison. Several saved comparisons may exist; the full
  // picker (tab menu / toolbar) lists them all.
  const [ready, setReady] = createSignal(false);
  const [savedInfo, setSavedInfo] = createSignal<SavedComparisonInfo[]>([]);
  onMount(() => {
    void Promise.all([refreshCompareTargets(), fetchSaved(props.tool).then(setSavedInfo)]).finally(
      () => setReady(true),
    );
  });
  /** The latest saved snapshot of this tool, when the project has one. */
  const latestSaved = () => savedInfo()[savedInfo().length - 1] ?? null;

  // The reference select's options. Memoized so the array (and the option objects) keep
  // their identity between the view's frequent re-renders (the live poll), and so the
  // `keyed` Show below remounts the select only when the list really changed.
  const options = createMemo(() => {
    const targets = compareTargets().map((target) => ({
      value: target.label,
      label: `${target.name}${target.ready ? "" : " (no source)"}`,
    }));
    const saved = latestSaved();
    const savedOption =
      saved || props.saved
        ? [
            {
              value: SAVED_VALUE,
              label: `Saved: ${props.saved ? props.reference : (saved?.referenceName ?? props.reference)}`,
            },
          ]
        : [];
    // A reference project that has since closed is no longer a target; keep it in the
    // list so the select shows the truth instead of silently switching to another.
    const known = targets.some((option) => option.value === props.reference);
    if (!props.saved && !known && props.reference) {
      return [
        ...savedOption,
        { value: props.reference, label: `${props.reference} (closed)` },
        ...targets,
      ];
    }
    return [...savedOption, ...targets];
  });

  const a = () => props.comparison.a;
  const b = () => props.comparison.b;
  const comparability = () => props.comparison.comparability;

  /**
   * Bring the other project into view (M25.D): raise its window when it is live (or an
   * open project with the saved reference's name), otherwise open the matching recent
   * project file in a new window. A failure is a transient notice, not a dialog.
   */
  async function openReference() {
    const binding: CompareBinding = props.saved
      ? { kind: "saved", reference: latestSaved()?.referenceName ?? props.reference }
      : { kind: "live", reference: props.reference };
    try {
      await showReference(binding, props.tool, props.id);
    } catch (err) {
      showCompareNotice(String(err).replace(/^Error:\s*/, ""));
    }
  }

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
    const start = common.start;
    const end = common.end;
    const extent = props.time.extent();
    if (start <= 1e-6 && end >= extent - 1e-6) return null;
    return `Delta over the common span ${start.toFixed(2)}–${end.toFixed(2)} s`;
  };

  return (
    <header class="compare-header" data-testid="compare.header">
      <div class="compare-title">
        <div class="compare-title-tool">Compare: {analyzerById(props.tool).title}</div>
        <div class="compare-side-line">
          <span class="compare-side-chip" style={{ background: compareSideColor(0) }} />
          <span class="compare-side-text">
            <span class="compare-side-letter">A</span> {sideLine(a())}
          </span>
        </div>
        <div class="compare-side-line">
          <span class="compare-side-chip" style={{ background: compareSideColor(1) }} />
          <span class="compare-side-text">
            <span class="compare-side-letter">B</span> {sideLine(b())}
          </span>
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
        <Show when={!props.saved && !props.live.open()}>
          <span class="compare-badge closed" data-testid="compare.peer-closed">
            Reference closed
          </span>
        </Show>
        <Show when={props.saved}>
          <span class="compare-badge saved" data-testid="compare.saved">
            Saved reference
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
              value={props.saved ? SAVED_VALUE : props.reference}
              onChange={(value) =>
                props.onBindingChange(
                  value === SAVED_VALUE
                    ? { kind: "saved", reference: latestSaved()?.referenceName ?? props.reference }
                    : { kind: "live", reference: value },
                )
              }
            />
          )}
        </Show>
        <Show when={!props.saved && !props.live.open()}>
          <Button class="compare-btn" onClick={props.onRetry}>
            Retry
          </Button>
        </Show>
        <Show when={props.saved || props.live.open()}>
          <Button
            class="compare-btn"
            data-testid="compare.reference-window"
            title={
              props.saved
                ? "Open the reference project in its own window"
                : "Bring the reference project's window to the front"
            }
            onClick={() => void openReference()}
          >
            {props.saved ? "Open reference" : "Show reference"}
          </Button>
        </Show>
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

/** One compact side line: `project · window · channel`. */
function sideLine(side: CompareSideDto): string {
  return `${side.project ?? "this project"} · ${windowLabel(side.window)} · ${channelLabel(
    side.params.channel,
  )}`;
}

/** A side's pinned window (`0.50–1.50 s`). */
function windowLabel(span: Span): string {
  return `${span.start.toFixed(2)}–${span.end.toFixed(2)} s`;
}

/** A channel index as the timeline names it (`mix`, `L`, `R`, `ch 3`). */
function channelLabel(channel: number | null | undefined): string {
  if (channel == null) return "mix";
  if (channel === 0) return "L";
  if (channel === 1) return "R";
  return `ch ${channel + 1}`;
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
