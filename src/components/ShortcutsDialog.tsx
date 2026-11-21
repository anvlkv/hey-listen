import { Dialog } from "@kobalte/core/dialog";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { DEFAULT_BINDINGS } from "../state/keybindings/defaults";
import { setShortcutsOpen, shortcutsOpen } from "../state/keybindings/dialogs";
import {
  findConflict,
  formatBinding,
  normalizeBinding,
  type Platform,
} from "../state/keybindings/parse";
import { COMMANDS } from "../state/keybindings/registry";
import { getBinding, isModified, resetAllBindings, setBinding } from "../state/keybindings/store";
import type { CommandDef, CommandId } from "../state/keybindings/types";

/**
 * The **Keyboard Shortcuts** dialog ([`hotkeys.md`](../../../docs/hotkeys.md) →
 * "Keyboard Shortcuts dialog"): every command grouped by category, with its default and
 * current binding, plus the native menu's fixed accelerators.
 *
 * *Edit* records the next chord: Escape cancels, a bare Backspace/Delete unbinds, a
 * chord already claimed by another command in an overlapping scope is refused, and
 * anything else is normalized and saved. The recorder listens in the **capture** phase
 * so no other handler (the dispatcher, the search field, the dialog's own Escape) sees
 * the keys while it is armed.
 */

/** `Mod` is ⌘ on macOS and Ctrl elsewhere. */
const PLATFORM: Platform = /Mac|iPhone|iPad/.test(navigator.platform) ? "mac" : "other";

/** The dialog's group order. */
const CATEGORY_ORDER: CommandDef["category"][] = [
  "Transport",
  "Timeline",
  "Navigate",
  "Annotations",
  "Graph",
  "App",
];

/** Fixed native-menu accelerators (text only: the OS menu owns these). */
const NATIVE_MENU: { label: string; binding: string }[] = [
  { label: "New Project", binding: "Mod+N" },
  { label: "Open Project…", binding: "Mod+O" },
  { label: "Save", binding: "Mod+S" },
  { label: "Save As…", binding: "Shift+Mod+S" },
  { label: "New Window", binding: "Shift+Mod+N" },
  { label: "Quit", binding: "Mod+Q" },
];

/** Modifier keys carry no chord of their own. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "OS"]);
/** A bare Tab belongs to focus traversal. */
const RESERVED_KEYS = new Set(["Tab"]);

/** Whether Shift/Ctrl/Alt/Meta is held (otherwise the key is bare). */
function hasModifier(event: KeyboardEvent): boolean {
  return event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
}

/**
 * Turn a `KeyboardEvent` into a portable chord, or `null` when it is not one we accept.
 * `Mod` is ⌘ on macOS and Ctrl elsewhere; off macOS the Windows/Meta key is rejected
 * because it has no portable spelling.
 */
function candidateBinding(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (PLATFORM === "mac") {
    if (event.metaKey) parts.push("Mod");
    if (event.ctrlKey) parts.push("Ctrl");
  } else {
    if (event.metaKey) return null;
    if (event.ctrlKey) parts.push("Mod");
  }
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return normalizeBinding(parts.join("+"));
}

/** Display a binding for the current platform, or an em dash when unbound. */
function display(binding: string | null): string {
  return binding ? formatBinding(binding, PLATFORM) : "—";
}

export default function ShortcutsDialog() {
  const [search, setSearch] = createSignal("");
  const [recording, setRecording] = createSignal<CommandId | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);

  createEffect(() => {
    if (!shortcutsOpen()) return;
    setSearch("");
    setNotice(null);
    setRecording(null);
  });

  const groups = createMemo(() => {
    const matches = (text: string) => {
      const needle = search().trim().toLowerCase();
      return !needle || text.toLowerCase().includes(needle);
    };
    return CATEGORY_ORDER.map((category) => ({
      title: category,
      commands: COMMANDS.filter(
        (command) =>
          command.category === category && matches(`${command.title} ${command.category}`),
      ),
    })).filter((group) => group.commands.length > 0);
  });

  const nativeRows = createMemo(() =>
    NATIVE_MENU.filter((entry) => {
      const needle = search().trim().toLowerCase();
      return !needle || entry.label.toLowerCase().includes(needle);
    }),
  );

  /** The others' current chords, for the conflict check (unbound commands skipped). */
  function otherBindings(command: CommandDef) {
    return COMMANDS.flatMap((other) => {
      if (other.id === command.id) return [];
      const binding = getBinding(other.id);
      return binding ? [{ id: other.id, binding, scope: other.scope }] : [];
    });
  }

  /** Handle one keydown while `command` is recording. */
  function record(event: KeyboardEvent, command: CommandDef) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setRecording(null);
      setNotice(null);
      return;
    }
    if (MODIFIER_KEYS.has(event.key)) {
      setNotice("Modifiers alone are not a shortcut — press a key too.");
      return;
    }
    // A bare Backspace/Delete unbinds; with a modifier it is an ordinary chord.
    if ((event.key === "Backspace" || event.key === "Delete") && !hasModifier(event)) {
      setBinding(command.id, null);
      setRecording(null);
      setNotice(`Unbound ${command.title}.`);
      return;
    }
    if (RESERVED_KEYS.has(event.key) && !hasModifier(event)) {
      setNotice(`${event.key} is reserved for navigation.`);
      return;
    }

    const candidate = candidateBinding(event);
    if (!candidate) {
      setNotice("That key cannot be used in a shortcut.");
      return;
    }

    const conflict = findConflict(
      { id: command.id, binding: candidate },
      otherBindings(command),
      command.scope,
      PLATFORM,
    );
    if (conflict) {
      const title = COMMANDS.find((other) => other.id === conflict.id)?.title ?? conflict.id;
      setNotice(`Already used by “${title}”.`);
      return;
    }

    setBinding(command.id, candidate);
    setRecording(null);
    setNotice(`Bound ${command.title} to ${display(candidate)}.`);
  }

  // Arm the capture-phase recorder only while a row is recording.
  createEffect(() => {
    const id = recording();
    if (!id) return;
    const command = COMMANDS.find((entry) => entry.id === id);
    if (!command) return;
    const onKeyDown = (event: KeyboardEvent) => record(event, command);
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
  });

  function close(open: boolean) {
    setShortcutsOpen(open);
    if (!open) setRecording(null);
  }

  return (
    <Dialog open={shortcutsOpen()} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay class="about-overlay" />
        <Dialog.Content class="shortcuts-dialog" data-testid="shortcuts.dialog">
          <header class="shortcuts-head">
            <div class="shortcuts-identity">
              <Dialog.Title class="shortcuts-title">Keyboard Shortcuts</Dialog.Title>
              <Dialog.Description class="shortcuts-hint">
                Choose <em>Edit</em> to record a new chord. Escape cancels, Backspace unbinds.
              </Dialog.Description>
            </div>
            <button
              type="button"
              class="about-link-button"
              data-testid="shortcuts.resetAll"
              onClick={() => {
                resetAllBindings();
                setRecording(null);
                setNotice("All shortcuts were reset to their defaults.");
              }}
            >
              Reset all
            </button>
          </header>

          <input
            class="palette-input shortcuts-search"
            data-testid="shortcuts.search"
            type="search"
            placeholder="Search shortcuts…"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />

          <Show when={notice()}>
            {(message) => (
              <p class="shortcuts-notice" data-testid="shortcuts.notice">
                {message()}
              </p>
            )}
          </Show>

          <div class="shortcuts-list">
            <For each={groups()}>
              {(group) => (
                <section class="shortcuts-group">
                  <h3 class="shortcuts-group-title">{group.title}</h3>
                  <For each={group.commands}>
                    {(command) => {
                      const current = () => getBinding(command.id);
                      const initial = DEFAULT_BINDINGS[command.id];
                      const isRecording = () => recording() === command.id;
                      return (
                        <div class="shortcuts-row" data-testid={`shortcuts.row.${command.id}`}>
                          <span class="shortcuts-row-main">
                            <span class="shortcuts-row-title">{command.title}</span>
                            <span class="shortcuts-row-scope">{command.scope}</span>
                          </span>
                          <span class="shortcuts-chips">
                            <kbd class="shortcuts-chip" title="Default">
                              {display(initial)}
                            </kbd>
                            <kbd
                              class="shortcuts-chip shortcuts-chip-current"
                              title="Current"
                              classList={{ "shortcuts-chip-changed": isModified(command.id) }}
                            >
                              {display(current())}
                            </kbd>
                            <Show when={isModified(command.id)}>
                              <span class="shortcuts-modified">modified</span>
                            </Show>
                          </span>
                          <button
                            type="button"
                            class="about-link-button shortcuts-record"
                            data-testid={`shortcuts.record.${command.id}`}
                            classList={{ "shortcuts-record-active": isRecording() }}
                            onClick={() => {
                              setRecording(command.id);
                              setNotice(null);
                            }}
                          >
                            {isRecording() ? "Press keys…" : "Edit"}
                          </button>
                        </div>
                      );
                    }}
                  </For>
                </section>
              )}
            </For>

            <Show when={nativeRows().length > 0}>
              <section class="shortcuts-group">
                <h3 class="shortcuts-group-title">Native menu</h3>
                <For each={nativeRows()}>
                  {(entry) => (
                    <div class="shortcuts-row shortcuts-row-native">
                      <span class="shortcuts-row-main">
                        <span class="shortcuts-row-title">{entry.label}</span>
                        <span class="shortcuts-row-scope">fixed by the system menu</span>
                      </span>
                      <span class="shortcuts-chips">
                        <kbd class="shortcuts-chip">{display(entry.binding)}</kbd>
                      </span>
                    </div>
                  )}
                </For>
              </section>
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
