import { createSignal, For, onMount, Show } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import Popover from "../Popover";
import SelectField from "../SelectField";
import Tooltip from "../Tooltip";
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
} from "../../state/themes";
import { FONT_SCALE_MAX, FONT_SCALE_MIN, fontScale, nudgeFontScale } from "../../state/settings";
import type { IconName } from "../../lib/icons";

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
 * The toolbar **Appearance** popover: UI scale and theme (mode, per-slot theme,
 * import/export/delete, and the theme folder). The core owns the theme state (see
 * `state/themes/`); this is the view plus the file-dialog actions.
 */
export default function AppearancePopover() {
  const [themeMessage, setThemeMessage] = createSignal<string | null>(null);
  const [themePath, setThemePath] = createSignal("");

  onMount(() => {
    void themeDir()
      .then(setThemePath)
      .catch(() => setThemePath(""));
  });

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

  return (
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
  );
}
