import { createResource, createSignal, Show, type JSX } from "solid-js";
import Hint from "../Hint";
import Popover from "../Popover";
import CompareMenu from "./CompareMenu";
import ExportMenu from "./ExportMenu";
import { markdownPlain, renderMarkdown } from "../../lib/markdown";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";

/**
 * Analyzer tab shell: a toolbar (title, run status, **params** and **about**
 * popovers) over the tool's chart body. Each analyzer supplies its own result via
 * [`createAnalysis`](./state/analyzer/) and renders its chart as `children`;
 * per-tool params are passed as the `params` slot into the params popover.
 *
 * The **shared** analysis params (ADR-6) are global and synced, so they live in the
 * app Toolbar's "Analysis params" popover, not here. See
 * `docs/analysis-tools.md` → "Shared parameters".
 *
 * Busy indication: while the **first** result is computing, the body's empty state is
 * hidden (`analyzer-first-load`) and a spinner is centred over it — the children stay
 * mounted, so a chart's canvas and its interactions are not torn down and rebuilt
 * mid-run. While a result is being **recomputed** (a previous one is still shown), a
 * small spinner sits in the bottom-right corner.
 *
 * When the run streams its stages (D-21) the toolbar's `computing…` status becomes a
 * compact phase label with the percentage, a thin bar and a **Cancel** button; a run
 * that reports no progress keeps the plain `computing…` text, so the spinners above are
 * unaffected either way.
 */
export default function AnalyzerTab(props: {
  id: AnalyzerId;
  loading: boolean;
  error: string | null;
  /** Whether a result is already shown (drives first-run vs recompute spinner). */
  hasResult: boolean;
  /** The in-flight run's stage, when the core streams one (`null` = report nothing). */
  progress?: { phase: string; fraction: number } | null;
  /** Stop the in-flight run; wired to the progress chip's Cancel button. */
  onCancel?: () => void;
  /** Extra per-tool params, rendered in the params popover. */
  params?: JSX.Element;
  children: JSX.Element;
}) {
  const def = () => analyzerById(props.id);

  /** The run's completion as a whole percentage, clamped to the bar's 0…100 range. */
  const percent = () => Math.round(Math.min(Math.max(props.progress?.fraction ?? 0, 0), 1) * 100);

  // The About panel renders the registry's markdown copy. The renderer is a
  // dynamic import, so it is only loaded once the panel is first opened.
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const [aboutHtml] = createResource(aboutOpen, () => renderMarkdown(def().about));

  return (
    <div
      class="analyzer"
      classList={{ "analyzer-first-load": props.loading && !props.hasResult }}
      data-testid={`analyzer.${props.id}`}
    >
      <div class="analyzer-toolbar">
        <span class="analyzer-title">{def().title}</span>
        <Show when={props.loading}>
          <Show when={props.progress} fallback={<span class="analyzer-status">computing…</span>}>
            {(progress) => (
              <div class="analyzer-progress" data-testid="analyzer.progress">
                <span class="analyzer-progress-label">
                  {progress().phase} · {percent()}%
                </span>
                <div
                  class="analyzer-progress-track"
                  data-testid="analyzer.progress-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent()}
                  aria-label={`${def().title} progress`}
                >
                  <div class="analyzer-progress-fill" style={{ width: `${percent()}%` }} />
                </div>
                <Show when={props.onCancel}>
                  {(cancel) => (
                    <button
                      type="button"
                      class="analyzer-cancel"
                      data-testid="analyzer.cancel"
                      title="Stop this run and keep the last result"
                      onClick={cancel()}
                    >
                      Cancel
                    </button>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </Show>
        <Show when={props.error}>
          {(message) => (
            <span class="analyzer-error" data-testid="analyzer.error" title={message()}>
              {message()}
            </span>
          )}
        </Show>

        <div class="analyzer-actions">
          <CompareMenu id={props.id} />
          <Show when={props.params != null}>
            <Popover
              label="Tool parameters"
              title="Tool parameters"
              icon="sliders"
              testid={`analyzer.params.${props.id}`}
            >
              {props.params}
              <Hint>Shared params live in the toolbar.</Hint>
            </Popover>
          </Show>
          <Popover
            label={`About ${def().title}`}
            title={`About ${def().title}`}
            icon="circle-question"
            panelClass="pop-panel-about"
            testid={`analyzer.about.${props.id}`}
            onOpen={() => setAboutOpen(true)}
          >
            <div class="about-title">{def().title}</div>
            <Show
              when={aboutHtml()}
              fallback={<p class="about-body">{markdownPlain(def().about)}</p>}
            >
              {(html) => (
                <div
                  class="about-body markdown-body"
                  // `renderMarkdown` output (marked + DOMPurify sanitized).
                  // eslint-disable-next-line solid/no-innerhtml -- sanitized registry copy
                  innerHTML={html()}
                />
              )}
            </Show>
          </Popover>
          <ExportMenu id={props.id} />
        </div>
      </div>
      <div class="analyzer-body" data-testid="analyzer.body">
        {props.children}
      </div>

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
