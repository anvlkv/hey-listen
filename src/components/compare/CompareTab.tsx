import { createEffect, Match, Show, Switch, createSignal, untrack } from "solid-js";
import Button from "../Button";
import EmptyState from "../EmptyState";
import CompareHeader from "./CompareHeader";
import CompareReadouts from "./CompareReadouts";
import CompareSeries from "./CompareSeries";
import CompareSpectrum from "./CompareSpectrum";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";
import { createComparison } from "../../state/compare/run";
import { createCompareLive } from "../../state/compare/live";
import { compareFamily, comparePanelId } from "../../state/compare/id";
import { chooseCompareReference } from "../../state/compare/picker";
import { dockApi } from "../../state/workbench";
import { scheduleStampTabIds } from "../workbenchTabIds";

/**
 * A comparison view (M25): one analyzer over two independently open projects.
 *
 * Mounted as a transient Workbench tab (`compare:<tool>`) or, in a compare popout,
 * as the whole window. It owns the debounced compute ([`createComparison`]) and the
 * ~20 Hz peer poll ([`createCompareLive`]), draws the family's chart, and never
 * changes the reference project. See `docs/comparison.md`.
 */
export default function CompareTab(props: {
  tool: AnalyzerId;
  /** The reference project's window label (this view's binding). */
  reference: () => string | null;
  /** Change the binding (a tab updates locally; a popout asks the core). */
  onReferenceChange: (label: string) => void;
}) {
  const live = createCompareLive(() => props.reference());
  const run = createComparison(
    untrack(() => props.tool),
    () => props.reference(),
    () => live.revision(),
  );
  const [swapped, setSwapped] = createSignal(false);

  /** The window of the project shown as **B** (the band), following a swap. */
  const bWindow = () => {
    const comparison = run.comparison();
    if (!comparison) return null;
    return swapped() ? comparison.a.window : comparison.b.window;
  };

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
        when={props.reference()}
        fallback={
          <EmptyState
            icon="⇄"
            title="Compare with another project"
            hint="A comparison needs two projects. Open another window (File → New Window), then pick it here."
            action={
              <Button class="compare-btn" onClick={() => void chooseCompareReference(props.tool)}>
                Choose a project…
              </Button>
            }
          />
        }
      >
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
                reference={props.reference()!}
                live={live}
                onSwap={() => setSwapped((on) => !on)}
                onReferenceChange={props.onReferenceChange}
                onRetry={retry}
              />
              <Show when={!live.open()}>
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
                      bWindow={bWindow}
                    />
                  </Match>
                  <Match when={compareFamily(props.tool) === "series"}>
                    <CompareSeries
                      tool={props.tool}
                      comparison={comparison()}
                      swapped={swapped()}
                      live={live}
                      bWindow={bWindow}
                    />
                  </Match>
                  <Match when={compareFamily(props.tool) === "scalar"}>
                    <CompareReadouts comparison={comparison()} swapped={swapped()} />
                  </Match>
                  <Match when={true}>
                    <div class="analyzer-empty">
                      The {compareFamily(props.tool)} comparison chart arrives with M25.A — the
                      delta is available through `compare_analysis` and the CLI.
                    </div>
                  </Match>
                </Switch>
              </div>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
