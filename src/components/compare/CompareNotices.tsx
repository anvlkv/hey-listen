import { createMemo, For, Show } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import {
  CLIPPED_NOTE,
  REFERENCE_CLOSED_NOTE,
  SAVED_REFERENCE_NOTE,
  commonSpanNote,
  dismissLabel,
  mismatchDetail,
  mismatchSummary,
  type CompareNoticeState,
  type NoticeKind,
} from "../../state/compare/notices";
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
 */
export default function CompareNotices(props: {
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
    if (props.saved) {
      list.push({ kind: "saved", testId: "compare.saved-banner", text: SAVED_REFERENCE_NOTE });
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
    const mismatches = props.comparison.comparability.mismatches;
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
