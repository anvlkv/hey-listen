import { createEffect, Match, Show, Switch, createSignal, untrack } from "solid-js";
import Button from "../Button";
import EmptyState from "../EmptyState";
import CompareHeader from "./CompareHeader";
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
import { compareFamily, comparePanelId } from "../../state/compare/id";
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
 * changes the reference project. See `docs/comparison.md`.
 */
export default function CompareTab(props: {
  tool: AnalyzerId;
  /** This view's binding: a live project label, or the saved snapshot's name. */
  binding: () => CompareBinding | null;
  /** Change the binding (a tab updates locally; a popout asks the core). */
  onBindingChange: (binding: CompareBinding) => void;
  /** The fine-tune offset δ in seconds (per view). */
  offset: () => number;
  onOffset: (seconds: number) => void;
}) {
  const binding = () => props.binding();
  /** The saved binding's display name, or `null` for a live / unbound view. */
  const saved = () => (binding()?.kind === "saved" ? binding()!.reference : null);
  /** Only a live reference is polled for markers / revision (M25.C hides B's markers). */
  const live = createCompareLive(() => (binding()?.kind === "live" ? binding()!.reference : null));
  const run = createComparison(
    untrack(() => props.tool),
    binding,
    () => live.revision(),
    () => props.offset(),
  );
  const [swapped, setSwapped] = createSignal(false);

  /** The relative display transform (M25.B): displayed A at 0, displayed B at δ. */
  /* eslint-disable solid/reactivity -- compareTime stores the accessors and calls them
     from tracked chart scopes; reading `swapped` here would freeze the transform. */
  const time = compareTime(
    () => {
      const comparison = run.comparison();
      if (!comparison) throw new Error("the comparison has not resolved yet");
      return comparison;
    },
    () => swapped(),
  );
  /* eslint-enable solid/reactivity */
  /** Only the time-axis families show the fine-tune slider and the relative note. */
  const timeAxis = () =>
    ["series", "matrix", "spectrogram", "events", "notes", "waveform"].includes(
      compareFamily(props.tool),
    );

  // The tab is created before the comparison resolves, so its title gains the two
  // project names once they are known (the popout sets its own window title).
  createEffect(() => {
    const comparison = run.comparison();
    if (!comparison) return;
    const api = dockApi();
    const panel = api?.getPanel(comparePanelId(props.tool));
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

  return (
    <div class="compare-tab" data-testid={`compare.${props.tool}`}>
      <Show
        when={binding()}
        fallback={
          <EmptyState
            icon="⇄"
            title="Compare with another project"
            hint="A comparison needs two projects — or a saved comparison. Open another window (File → New Window), then pick it here."
            action={
              <Button class="compare-btn" onClick={() => void chooseCompareReference(props.tool)}>
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
                  <div class="analyzer-empty">
                    {run.loading() ? "Comparing…" : "Waiting for the reference project…"}
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
                  tool={props.tool}
                  comparison={comparison()}
                  swapped={swapped()}
                  reference={current().reference}
                  saved={current().kind === "saved"}
                  live={live}
                  time={time}
                  timeAxis={timeAxis()}
                  offset={props.offset()}
                  onOffset={props.onOffset}
                  onSwap={() => setSwapped((on) => !on)}
                  onBindingChange={props.onBindingChange}
                  onRetry={retry}
                />
                <Show when={saved()}>
                  <div class="compare-banner saved" data-testid="compare.saved-banner">
                    Saved reference — the reference from the last saved comparison. Pick a live
                    project to reconnect.
                  </div>
                </Show>
                <Show when={!saved() && !live.open()}>
                  <div class="compare-banner" data-testid="compare.banner">
                    Reference project closed — showing the last result. Live updates are stopped.
                  </div>
                </Show>
                <Show when={run.error()}>
                  {(error) => <div class="compare-banner">{error()}</div>}
                </Show>
                <div class="compare-body">
                  <Switch>
                    <Match when={compareFamily(props.tool) === "spectrum"}>
                      <CompareSpectrum
                        tool={props.tool}
                        comparison={comparison()}
                        swapped={swapped()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareFamily(props.tool) === "series"}>
                      <CompareSeries
                        tool={props.tool}
                        comparison={comparison()}
                        swapped={swapped()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={["matrix", "spectrogram"].includes(compareFamily(props.tool))}>
                      <CompareMatrix
                        tool={props.tool}
                        comparison={comparison()}
                        swapped={swapped()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareFamily(props.tool) === "events"}>
                      <CompareEvents
                        tool={props.tool}
                        comparison={comparison()}
                        swapped={swapped()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareFamily(props.tool) === "notes"}>
                      <CompareNotes
                        tool={props.tool}
                        comparison={comparison()}
                        swapped={swapped()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareFamily(props.tool) === "modulation"}>
                      <CompareModulation
                        tool={props.tool}
                        comparison={comparison()}
                        swapped={swapped()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareFamily(props.tool) === "waveform"}>
                      <CompareWaveform
                        tool={props.tool}
                        comparison={comparison()}
                        swapped={swapped()}
                        live={live}
                        time={time}
                      />
                    </Match>
                    <Match when={compareFamily(props.tool) === "scalar"}>
                      <CompareReadouts comparison={comparison()} swapped={swapped()} />
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
