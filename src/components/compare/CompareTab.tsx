import { createEffect, Match, on, Show, Switch, untrack } from "solid-js";
import Button from "../Button";
import EmptyState from "../EmptyState";
import CompareHeader from "./CompareHeader";
import CompareNotices from "./CompareNotices";
import CompareEvents from "./CompareEvents";
import CompareMatrix from "./CompareMatrix";
import CompareModulation from "./CompareModulation";
import CompareNotes from "./CompareNotes";
import CompareReadouts from "./CompareReadouts";
import CompareSeries from "./CompareSeries";
import CompareSpectrum from "./CompareSpectrum";
import CompareWaveform from "./CompareWaveform";
import { compareTime } from "./time";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";
import { createComparison } from "../../state/compare/run";
import { createCompareLive } from "../../state/compare/live";
import { compareNotices, resetNotices } from "../../state/compare/notices";
import { compareViewFamily, comparePanelId } from "../../state/compare/id";
import { chooseCompareReference } from "../../state/compare/picker";
import type { CompareBinding } from "../../state/compare/views";
import { dockApi } from "../../state/workbench";
import { scheduleStampTabIds } from "../workbenchTabIds";

/**
 * A comparison view (M25): one analyzer over two independently open projects, or over
 * this project and its **saved reference snapshot** (M25.C).
 *
 * Mounted as a transient Workbench tab (`compare:<tool>`) or, in a compare popout,
 * as the whole window. It owns the debounced compute ([`createComparison`]) and the
 * ~20 Hz peer poll ([`createCompareLive`]), draws the family's chart, and never
 * changes the reference project.
 */
export default function CompareTab(props: {
  tool: AnalyzerId;
  /** The comparison's stable id (a tab may be one of several for the same tool). */
  id: string;
  /** This view's binding: a live project label, or the saved snapshot's name. */
  binding: () => CompareBinding | null;
  /** Change the binding (a tab updates locally; a popout asks the core). */
  onBindingChange: (binding: CompareBinding) => void;
  /** The fine-tune offset δ in seconds (per view). */
  offset: () => number;
  onOffset: (seconds: number) => void;
}) {
  const binding = () => props.binding();
  /** Only a live reference is polled for markers / revision (M25.C hides B's markers). */
  const live = createCompareLive(() => (binding()?.kind === "live" ? binding()!.reference : null));
  const run = createComparison(
    untrack(() => props.tool),
    untrack(() => props.id),
    binding,
    () => live.revision(),
    () => props.offset(),
  );

  /**
   * The relative display transform (M25.B): A at 0, B shifted by the fine-tune δ. The
   * accessor is stored, so the charts call `run.comparison()` inside their tracked scopes.
   */
  const time = compareTime(() => {
    const comparison = run.comparison();
    if (!comparison) throw new Error("the comparison has not resolved yet");
    return comparison;
  });
  /** Only the time-axis families show the fine-tune slider and the relative note. */
  const timeAxis = () =>
    ["series", "matrix", "spectrogram", "events", "notes", "waveform"].includes(
      compareViewFamily(props.tool),
    );

  /** This comparison's notice dismissals, held per id (transient UI state). */
  const notices = untrack(() => compareNotices(props.id));

  // A retargeted comparison starts with a clean notice surface: the previous reference's
  // dismissals must not hide a notice about the new one. Keyed on the binding itself, so
  // re-selecting the same reference (which is not a retarget) keeps the user's dismissals.
  createEffect(
    on(
      () => {
        const target = binding();
        return target ? `${target.kind}:${target.reference}` : null;
      },
      () => resetNotices(props.id),
      { defer: true },
    ),
  );

  // The tab is created before the comparison resolves, so its title gains the two
  // project names once they are known (the popout sets its own window title).
  createEffect(() => {
    const comparison = run.comparison();
    if (!comparison) return;
    const api = dockApi();
    const panel = api?.getPanel(comparePanelId(props.tool, props.id));
    if (!api || !panel) return;
    const title = `Compare: ${analyzerById(props.tool).title} — ${
      comparison.a.project ?? "A"
    } ↔ ${comparison.b.project ?? "B"}`;
    if (panel.title === title) return;
    panel.api.setTitle(title);
    // The E2E hook is stamped by matching a tab's text to its title, so re-stamp after
    // the title gains the project names.
    scheduleStampTabIds(api);
  });

  const retry = () => {
    live.refresh();
    run.refresh();
  };

  /**
   * The running label. The core has no progress channel for a comparison, so the one
   * thing the view can honestly report is how long it has been running — which is what
   * turns a silent wait into a clue (the log carries the matching heartbeat).
   */
  const comparingLabel = () => {
    const seconds = run.elapsed();
    return seconds >= 1 ? `Comparing… ${Math.round(seconds)} s` : "Comparing…";
  };

  return (
    <div class="compare-tab" data-testid={`compare.${props.tool}`} data-compare-id={props.id}>
      <Show
        when={binding()}
        fallback={
          <EmptyState
            icon="⇄"
            title="Compare with another project"
            hint="A comparison needs two projects — or a saved comparison. Open another window (File → New Window), then pick it here."
            action={
              <Button
                class="compare-btn"
                onClick={() => void chooseCompareReference(props.tool, props.id)}
              >
                Choose a project…
              </Button>
            }
          />
        }
      >
        {(current) => (
          <Show
            when={run.comparison()}
            fallback={
              <Show
                when={run.error()}
                fallback={
                  <div class="analyzer-empty" data-testid="compare.loading">
                    {run.loading() ? comparingLabel() : "Waiting for the reference project…"}
                  </div>
                }
              >
                {(error) => (
                  <div class="compare-error" data-testid="compare.error">
                    <div class="compare-error-text">{error()}</div>
                    <Button class="compare-btn" onClick={retry}>
                      Retry
                    </Button>
                  </div>
                )}
              </Show>
            }
          >
            {(comparison) => (
              <>
                <CompareHeader
                  id={props.id}
                  tool={props.tool}
                  comparison={comparison()}
                  reference={current().reference}
                  saved={current().kind === "saved"}
                  live={live}
                  timeAxis={timeAxis()}
                  offset={props.offset()}
                  onOffset={props.onOffset}
                  onBindingChange={props.onBindingChange}
                  onRetry={retry}
                />
                <CompareNotices
                  comparison={comparison()}
                  live={live}
                  error={run.error}
                  saved={current().kind === "saved"}
                  time={time}
                  notices={notices}
                />
                <div class="compare-body">
                  <Switch>
                    <Match when={compareViewFamily(props.tool) === "spectrum"}>
                      <CompareSpectrum
                        tool={props.tool}
                        comparison={comparison()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareViewFamily(props.tool) === "series"}>
                      <CompareSeries
                        tool={props.tool}
                        comparison={comparison()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={["matrix", "spectrogram"].includes(compareViewFamily(props.tool))}>
                      <CompareMatrix
                        tool={props.tool}
                        comparison={comparison()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareViewFamily(props.tool) === "events"}>
                      <CompareEvents
                        tool={props.tool}
                        comparison={comparison()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareViewFamily(props.tool) === "notes"}>
                      <CompareNotes
                        tool={props.tool}
                        comparison={comparison()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareViewFamily(props.tool) === "modulation"}>
                      <CompareModulation
                        tool={props.tool}
                        comparison={comparison()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareViewFamily(props.tool) === "waveform"}>
                      <CompareWaveform
                        tool={props.tool}
                        comparison={comparison()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareViewFamily(props.tool) === "scalar"}>
                      <CompareReadouts comparison={comparison()} />
                    </Match>
                  </Switch>
                </div>
              </>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
