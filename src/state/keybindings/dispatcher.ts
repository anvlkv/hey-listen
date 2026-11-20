import { COMMANDS } from "./registry";
import type { CommandDef } from "./types";

/**
 * The one window-level `keydown` dispatcher (M24.B's registry seam).
 *
 * Its **guard** is the point of shipping it here: a bare key and an editing chord never
 * fire inside a text field, so `Mod+Z` in an annotation editor stays native text undo
 * instead of undoing the project ([`hotkeys.md`](../../../docs/hotkeys.md) → "Guards").
 *
 * Matching is the minimal `Mod+<letter>` subset the shipped commands need; M24.B replaces
 * it with the full parser (scopes, `Ctrl`, named keys) and the stored bindings.
 */

/** `Mod` is ⌘ on macOS and Ctrl elsewhere (`docs/hotkeys.md` → "Binding syntax"). */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** The elements where typing owns the keys. */
const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Whether `target` is a text field, a select or a contenteditable region. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || FIELD_TAGS.has(target.tagName);
}

/** Whether `event` presses `binding`, spelled `Mod+Z` / `Shift+Mod+Z`. */
function matches(binding: string, event: KeyboardEvent): boolean {
  const parts = binding.split("+");
  const key = parts.pop();
  if (!key || key.toLowerCase() !== event.key.toLowerCase()) return false;
  if (event.shiftKey !== parts.includes("Shift")) return false;
  if (event.altKey !== parts.includes("Alt")) return false;
  // An explicit `Ctrl` ("only where needed") is not among the shipped bindings, so the
  // other platform's accelerator must be released.
  if (event.metaKey !== (IS_MAC && parts.includes("Mod"))) return false;
  return event.ctrlKey === (!IS_MAC && parts.includes("Mod"));
}

/** Whether `command` should fire for `event`: binding, guard, repeat, then `when`. */
function claims(command: CommandDef, event: KeyboardEvent): boolean {
  if (!command.defaultBinding || !matches(command.defaultBinding, event)) return false;
  if (event.repeat && !command.allowRepeat) return false;
  if (isTextField(event.target) && !command.allowInInput) return false;
  return command.when?.() ?? true;
}

/**
 * Install the dispatcher. Returns the disposer, which `App` runs on cleanup.
 *
 * Firing calls `preventDefault()` but does not stop propagation, so a widget that wants
 * the key still sees it.
 */
export function initDispatcher(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const command = COMMANDS.find((candidate) => claims(candidate, event));
    if (!command) return;
    event.preventDefault();
    void command.run();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
