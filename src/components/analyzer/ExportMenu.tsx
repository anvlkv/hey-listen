import { Show, createSignal, untrack } from "solid-js";
import Button from "../Button";
import Popover from "../Popover";
import {
  copyAnalysisCsv,
  exportAnalysis,
  exportChart,
  type ExportFormatName,
} from "../../lib/export";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";
import { hasChartImage } from "../../state/exportRegistry";
import { source } from "../../state/source";

/** The last path segment (the file name shown in the status line). */
function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * The per-tab **Export** popover (M12): data as JSON / CSV, the chart as PNG, and a
 * CSV clipboard copy. Data exports re-run the tool at the current window/settings and
 * are rendered by the core (see `docs/exports.md`); the PNG captures the chart as it
 * is drawn, so it matches the theme and zoom.
 *
 * The menu stays open and reports the written path, so a second export (the other
 * format) does not need reopening. A CSV writes its `.meta.json` sidecar unless the
 * user unticks the box.
 */
export default function ExportMenu(props: { id: AnalyzerId }) {
  // The tool id is fixed for a mounted tab, so read it once (the callbacks below run
  // on an event, not in a tracked scope).
  const toolId = untrack(() => props.id);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<string | null>(null);
  const [sidecar, setSidecar] = createSignal(true);

  /** Run one export action with the shared busy / error / status handling. */
  async function run(action: () => Promise<string | null>) {
    if (busy()) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const message = await action();
      if (message) setStatus(message);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const saveData = (format: ExportFormatName) =>
    run(async () => {
      const outcome = await exportAnalysis(toolId, format, {
        includeSidecar: untrack(sidecar),
      });
      return outcome ? `Saved ${fileName(outcome.path)}` : null;
    });

  const saveChart = () =>
    run(async () => {
      const path = await exportChart(toolId);
      return path ? `Saved ${fileName(path)}` : null;
    });

  const copyCsv = () =>
    run(async () => {
      await copyAnalysisCsv(toolId);
      return "CSV copied to the clipboard";
    });

  const ready = () => source() != null && !busy();
  const chartReady = () => hasChartImage(toolId) && ready();

  return (
    <Popover
      label="Export"
      title="Export this analysis"
      icon="file-export"
      panelClass="pop-panel-export"
      testid={`analyzer.export.${props.id}`}
    >
      <div class="export-title">{analyzerById(props.id).title}</div>
      <div class="export-actions">
        <Button
          class="toolbar-btn"
          disabled={!ready()}
          onClick={() => void saveData("json")}
          data-testid="export.json"
        >
          Data → JSON…
        </Button>
        <Button
          class="toolbar-btn"
          disabled={!ready()}
          onClick={() => void saveData("csv")}
          data-testid="export.csv"
        >
          Data → CSV…
        </Button>
        <Button
          class="toolbar-btn"
          disabled={!chartReady()}
          title={
            chartReady()
              ? "Save the rendered chart as a PNG"
              : "Open the chart to draw it before exporting an image"
          }
          onClick={() => void saveChart()}
          data-testid="export.png"
        >
          Chart → PNG…
        </Button>
        <Button
          class="toolbar-btn"
          disabled={!ready()}
          onClick={() => void copyCsv()}
          data-testid="export.copy"
        >
          Copy CSV
        </Button>
      </div>
      <label class="export-check">
        <input
          type="checkbox"
          checked={sidecar()}
          onChange={(event) => setSidecar(event.currentTarget.checked)}
          data-testid="export.sidecar"
        />
        <span>Write CSV sidecar metadata</span>
      </label>
      <Show when={busy()}>
        <div class="params-note">Exporting…</div>
      </Show>
      <Show when={error()}>
        {(message) => (
          <div class="export-error" data-testid="export.error">
            {message()}
          </div>
        )}
      </Show>
      <Show when={status()}>
        {(message) => (
          <div class="export-status" data-testid="export.status">
            {message()}
          </div>
        )}
      </Show>
      <p class="params-note">
        JSON is a self-describing provenance envelope; CSV is one row per time frame. Both re-run
        the analysis at the current window and settings.
      </p>
    </Popover>
  );
}
