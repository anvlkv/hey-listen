import { Switch } from "@kobalte/core/switch";
import { Slider } from "@kobalte/core/slider";
import { Meter } from "@kobalte/core/meter";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import Button from "./Button";
import Combobox from "./Combobox";
import Icon from "./Icon";
import Popover from "./Popover";
import SelectField from "./SelectField";
import Tooltip from "./Tooltip";
import SharedParamsForm from "./analyzer/SharedParamsForm";
import McpPopover from "./McpPopover";
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
import { notes } from "../state/notes";
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  fontScale,
  notesPanelOpen,
  nudgeFontScale,
  toggleNotesPanel,
} from "../state/settings";
import {
  activeSlot,
  activeTheme,
  activeThemeId,
  deleteTheme,
  exportThemeFile,
  importThemeFile,
  isBuiltinTheme,
  listThemeSummaries,
  pickThemeExportPath,
  pickThemeImportPath,
  refreshThemes,
  revealThemeDir,
  setSlotTheme,
  setThemeMode,
  THEME_MODES,
  themeDir,
  themePreference,
  type ThemeMode,
} from "../state/themes";
import { error, status } from "../state/source";
import { setAboutOpen } from "../state/menu";
import type { IconName } from "../lib/icons";
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

const MODE_LABEL: Record<ThemeMode, string> = {
  auto: "Auto",
  dark: "Dark",
  light: "Light",
};

/** The icon for each theme mode. */
const MODE_ICON: Record<ThemeMode, IconName> = {
  auto: "circle-half-stroke",
  dark: "moon",
  light: "sun",
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
  const [themeMessage, setThemeMessage] = createSignal<string | null>(null);
  const [themePath, setThemePath] = createSignal("");

  onMount(() => {
    void refreshMcpStatus();
    void themeDir()
      .then(setThemePath)
      .catch(() => setThemePath(""));
  });
  // Poll the preview output level for the meter; stop when the toolbar unmounts.
  onCleanup(initOutputMeter());

  const themeOptions = () =>
    listThemeSummaries().map((theme) => ({ value: theme.id, label: theme.name }));

  async function onImportTheme() {
    setThemeMessage(null);
    const path = await pickThemeImportPath();
    if (!path) return;
    try {
      const summary = await importThemeFile(path);
      // Adopt the imported theme in the slot the user is currently looking at.
      setSlotTheme(activeSlot(), summary.id);
      setThemeMessage(`Imported “${summary.name}”.`);
    } catch (err) {
      setThemeMessage(`Import failed: ${String(err)}`);
    }
  }

  async function onExportTheme() {
    setThemeMessage(null);
    const theme = activeTheme();
    const path = await pickThemeExportPath(`${theme.meta.id}.heyltheme`);
    if (!path) return;
    try {
      await exportThemeFile(theme.meta.id, path);
      setThemeMessage(`Exported “${theme.meta.name}”.`);
    } catch (err) {
      setThemeMessage(`Export failed: ${String(err)}`);
    }
  }

  async function onDeleteTheme() {
    const id = activeThemeId();
    if (isBuiltinTheme(id)) return;
    setThemeMessage(null);
    try {
      await deleteTheme(id);
      setThemeMessage("Theme deleted.");
    } catch (err) {
      setThemeMessage(`Delete failed: ${String(err)}`);
    }
  }

  const deviceOptions = () =>
    outputDevices().map((device) => ({
      value: device.id,
      label: device.isDefault ? `${device.name} (default)` : device.name,
    }));

  return (
    <header class="app-toolbar" data-testid="region.toolbar">
      <span class="toolbar-name" data-testid="toolbar.project.name" title={projectName()}>
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
          label="Analysis parameters"
          title="Shared analysis params (synced across every tool)"
          icon="sliders"
          testid="toolbar.params"
        >
          <SharedParamsForm />
        </Popover>

        <Tooltip label="Apply the filter graph to preview (and analysis)">
          <Switch class="toolbar-switch" checked={filterEnabled()} onChange={setFilterEnabled}>
            <Switch.Label class="toolbar-label icon-label">
              <Icon name="filter" />
              Filter
            </Switch.Label>
            <Switch.Input class="toolbar-switch-input" data-testid="toolbar.filter" />
            <Switch.Control class="toolbar-switch-control">
              <Switch.Thumb class="toolbar-switch-thumb" />
            </Switch.Control>
          </Switch>
        </Tooltip>

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
                <Slider.Thumb class="gain-thumb">
                  <Slider.Input class="gain-input" data-testid="toolbar.output.gain" />
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

        <Popover
          label="Appearance"
          title="UI scale and theme"
          icon="circle-half-stroke"
          testid="toolbar.view"
          onOpen={() => void refreshThemes()}
        >
          <div class="params-form">
            <div class="params-heading">
              UI scale <span class="params-dim">{Math.round(fontScale() * 100)}%</span>
            </div>
            <div class="params-field">
              <span class="params-label">Text size</span>
              <div class="toolbar-group">
                <Tooltip label="Decrease UI font size">
                  <Button
                    class="toolbar-btn toolbar-btn-scale icon-btn"
                    disabled={fontScale() <= FONT_SCALE_MIN}
                    aria-label="Decrease UI font size"
                    onClick={() => nudgeFontScale(-1)}
                  >
                    <Icon name="minus" />
                  </Button>
                </Tooltip>
                <Tooltip label="Increase UI font size">
                  <Button
                    class="toolbar-btn toolbar-btn-scale icon-btn"
                    disabled={fontScale() >= FONT_SCALE_MAX}
                    aria-label="Increase UI font size"
                    onClick={() => nudgeFontScale(1)}
                  >
                    <Icon name="plus" />
                  </Button>
                </Tooltip>
              </div>
            </div>

            <div class="params-heading">
              Theme <span class="params-dim">{activeTheme().meta.name}</span>
            </div>
            <div class="params-field">
              <span class="params-label">Mode</span>
              <div class="toolbar-group">
                <For each={THEME_MODES}>
                  {(mode) => (
                    <Tooltip label={`${MODE_LABEL[mode]} mode`}>
                      <Button
                        class="toolbar-btn toolbar-btn-theme icon-btn"
                        aria-pressed={themePreference().mode === mode}
                        aria-label={`${MODE_LABEL[mode]} mode`}
                        onClick={() => setThemeMode(mode)}
                      >
                        <Icon name={MODE_ICON[mode]} />
                      </Button>
                    </Tooltip>
                  )}
                </For>
              </div>
            </div>
            <div class="params-field">
              <span class="params-label">Dark theme</span>
              <SelectField
                options={themeOptions()}
                value={themePreference().darkThemeId}
                onChange={(id) => setSlotTheme("dark", id)}
                ariaLabel="Dark slot theme"
                disabled={themePreference().mode === "light"}
              />
            </div>
            <div class="params-field">
              <span class="params-label">Light theme</span>
              <SelectField
                options={themeOptions()}
                value={themePreference().lightThemeId}
                onChange={(id) => setSlotTheme("light", id)}
                ariaLabel="Light slot theme"
                disabled={themePreference().mode === "dark"}
              />
            </div>
            <div class="params-field">
              <span class="params-label">Themes</span>
              <div class="params-actions">
                <Tooltip label="Import a .heyltheme file">
                  <Button
                    class="toolbar-btn icon-btn"
                    aria-label="Import theme"
                    onClick={() => void onImportTheme()}
                  >
                    <Icon name="file-import" />
                  </Button>
                </Tooltip>
                <Tooltip label="Export the current theme">
                  <Button
                    class="toolbar-btn icon-btn"
                    aria-label="Export theme"
                    onClick={() => void onExportTheme()}
                  >
                    <Icon name="file-export" />
                  </Button>
                </Tooltip>
                <Tooltip
                  label={
                    isBuiltinTheme(activeThemeId())
                      ? "Built-in themes cannot be deleted"
                      : "Delete the current theme"
                  }
                >
                  <Button
                    class="toolbar-btn icon-btn"
                    disabled={isBuiltinTheme(activeThemeId())}
                    aria-label="Delete theme"
                    onClick={() => void onDeleteTheme()}
                  >
                    <Icon name="trash" />
                  </Button>
                </Tooltip>
                <Tooltip label="Reveal the themes folder">
                  <Button
                    class="toolbar-btn icon-btn"
                    aria-label="Reveal themes folder"
                    onClick={() => void revealThemeDir()}
                  >
                    <Icon name="folder-open" />
                  </Button>
                </Tooltip>
              </div>
            </div>
            <Show when={themePath()}>
              <div class="params-note params-dim params-path" title={themePath()}>
                {themePath()}
              </div>
            </Show>
            <Show when={themeMessage()}>
              <div class="params-note" data-testid="toolbar.theme.message">
                {themeMessage()}
              </div>
            </Show>
          </div>
        </Popover>

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

        {/* The Notes rail toggle sits apart at the right end of the toolbar. */}
        <span class="toolbar-divider" aria-hidden="true" />
        <Tooltip label="Notes panel">
          <Button
            class="toolbar-btn icon-btn toolbar-btn-notes"
            data-testid="toolbar.notes"
            aria-label="Toggle the notes panel"
            aria-pressed={notesPanelOpen()}
            onClick={toggleNotesPanel}
          >
            <Icon name="note-sticky" />
            <Show when={!notesPanelOpen() && notes().length > 0}>
              <span class="toolbar-badge" data-testid="toolbar.notes.badge">
                {notes().length}
              </span>
            </Show>
          </Button>
        </Tooltip>
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
