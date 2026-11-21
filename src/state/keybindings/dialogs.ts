import { createSignal } from "solid-js";

/**
 * Open state for the two keyboard dialogs ([`hotkeys.md`](../../../docs/hotkeys.md) →
 * "Command palette" / "Keyboard Shortcuts dialog"). The registry's `navigate.*` commands
 * flip these signals; Phase 3 mounts `<CommandPalette>` / `<ShortcutsDialog>` against
 * them.
 */
export const [paletteOpen, setPaletteOpen] = createSignal(false);
export const [shortcutsOpen, setShortcutsOpen] = createSignal(false);

/** Open the command palette, closing the shortcuts dialog first (they are both modal). */
export function openCommandPalette(): void {
  if (shortcutsOpen()) setShortcutsOpen(false);
  setPaletteOpen(true);
}

/** Open the Keyboard Shortcuts dialog, closing the command palette first. */
export function openShortcutsDialog(): void {
  if (paletteOpen()) setPaletteOpen(false);
  setShortcutsOpen(true);
}
