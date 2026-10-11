import { Switch } from "@kobalte/core/switch";
import { Slider } from "@kobalte/core/slider";
import { Meter } from "@kobalte/core/meter";
import { For, onCleanup, onMount, Show } from "solid-js";
import Button from "./Button";
import Combobox from "./Combobox";
import Popover from "./Popover";
import SharedParamsForm from "./analyzer/SharedParamsForm";
import { filterEnabled, setFilterEnabled } from "../state/graph";
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
import { projectError, projectName, projectStatus } from "../state/project";
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  fontScale,
  nudgeFontScale,
  setThemePreference,
  THEME_PREFERENCES,
  themePreference,
  type ThemePreference,
} from "../state/settings";
import { error, status } from "../state/source";
import { meterDbLabel, meterPercent } from "../lib/format";

const STATUS_LABEL: Record<string, string> = {
  probing: "reading metadata…",
  decoding: "decoding audio…",
};

const PROJECT_LABEL: Record<string, string> = {
  saving: "saving project…",
  loading: "loading project…",
};

const THEME_LABEL: Record<ThemePreference, string> = {
  auto: "Auto",
  dark: "Dark",
  light: "Light",
};

/**
 * App toolbar (no title/branding — the native title bar carries the app name).
 *
 * Holds app-level status and the current **project name** (the New / Open / Save
 * actions live in the native **File** menu — see `src-tauri/src/menu.rs`), plus the
 * filter-graph bypass toggle and the preview output (gain + device), which drive
 * the core (ADR-9). The audio source picker lives in the bottom-left Source region
 * (see `docs/ui-layout.md`).
 *
 * The **shared analysis params** (ADR-6) live here too, in an "Analysis params"
 * popover: they are global and synced across every analyzer, so they belong in the
 * app chrome rather than in each tool's params popover. See
 * `docs/analysis-tools.md` → "Shared parameters".
 */
export default function Toolbar() {
  onMount(() => {
    void refreshOutputDevices();
  });
  // Poll the preview output level for the meter; stop when the toolbar unmounts.
  onCleanup(initOutputMeter());

  const deviceOptions = () =>
    outputDevices().map((device) => ({
      value: device.id,
      label: device.isDefault ? `${device.name} (default)` : device.name,
    }));

  return (
    <header class="app-toolbar" data-testid="region.toolbar">
      <span
        class="toolbar-name"
        data-testid="toolbar.project.name"
        title={projectName()}
      >
        {projectName()}
      </span>

      <Show when={PROJECT_LABEL[projectStatus()]}>
        <span class="app-status">{PROJECT_LABEL[projectStatus()]}</span>
      </Show>
      <Show when={STATUS_LABEL[status()]}>
        <span class="app-status">{STATUS_LABEL[status()]}</span>
      </Show>

      <div class="toolbar-spacer" />

      <div class="toolbar-controls">
        <Popover
          label="Analysis params"
          title="Shared analysis parameters (synced across tools)"
          testid="toolbar.params"
        >
          <SharedParamsForm />
        </Popover>

        <Switch
          class="toolbar-switch"
          checked={filterEnabled()}
          onChange={setFilterEnabled}
          title="Apply the filter graph to preview (and analysis)"
        >
          <Switch.Label class="toolbar-label">Filter</Switch.Label>
          <Switch.Input class="toolbar-switch-input" data-testid="toolbar.filter" />
          <Switch.Control class="toolbar-switch-control">
            <Switch.Thumb class="toolbar-switch-thumb" />
          </Switch.Control>
        </Switch>

        <div class="toolbar-group" title="Preview output gain">
          <span class="toolbar-label">Output</span>
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
              <Slider.Thumb class="gain-thumb">
                <Slider.Input class="gain-input" data-testid="toolbar.output.gain" />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
          <span class="toolbar-readout">{Math.round(outputGain() * 100)}%</span>
        </div>

        <div class="toolbar-group" title="Preview output level">
          <span class="toolbar-label">Level</span>
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

        <div class="toolbar-field">
          <Combobox
            options={deviceOptions()}
            value={outputDeviceId()}
            onChange={setOutputDeviceId}
            emptyLabel="System default"
            label="Output device"
          />
        </div>

        <Popover label="View" title="UI scale and theme" testid="toolbar.view">
          <div class="params-form">
            <div class="params-heading">
              UI scale <span class="params-dim">{Math.round(fontScale() * 100)}%</span>
            </div>
            <div class="params-field">
              <span class="params-label">Text size</span>
              <div class="toolbar-group">
                <Button
                  class="toolbar-btn toolbar-btn-scale"
                  disabled={fontScale() <= FONT_SCALE_MIN}
                  title="Decrease UI font size"
                  aria-label="Decrease UI font size"
                  onClick={() => nudgeFontScale(-1)}
                >
                  A−
                </Button>
                <Button
                  class="toolbar-btn toolbar-btn-scale"
                  disabled={fontScale() >= FONT_SCALE_MAX}
                  title="Increase UI font size"
                  aria-label="Increase UI font size"
                  onClick={() => nudgeFontScale(1)}
                >
                  A+
                </Button>
              </div>
            </div>

            <div class="params-heading">Theme</div>
            <div class="params-field">
              <span class="params-label">Colour</span>
              <div class="toolbar-group">
                <For each={THEME_PREFERENCES}>
                  {(preference) => (
                    <Button
                      class="toolbar-btn toolbar-btn-theme"
                      aria-pressed={themePreference() === preference}
                      title={`${THEME_LABEL[preference]} theme`}
                      aria-label={`${THEME_LABEL[preference]} theme`}
                      onClick={() => setThemePreference(preference)}
                    >
                      {THEME_LABEL[preference]}
                    </Button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Popover>
      </div>

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
