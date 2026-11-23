import type { JSX } from "solid-js";
import { onMount } from "solid-js";
import ShortcutsWindow from "./components/ShortcutsWindow";
import { refreshThemes } from "./state/themes";
import "./App.css";

/**
 * The app-wide **Keyboard Shortcuts** window.
 *
 * A singleton Tauri window (like the log preview, ADR-33) rather than a modal: the
 * explorer lists app-level bindings, so it starts no project state and asks the core for
 * no source. Opened from `?`, Help → Keyboard Shortcuts…, and the palette
 */
export default function ShortcutsApp(): JSX.Element {
  onMount(() => {
    // Installed themes live in the app config dir; a separate webview must load them.
    void refreshThemes();
  });

  return (
    <div class="popout-shell" data-testid="shortcuts.window">
      <ShortcutsWindow />
    </div>
  );
}
