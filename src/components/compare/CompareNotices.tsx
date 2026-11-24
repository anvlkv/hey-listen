import { createMemo, For, Show } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import {
  CLIPPED_NOTE,
  NO_FRAGMENT_NOTE,
  REFERENCE_CLOSED_NOTE,
  REGRIDDED_NOTE,
  SAVED_REFERENCE_NOTE,
  UPDATE_ACTION_LABEL,
  UPDATE_NOTE,
  commonSpanNote,
  dismissLabel,
  mismatchDetail,
  mismatchSummary,
  type CompareNoticeState,
  type NoticeKind,
} from "../../state/compare/notices";
import { openReferenceTarget, updateFromOpenReference } from "../../state/compare/picker";
import { savedInfo } from "../../state/compare/views";
import type { AnalyzerId } from "../../state/analyzer";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto } from "../../state/compare/types";
import type { CompareTime } from "./time";

/** One row of the strip: what it says, where the suite finds it, and how it reads. */
interface NoticeRow {
  kind: NoticeKind;
  /** The `data-testid` the suite counts — the strip is the only place each renders. */
  testId: string;
  text: string;
  /** Per-key lines, rendered as a disclosure (`mismatch` only). */
  detail?: string[];
  /** One small text button on the row (`update` only). */
  action?: { label: string; testId: string; run: () => void };
}

/**
 * A compare view's **notice strip** (M25): one quiet, dismissable line per notice,
 * under the header and above the chart. Every notice used to be a full-width warn
 * banner of equal weight; here only a real warning is coloured, the rest are
 * `--fg-muted` on a hairline divider.
 *
 * The rows are still in the DOM by default (the suite counts them) — dismissing hides
 * one, per comparison id, and never touches the comparison itself: the badge, the
 * charts and the delta stay. A closed reference is also what a run fails on, so the
 * closed row replaces the error row rather than stacking a second warning on the same
 * failure.
 *
 * A **saved** reference adds what its snapshot can and cannot do: whether it was
 * re-gridded from stored audio, or has none (a pre-v8 snapshot) — and, when its project
 * is open, the row action that re-links the view to it.
 */
export default function CompareNotices(props: {
  /** The comparison's tool and id: the saved snapshot's capabilities are keyed by them. */
  tool: AnalyzerId;
  id: string;
  comparison: ComparisonDto;
  live: CompareLiveHandle;
  /** The run error, when a re-run failed and the last result is still shown. */
  error: () => string | null;
  /** Whether the reference is the project's saved snapshot (M25.C). */
  saved: boolean;
  /** The relative display transform (M25.B) — the clipping predicate lives there. */
  time: CompareTime;
  notices: CompareNoticeState;
}) {
  const common = () => props.comparison.comparability.alignment.common;
  /** A closed reference is the failure a run reports, so it owns the failure row. */
  const closed = () => !props.saved && !props.live.open();

  const rows = createMemo<NoticeRow[]>(() => {
    const list: NoticeRow[] = [];
    const mismatches = props.comparison.comparability.mismatches;
    if (props.saved) {
      list.push({ kind: "saved", testId: "compare.saved-banner", text: SAVED_REFERENCE_NOTE });
    }
    // How the saved reference met this window's grid: re-gridded from its stored audio,
    // or — with none, a pre-v8 snapshot — shown on its own grid (which is why settings
    // can differ). The two are mutually exclusive: re-gridding needs the stored audio.
    if (props.comparison.comparability.regridded) {
      list.push({ kind: "regridded", testId: "compare.regridded", text: REGRIDDED_NOTE });
    } else if (
      props.saved &&
      !savedInfo(props.tool, props.id)?.hasFragment &&
      mismatches.length > 0
    ) {
      list.push({ kind: "no-fragment", testId: "compare.no-fragment", text: NO_FRAGMENT_NOTE });
    }
    // The reference project itself is open: one click rebinds this view to it.
    if (props.saved && openReferenceTarget(props.tool, props.id)) {
      list.push({
        kind: "update",
        testId: "compare.update",
        text: UPDATE_NOTE,
        action: {
          label: UPDATE_ACTION_LABEL,
          testId: "compare.update.action",
          run: () => void updateFromOpenReference(props.tool, props.id),
        },
      });
    }
    const failure = props.error();
    if (closed()) {
      list.push({ kind: "closed", testId: "compare.banner", text: REFERENCE_CLOSED_NOTE });
    } else if (failure) {
      list.push({ kind: "error", testId: "compare.error", text: failure });
    }
    // The common span, when the two shifted windows do not cover the same extent.
    const clipped = props.time.clipped();
    if (props.comparison.comparability.aligned && clipped) {
      list.push({ kind: "span", testId: "compare.span", text: commonSpanNote(common()) });
    }
    if (props.comparison.diff?.kind === "waveform" && clipped && common()) {
      list.push({ kind: "clipped", testId: "compare.waveform.note", text: CLIPPED_NOTE });
    }
    if (mismatches.length > 0) {
      list.push({
        kind: "mismatch",
        testId: "compare.mismatches",
        text: mismatchSummary(mismatches),
        detail: mismatchDetail(mismatches),
      });
    }
    return list.filter((row) => !props.notices.isDismissed(row.kind));
  });

  return (
    <Show when={rows().length > 0}>
      <div class="compare-notices" data-testid="compare.notices">
        <For each={rows()}>
          {(row) => (
            <div class={`compare-notice ${row.kind}`} data-testid={row.testId}>
              <Show
                when={row.detail}
                fallback={<span class="compare-notice-text">{row.text}</span>}
              >
                {(lines) => (
                  <details class="compare-notice-details">
                    <summary class="compare-notice-text">{row.text}</summary>
                    <ul class="compare-notice-list">
                      <For each={lines()}>{(line) => <li>{line}</li>}</For>
                    </ul>
                  </details>
                )}
              </Show>
              <Show when={row.action}>
                {(action) => (
                  <Button
                    class="compare-notice-action"
                    data-testid={action().testId}
                    onClick={action().run}
                  >
                    {action().label}
                  </Button>
                )}
              </Show>
              <Button
                class="compare-notice-dismiss"
                aria-label={dismissLabel(row.kind)}
                title={dismissLabel(row.kind)}
                onClick={() => props.notices.dismiss(row.kind)}
              >
                <Icon name="xmark" />
              </Button>
            </div>
          )}
        </For>
        <Show when={rows().length > 1}>
          <div class="compare-notice-actions">
            <Button
              class="compare-notice-dismiss-all"
              onClick={() => props.notices.dismissAll(rows().map((row) => row.kind))}
            >
              Dismiss all
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
