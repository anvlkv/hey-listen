import { Show, type JSX } from "solid-js";
import Popover from "../Popover";
import SharedParamsForm from "./SharedParamsForm";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";

/**
 * Analyzer tab shell: a toolbar (title, run status, **params** and **about**
 * popovers) over the tool's chart body. Each analyzer supplies its own result via
 * [`createAnalysis`](./state/analyzer.ts) and renders its chart as `children`;
 * per-tool params are passed as the `params` slot into the params popover.
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
  /** Extra per-tool params, appended to the shared params form. */
  params?: JSX.Element;
  children: JSX.Element;
}) {
  const def = () => analyzerById(props.id);

  return (
    <div class="analyzer">
      <div class="analyzer-toolbar">
        <span class="analyzer-title">{def().title}</span>
        <Show when={props.loading}>
          <span class="analyzer-status">computing…</span>
        </Show>
        <Show when={props.error}>
          {(message) => (
            <span class="analyzer-error" title={message()}>
              {message()}
            </span>
          )}
        </Show>

        <div class="analyzer-actions">
          <Popover label="Params" title="Shared analysis parameters">
            <SharedParamsForm />
            {props.params}
          </Popover>
          <Popover label="About" title={`About ${def().title}`} panelClass="pop-panel-about">
            <div class="about-title">{def().title}</div>
            <p class="about-body">{def().about}</p>
          </Popover>
        </div>
      </div>
      <div class="analyzer-body">{props.children}</div>

      <Show when={props.loading && !props.hasResult}>
        <div class="analyzer-busy analyzer-busy-center" role="status" aria-label="Computing">
          <span class="spinner" />
        </div>
      </Show>
      <Show when={props.loading && props.hasResult}>
        <div class="analyzer-busy analyzer-busy-corner" role="status" aria-label="Recomputing">
          <span class="spinner spinner-sm" />
        </div>
      </Show>
    </div>
  );
}
