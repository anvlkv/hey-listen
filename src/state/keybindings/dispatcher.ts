import { matchBinding, parseBinding, type Platform } from "./parse";
import { COMMANDS } from "./registry";
import { getBinding } from "./store";
import { resolveScope } from "./scope";
import type { Binding, CommandDef, CommandScope } from "./types";

/**
 * The one window-level `keydown` dispatcher.
 *
 * It reads each command's binding from the store, resolves the current **scope**, and
 * prefers the most-specific scope over `global`. Its guards keep the keyboard safe: a
 * bare key never fires inside a text field or on a focused button, and held-key repeats
 * are ignored unless the command opts in.
 */

/** `Mod` is ⌘ on macOS and Ctrl elsewhere. */
const PLATFORM: Platform = /Mac|iPhone|iPad/.test(navigator.platform) ? "mac" : "other";

/** Modifier keydowns carry no chord of their own. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
/** Keys whose `KeyboardEvent.key` never names a binding. */
const IGNORED_KEYS = new Set(["Dead", "Unidentified"]);
/** The elements where typing owns the keys. */
const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
/** Keys a focused button/link already owns. */
const BUTTON_KEYS = new Set([" ", "Enter"]);
/** Elements whose Space/Enter activation must not be stolen by a bare binding. */
const BUTTON_SELECTOR = 'button, a, [role="button"]';

/** Whether `target` is a text field, a select or a contenteditable region. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || FIELD_TAGS.has(target.tagName);
}

/** Whether `target` is a button, a link or a `role=button` control. */
function isButton(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(BUTTON_SELECTOR) !== null;
}

/** Whether a bare (unmodified) binding would collide with a focused button's Space/Enter. */
function collidesWithButton(event: KeyboardEvent, binding: string): boolean {
  if (!BUTTON_KEYS.has(event.key) || !isButton(event.target)) return false;
  const parsed = parseBinding(binding);
  return parsed != null && !(parsed.mod || parsed.ctrl || parsed.alt);
}

/**
 * Whether `command` claims `event`: its binding matches, repeats are allowed, and the
 * text-field, button and `when` guards all pass.
 */
function claims(command: CommandDef, event: KeyboardEvent, binding: string): boolean {
  if (!matchBinding(binding, event, PLATFORM)) return false;
  if (event.repeat && !command.allowRepeat) return false;
  if (isTextField(event.target) && !command.allowInInput) return false;
  if (collidesWithButton(event, binding)) return false;
  return command.when?.() ?? true;
}

/** The first command in `scope` (then `global`) that claims `event`. */
function findCommand(scope: CommandScope, event: KeyboardEvent): CommandDef | undefined {
  const passes: CommandScope[] = scope === "global" ? ["global"] : [scope, "global"];
  for (const pass of passes) {
    for (const command of COMMANDS) {
      if (command.scope !== pass) continue;
      const binding: Binding = getBinding(command.id);
      if (binding && claims(command, event, binding)) return command;
    }
  }
  return undefined;
}

/**
 * Install the dispatcher. Returns the disposer, which `App` runs on cleanup.
 *
 * Firing calls `preventDefault()` but does not stop propagation, so a widget that wants
 * the key still sees it.
 */
export function initDispatcher(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (MODIFIER_KEYS.has(event.key) || IGNORED_KEYS.has(event.key)) return;
    const command = findCommand(resolveScope(), event);
    if (!command) return;
    event.preventDefault();
    void command.run();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
