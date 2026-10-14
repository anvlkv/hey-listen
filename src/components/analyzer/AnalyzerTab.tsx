import { Show, type JSX } from "solid-js";
import Popover from "../Popover";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";

/**
 * Analyzer tab shell: a toolbar (title, run status, **params** and **about**
 * popovers) over the tool's chart body. Each analyzer supplies its own result via
 * [`createAnalysis`](./state/analyzer.ts) and renders its chart as `children`;
 * per-tool params are passed as the `params` slot into the params popover.
 *
 * The **shared** analysis params (ADR-6) are global and synced, so they live in the
 * app Toolbar's "Analysis params" popover, not here. See
 * `docs/analysis-tools.md` → "Shared parameters".
 *
 * Busy indication: while the **first** result is computing, a spinner is centred
 * over the body; while a result is being **recomputed** (a previous one is still
 * shown), a small spinner sits in the bottom-right corner.
 */
export default function AnalyzerTab(props: {
  id: AnalyzerId;
  loading: boolean;
  error: string | null;
  /** Whether a result is already shown (drives first-run vs recompute spinner). */
  hasResult: boolean;
  /** Extra per-tool params, rendered in the params popover. */
  params?: JSX.Element;
  children: JSX.Element;
}) {
  const def = () => analyzerById(props.id);

  return (
    <div class="analyzer" data-testid={`analyzer.${props.id}`}>
      <div class="analyzer-toolbar">
        <span class="analyzer-title">{def().title}</span>
        <Show when={props.loading}>
          <span class="analyzer-status">computing…</span>
        </Show>
        <Show when={props.error}>
          {(message) => (
            <span class="analyzer-error" data-testid="analyzer.error" title={message()}>
              {message()}
            </span>
          )}
        </Show>

        <div class="analyzer-actions">
          <Show when={props.params != null}>
            <Popover
              label="Tool parameters"
              title="Tool parameters"
              icon="sliders"
              testid={`analyzer.params.${props.id}`}
            >
              {props.params}
              <div class="params-note">
                Shared params (FFT size, hop/overlap, window, channel, analysis rate,
                frequency range) are in the toolbar.
              </div>
            </Popover>
          </Show>
          <Popover
            label={`About ${def().title}`}
            title={`About ${def().title}`}
            icon="circle-question"
            panelClass="pop-panel-about"
            testid={`analyzer.about.${props.id}`}
          >
            <div class="about-title">{def().title}</div>
            <p class="about-body">{def().about}</p>
          </Popover>
        </div>
      </div>
      <div class="analyzer-body" data-testid="analyzer.body">{props.children}</div>

      <Show when={props.loading && !props.hasResult}>
        <div
          class="analyzer-busy analyzer-busy-center"
          data-testid="analyzer.busy"
          role="status"
          aria-label="Computing"
        >
          <span class="spinner" />
        </div>
      </Show>
      <Show when={props.loading && props.hasResult}>
        <div
          class="analyzer-busy analyzer-busy-corner"
          data-testid="analyzer.busy"
          role="status"
          aria-label="Recomputing"
        >
          <span class="spinner spinner-sm" />
        </div>
      </Show>
    </div>
  );
}
