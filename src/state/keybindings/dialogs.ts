import { createSignal } from "solid-js";
import { invoke } from "../../lib/ipc";

/**
 * The command palette's open state ([`hotkeys.md`](../../../docs/hotkeys.md) →
 * "Command palette"). The registry's `navigate.commandPalette` command flips the signal;
 * `<CommandPalette>` is mounted against it.
 *
 * The **Keyboard Shortcuts** explorer is not a dialog signal: it is an app-wide Tauri
 * window, raised through [`openShortcutsWindow`].
 */
export const [paletteOpen, setPaletteOpen] = createSignal(false);

/** Open the command palette. */
export function openCommandPalette(): void {
  setPaletteOpen(true);
}

/** Open (or raise) the app-wide Keyboard Shortcuts window. */
export function openShortcutsWindow(): void {
  void invoke("open_shortcuts_window").catch((err) =>
    console.error("could not open the Keyboard Shortcuts window", err),
  );
}
