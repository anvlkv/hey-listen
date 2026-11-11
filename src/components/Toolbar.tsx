import { Slider } from "@kobalte/core/slider";
import { Meter } from "@kobalte/core/meter";
import { createEffect, on, onCleanup, onMount, Show } from "solid-js";
import Button from "./Button";
import Combobox from "./Combobox";
import Icon from "./Icon";
import Popover from "./Popover";
import Tooltip from "./Tooltip";
import SharedParamsForm from "./analyzer/SharedParamsForm";
import AppearancePopover from "./toolbar/AppearancePopover";
import McpPopover from "./McpPopover";
import {
  applyOutputGain,
  initOutputMeter,
  outputDeviceId,
  outputDevices,
  outputGain,
  outputLevel,
  refreshOutputDevices,
  setOutputDeviceId,
} from "../state/output";
import { previewError } from "../audio/preview";
import {
  adjacentProjects,
  projectError,
  projectName,
  projectPath,
  projectStatus,
  refreshAdjacentProjects,
  upgradedFrom,
} from "../state/project";
import { annotations } from "../state/annotations";
import { annotationsPanelOpen, toggleAnnotationsPanel } from "../state/settings";
import { error, status } from "../state/source";
import { setAboutOpen, stepProject } from "../state/menu";
import { refreshMcpStatus } from "../state/mcpSettings";
import { meterDbLabel, meterPercent } from "../lib/format";

const STATUS_LABEL: Record<string, string> = {
  probing: "reading metadata…",
  decoding: "decoding audio…",
};

const PROJECT_LABEL: Record<string, string> = {
  saving: "saving project…",
  loading: "loading project…",
};

/**
 * App toolbar (no title/branding — the native title bar carries the app name).
 *
 * Holds app-level status and the current **project name** (the New / Open / Save
 * actions live in the native **File** menu — see `src-tauri/src/menu.rs`), plus the
 * preview output (gain + device), which drives the core (ADR-9). The filter bypass
 * toggle lives in the Timeline toolbar (see `docs/ui-layout.md`); the audio source
 * picker lives in the bottom-left Source region.
 *
 * The **shared analysis params** (ADR-6) live here too, in an "Analysis params"
 * popover: they are global and synced across every analyzer, so they belong in the
 * app chrome rather than in each tool's params popover. See
 * `docs/analysis-tools.md` → "Shared parameters".
 */
export default function Toolbar() {
  onMount(() => {
    void refreshMcpStatus();
  });
  // The previous/next arrows follow the project's folder: a load, a save-as or a step
  // re-reads the neighbour list (unsaved projects have none).
  createEffect(on(projectPath, (path) => void refreshAdjacentProjects(path)));
  // Poll the preview output level for the meter; stop when the toolbar unmounts.
  onCleanup(initOutputMeter());

  const deviceOptions = () =>
    outputDevices().map((device) => ({
      value: device.id,
      label: device.isDefault ? `${device.name} (default)` : device.name,
    }));

  return (
    <header class="app-toolbar" data-testid="region.toolbar">
      <span class="toolbar-project">
        <Tooltip label="Previous project (⌥⌘←)">
          <Button
            class="toolbar-btn toolbar-step"
            data-testid="toolbar.project.previous"
            aria-label="Previous project"
            disabled={!adjacentProjects().previous}
            onClick={() => void stepProject(-1)}
          >
            <Icon name="angle-left" />
          </Button>
        </Tooltip>
        <span class="toolbar-name" data-testid="toolbar.project.name" title={projectName()}>
          {projectName()}
        </span>
        <Tooltip label="Next project (⌥⌘→)">
          <Button
            class="toolbar-btn toolbar-step"
            data-testid="toolbar.project.next"
            aria-label="Next project"
            disabled={!adjacentProjects().next}
            onClick={() => void stepProject(1)}
          >
            <Icon name="angle-right" />
          </Button>
        </Tooltip>
      </span>

      <Show when={PROJECT_LABEL[projectStatus()]}>
        <span class="app-status">{PROJECT_LABEL[projectStatus()]}</span>
      </Show>
      <Show when={upgradedFrom() !== null}>
        <span
          class="app-status"
          data-testid="toolbar.project.upgraded"
          title="Opened from an older project format; saving writes the current version"
        >
          upgraded from v{upgradedFrom()}
        </span>
      </Show>
      <Show when={STATUS_LABEL[status()]}>
        <span class="app-status">{STATUS_LABEL[status()]}</span>
      </Show>

      <div class="toolbar-spacer" />

      <div class="toolbar-controls">
        <Popover
          label="Analysis parameters"
          title="Shared analysis params (synced across every tool)"
          icon="sliders"
          testid="toolbar.params"
        >
          <SharedParamsForm />
        </Popover>

        <Tooltip label="Preview output gain">
          <div class="toolbar-group">
            <span class="toolbar-label icon-label">
              <Icon name="volume-high" />
              Output
            </span>
            <Slider
              class="toolbar-slider"
              value={[outputGain()]}
              onChange={(values) => applyOutputGain(values[0])}
              minValue={0}
              maxValue={2}
              step={0.05}
              aria-label="Preview output gain"
            >
              <Slider.Track class="gain-track">
                <Slider.Fill class="gain-fill" />
                <Slider.Thumb class="gain-thumb" aria-label="Preview output gain">
                  <Slider.Input
                    class="gain-input"
                    data-testid="toolbar.output.gain"
                    aria-label="Preview output gain"
                  />
                </Slider.Thumb>
              </Slider.Track>
            </Slider>
            <span class="toolbar-readout">{Math.round(outputGain() * 100)}%</span>
          </div>
        </Tooltip>

        <Tooltip label="Preview output level">
          <div class="toolbar-group">
            <span class="toolbar-label icon-label">
              <Icon name="gauge-high" />
              Level
            </span>
            <Meter
              class="toolbar-meter"
              data-testid="toolbar.output.meter"
              value={meterPercent(outputLevel())}
              minValue={0}
              maxValue={100}
              getValueLabel={() => meterDbLabel(outputLevel())}
              aria-label="Preview output level"
            >
              <Meter.Track class="toolbar-meter-track">
                <Meter.Fill class="toolbar-meter-fill" />
              </Meter.Track>
            </Meter>
            <span class="toolbar-readout toolbar-meter-readout">{meterDbLabel(outputLevel())}</span>
          </div>
        </Tooltip>

        <div class="toolbar-field">
          <Combobox
            options={deviceOptions()}
            value={outputDeviceId()}
            onChange={setOutputDeviceId}
            emptyLabel="System default"
            label="Output device"
            // Not enumerated at launch: cpal's device listing creates a HAL AudioUnit
            // per device, which makes macOS ask for microphone/audio-capture access.
            // The list is only needed once the user picks a device. See
            // `docs/source-model.md` → OS permissions.
            onOpen={() => void refreshOutputDevices()}
          />
        </div>

        <AppearancePopover />

        <McpPopover />

        <Tooltip label="About Hey Listen">
          <Button
            class="toolbar-btn icon-btn"
            data-testid="toolbar.about"
            aria-label="About Hey Listen"
            onClick={() => setAboutOpen(true)}
          >
            <Icon name="circle-question" />
          </Button>
        </Tooltip>

        {/* The Annotations rail toggle sits apart at the right end of the toolbar. */}
        <span class="toolbar-divider" aria-hidden="true" />
        <Tooltip label="Annotations panel">
          <Button
            class="toolbar-btn toolbar-btn-annotations"
            data-testid="toolbar.annotations"
            aria-label="Toggle the annotations panel"
            aria-pressed={annotationsPanelOpen()}
            onClick={toggleAnnotationsPanel}
          >
            <Icon name="annotation-sticky" />
            <Show when={!annotationsPanelOpen() && annotations().length > 0}>
              <span class="annotations-count-chip" data-testid="toolbar.annotations.count">
                {annotations().length}
              </span>
            </Show>
          </Button>
        </Tooltip>
      </div>

      <Show when={previewError()}>
        <span
          class="app-status app-status-error"
          data-testid="toolbar.preview.error"
          title={previewError() ?? undefined}
        >
          {previewError()}
        </span>
      </Show>
      <Show when={error()}>
        <span
          class="app-status app-status-error"
          data-testid="toolbar.error"
          title={error() ?? undefined}
        >
          {error()}
        </span>
      </Show>
      <Show when={projectError()}>
        <span
          class="app-status app-status-error"
          data-testid="toolbar.project.error"
          title={projectError() ?? undefined}
        >
          {projectError()}
        </span>
      </Show>
    </header>
  );
}
