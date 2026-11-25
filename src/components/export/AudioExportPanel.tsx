import { onMount, Show } from "solid-js";
import { Switch } from "@kobalte/core/switch";
import Button from "../Button";
import SelectField from "../SelectField";
import Tooltip from "../Tooltip";
import type { AudioExportChannels } from "../../bindings/AudioExportChannels";
import type { AudioExportDepth } from "../../bindings/AudioExportDepth";
import type { AudioExportFormat } from "../../bindings/AudioExportFormat";
import { meterDbLabel } from "../../lib/format";
import {
  CHANNEL_MODE_LABELS,
  DEPTH_LABELS,
  FORMAT_LABELS,
  blockedReason,
  defaultExportFilter,
  depthsFor,
  exportApplyFilter,
  exportAudio,
  exportChannel,
  exportChannelChoices,
  exportChannels,
  exportDepth,
  exportError,
  exportFormat,
  exportLaneCount,
  exportedAudio,
  exporting,
  filteringExport,
  setExportApplyFilter,
  setExportChannel,
  setExportChannels,
  setExportDepth,
  setExportFormat,
} from "../../state/exportAudio";
import { filterComposed } from "../../state/graph";
import { source } from "../../state/source";
import { windowEnd, windowStart } from "../../state/timeline";

/**
 * Export rail (M43): writes the analysis window of the project source as an audio file.
 *
 * Range, format, depth, channel shaping and the optional filter are explicit choices.
 * The **Apply the filter graph** switch is independent of the app's filter switch, and
 * sends the composed graph even while a frontend debounce is pending. Nothing here
 * changes the source, the filter switch or the analysis window.
 */

const FORMAT_OPTIONS = (["wav", "flac", "aiff"] as AudioExportFormat[]).map((value) => ({
  value,
  label: FORMAT_LABELS[value],
}));

const CHANNEL_OPTIONS = (["all", "mono", "single"] as AudioExportChannels[]).map((value) => ({
  value,
  label: CHANNEL_MODE_LABELS[value],
}));

export default function AudioExportPanel() {
  // Opening the rail seeds the filter switch from the app's current filter state; the
  // user can then flip it without touching the app's own switch.
  onMount(() => setExportApplyFilter(defaultExportFilter()));

  const depthOptions = () =>
    depthsFor(exportFormat()).map((value: AudioExportDepth) => ({
      value,
      label: DEPTH_LABELS[value],
    }));

  const duration = () => `${Math.max(0, windowEnd() - windowStart()).toFixed(2)} s`;
  const disabled = () => blockedReason() != null;

  return (
    <div class="app-source" data-testid="region.export">
      <div class="src-heading">Export audio</div>
      <span class="src-hero-hint">The analysis window of the project source, as a file.</span>

      <div class="export-field">
        <span class="src-label">Range</span>
        <span class="src-readout" data-testid="export.range">
          {windowStart().toFixed(2)} – {windowEnd().toFixed(2)} s ({duration()})
        </span>
      </div>

      <div class="export-field">
        <span class="src-label">Format</span>
        <SelectField
          options={FORMAT_OPTIONS}
          value={exportFormat()}
          onChange={setExportFormat}
          ariaLabel="Export format"
          testId="export.format"
          disabled={disabled()}
        />
      </div>

      <div class="export-field">
        <span class="src-label">Depth</span>
        <SelectField
          options={depthOptions()}
          value={exportDepth()}
          onChange={setExportDepth}
          ariaLabel="Export depth"
          testId="export.depth"
          disabled={disabled()}
        />
      </div>

      <div class="export-field">
        <span class="src-label">Channels</span>
        <SelectField
          options={CHANNEL_OPTIONS}
          value={exportChannels()}
          onChange={setExportChannels}
          ariaLabel="Export channels"
          testId="export.channels"
          disabled={disabled()}
        />
      </div>

      <Show when={exportChannels() === "single"}>
        <div class="export-field">
          <span class="src-label">Channel</span>
          <SelectField
            options={exportChannelChoices()}
            value={exportChannel()}
            onChange={setExportChannel}
            ariaLabel="Export channel"
            testId="export.channel"
            disabled={disabled()}
          />
        </div>
      </Show>

      <Tooltip
        label={
          filterComposed()
            ? "Apply the filter graph to the exported audio (independent of the app's filter switch)"
            : "Compose a filter graph to export filtered audio"
        }
      >
        <Switch
          class="toolbar-switch"
          checked={exportApplyFilter()}
          disabled={disabled() || !filterComposed()}
          onChange={(enabled) => setExportApplyFilter(enabled)}
        >
          <Switch.Label class="toolbar-label">Apply the filter graph</Switch.Label>
          <Switch.Input class="toolbar-switch-input" data-testid="export.filter" />
          <Switch.Control class="toolbar-switch-control">
            <Switch.Thumb class="toolbar-switch-thumb" />
          </Switch.Control>
        </Switch>
      </Tooltip>

      <Show when={filteringExport()}>
        <span class="src-readout">{exportLaneCount()} output channel(s) from the graph</span>
      </Show>

      <Button
        class="src-button"
        data-testid="export.run"
        disabled={disabled() || exporting()}
        onClick={() => void exportAudio()}
      >
        {exporting() ? "Exporting…" : "Export audio…"}
      </Button>

      <Show when={disabled()}>
        {(reason) => (
          <span class="src-readout" data-testid="export.reason">
            {reason()}
          </span>
        )}
      </Show>

      <Show when={exportedAudio()}>
        {(file) => (
          <div class="source-summary" data-testid="export.result">
            <span class="source-name">{file().path}</span>
            <span class="source-meta">
              {FORMAT_LABELS[file().format]} · {DEPTH_LABELS[file().depth]} · {file().channels} ch ·{" "}
              {file().sampleRate} Hz · {file().duration.toFixed(2)} s
            </span>
            <span class="source-meta">
              Peak {meterDbLabel(file().peak)}
              {file().clipping ? " · clipped" : ""}
            </span>
          </div>
        )}
      </Show>

      <Show when={exportError()}>
        {(message) => (
          <div class="src-error" data-testid="export.error" title={message()}>
            {message()}
          </div>
        )}
      </Show>

      <Show when={source() == null}>
        <span class="src-hero-hint">Open or record a source in Sources first.</span>
      </Show>
    </div>
  );
}
