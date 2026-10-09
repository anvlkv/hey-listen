import { Switch } from "@kobalte/core/switch";
import { Slider } from "@kobalte/core/slider";
import { invoke } from "@tauri-apps/api/core";
import { createSignal, onMount, Show } from "solid-js";
import Combobox from "./Combobox";
import { filterEnabled, setFilterEnabled } from "../state/graph";
import {
  applyOutputGain,
  outputDeviceId,
  outputDevices,
  outputGain,
  refreshOutputDevices,
  setOutputDeviceId,
} from "../state/output";
import { projectError, projectName, projectStatus } from "../state/project";
import { error, status } from "../state/source";

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
 * filter-graph bypass toggle and the preview output (gain + device), which drive
 * the core (ADR-9). The audio source picker lives in the bottom-left Source region
 * (see `docs/ui-layout.md`).
 */
export default function Toolbar() {
  const [backend, setBackend] = createSignal("…");

  onMount(() => {
    invoke<string>("ping")
      .then((msg) => setBackend(msg))
      .catch((err) => setBackend(`error: ${String(err)}`));
    void refreshOutputDevices();
  });

  const deviceOptions = () =>
    outputDevices().map((device) => ({
      value: device.id,
      label: device.isDefault ? `${device.name} (default)` : device.name,
    }));

  return (
    <header class="app-toolbar">
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
        <Switch
          class="toolbar-switch"
          checked={filterEnabled()}
          onChange={setFilterEnabled}
          title="Apply the filter graph to preview (and analysis)"
        >
          <Switch.Label class="toolbar-label">Filter</Switch.Label>
          <Switch.Input class="toolbar-switch-input" />
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
                <Slider.Input class="gain-input" />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
          <span class="toolbar-readout">{Math.round(outputGain() * 100)}%</span>
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
      </div>

      <Show when={error()}>
        <span class="app-status app-status-error" title={error() ?? undefined}>
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
      <span class="app-status">Rust backend: {backend()}</span>
    </header>
  );
}
