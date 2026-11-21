# Keyboard control (hotkeys, palette, shortcut explorer)

Plan for **M24.B** (see [`roadmap.md`](roadmap.md)). The goal is threefold: drive the
preview transport from the keyboard, navigate the whole app without the mouse, and make
every binding **explorable and configurable**.

## Principles

- **One registry, no side channels.** A command is declared once and the dispatcher, the
  command palette, the shortcuts window, tooltips and `aria-keyshortcuts` all read the same
  definition. A new action registers a command instead of attaching an ad-hoc listener.
- **Do not break typing or focused controls.** A bare key never fires in a text field,
  select, contenteditable or while a button owns Space/Enter. Modifier chords such as
  `Mod+K` may opt in to working inside a text field.
- **Bindings are app-level chrome.** They live in `localStorage` (like the font scale and
  the annotations rail), never in the project file, so opening a project does not change
  how the keyboard works.
- **Portable spelling.** Bindings are stored with `Mod`, not `Meta`/`Ctrl`: `Mod` renders
  as ⌘ on macOS and Ctrl elsewhere. A config moves between platforms unchanged.
- **Actions are honest about scope.** A command declares when it is available; the registry
  rejects a binding that can only ever conflict.
- **The native menu stays native.** File/Edit/Window accelerators remain owned by the OS
  menu for this milestone and are shown **read-only** in the explorer. Making them
  rebindable means rebuilding the Tauri menu from the bindings (a follow-up).

## Command model

```ts
type CommandScope = "global" | "timeline" | "workbench" | "graph" | "annotations" | "dialog";

interface CommandDef {
  id: CommandId;              // a typed union, e.g. "transport.playPause"
  title: string;              // "Play / Pause"
  category: "Transport" | "Timeline" | "Navigate" | "Annotations" | "Graph" | "App";
  scope: CommandScope;
  when?: () => boolean;       // enabled / available right now
  run: () => void | Promise<void>;
  allowInInput?: boolean;     // default false
  allowRepeat?: boolean;      // default false (seek/zoom opt in)
  keywords?: string[];        // palette search
}
```

A command's **binding** is not on `CommandDef` — it lives in `DEFAULT_BINDINGS`
(`defaults.ts`), merged with the user's overrides by the store (`store.ts`), so the
dispatcher, the palette and the shortcuts window all read one resolved value.

The registry is a flat list (`state/keybindings/registry.ts`). Commands do not import
components directly; they call store/action functions (`openTool`, transport, annotations, …) so
the registry stays testable without the shell.

### Binding syntax

| Form | Meaning |
| --- | --- |
| `Space`, `Enter`, `Escape`, `Home`, `End`, `ArrowLeft`, `F6`, `Delete` | named keys |
| `A`…`Z`, `0`…`9` | letters/digits, matched case-insensitively |
| `[`, `]`, `,`, `.`, `/`, `?`, `=`, `-`, `+` | punctuation, matched by the typed key |
| `Mod+…` | ⌘ on macOS, Ctrl elsewhere |
| `Shift+…`, `Alt+…` | modifiers; `Alt` is Option on macOS |
| `Ctrl+…` | an explicit Ctrl even on macOS (used only where needed) |

Parsing normalizes modifier order and key aliases (`ArrowLeft` / `Left`, `Esc` /
`Escape`), formats for display with platform glyphs (`⌘⇧K` vs `Ctrl+Shift+K`), and rejects
an empty/non-key binding. A stored value of `null` means **intentionally unbound**.

### Matching

- Resolve `Mod` from the platform, then compare modifiers and the normalized
  `KeyboardEvent.key` (letters/digits/space/arrows/punctuation). Ignore pure modifier
  keydowns, `Dead`/`Unidentified`, and composition events.
- `event.repeat` is ignored unless the command declares `allowRepeat` (seek, zoom, nudge).
- `event.defaultPrevented` stops dispatch.
- Prefer the most specific scope over `global`; if two commands in the same scope match,
  the first in registry order wins and the conflict is reported by the shortcuts window (it should
  never be saveable in the first place).
- Fire with `preventDefault()`; do not stop propagation, so library widgets can still see
  the event when they are meant to.

### Guards

| Target | Bare keys | With `Mod`/`Alt` | `allowInInput` |
| --- | --- | --- | --- |
| text input, textarea, select, contenteditable | blocked | blocked (except explicit opt-in) | allowed |
| focused button / link / `role=button` | blocked (Space/Enter belong to the control) | allowed | allowed |
| timeline canvas / graph canvas / body | allowed | allowed | allowed |
| open **modal dialog** (palette, About) | only dialog-scope / `Escape` | only dialog-scope | — |
| the **Keyboard Shortcuts** window | its recorder owns the keys: `Escape` cancels a recording, then closes the window | — | — |

The Keyboard Shortcuts window is a separate app-wide window (label `shortcuts`), not a
modal: the project window stays usable and the dispatcher is unaffected while it is
focused.

The Timeline canvas **is focusable** (M23; D-14 added the keyboard set and the ARIA live
region); clicking it puts the transport keys in their natural context. Until M24.B's
registry owns them, the canvas-local keys are a small subset — see the note under the
transport table. The **palette** command opts in to working in a text field
(`allowInInput`); `?` does not, so it stays a normal character while typing. Use Help →
Keyboard Shortcuts from a text field.

## Default bindings

Defaults are a proposal; every one is rebindable except the read-only native menu items.

### Transport

**Confirmed:** `Space` is the primary play/pause binding; `Shift+Space` stops while keeping
the playhead. It works whenever the Timeline/canvas or the page body has focus, and never
steals Space from a text field or a focused button (where Space belongs to the control).

| Command | Default | Annotations |
| --- | --- | --- |
| Play / Pause | `Space` | Primary action; resumes from the playhead when it is in the window. |
| Stop (keep playhead) | `Shift+Space` | Silences; the line stays where it is. |
| Loop | `L` | Window-following loop on/off. |
| Seek back / forward | `ArrowLeft` / `ArrowRight` | 1 % of the **visible span**, floored at 1 ms. |
| Seek 10× | `Shift+ArrowLeft` / `Shift+ArrowRight` | Ten nudges. |
| Seek one frame | `Alt+ArrowLeft` / `Alt+ArrowRight` | `1 / sampleRate`. |
| Return to start / jump to end | `Home` / `End` | Return-to-start stops a loaded region that starts after 0; End is clamped into the loaded region. Both move the playhead, not the window. |
| Window start / end | `PageUp` / `PageDown` | Step through the committed analysis-window history. |
| Set window start / end at playhead | `[` / `]` | The fast annotation-window gesture. |
| Follow playhead | `F` | Auto-pan while playing. |

> **Delivered (M24.B).** The whole table is live through the command registry — `Space`,
> the arrows, `Home`, `End`, `PageUp`/`PageDown`, `[`/`]`, `F` and `L` are registry commands
> — and the M23/D-14 canvas-local map was folded into the app-level dispatcher.

### Timeline / view

| Command | Default |
| --- | --- |
| Zoom to window | `Z` |
| Fit all | `0` |
| Zoom in / out | `+` / `-` (and `=`) |
| Select window (drag gesture) | `Shift` + drag (no binding) |

### Annotations

| Command | Default | Scope |
| --- | --- | --- |
| Annotation at playhead | `N` | global (not in a text field) |
| Toggle annotations rail | `Mod+Shift+A` | global |
| Analyze selected annotation | `Mod+Enter` | annotations |
| Edit selected annotation | `E` | annotations |
| Delete selected annotation | `Mod+Backspace` | annotations |

### Navigate

| Command | Default |
| --- | --- |
| Command palette | `Mod+K` |
| Keyboard shortcuts | `?` (Shift+`/`) |
| Next / previous region | `F6` / `Shift+F6` |
| Focus analyzer search | `Mod+Shift+F` |
| Next / previous Workbench tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Activate Workbench tab 1–9 | `Mod+1` … `Mod+9` |
| Open Filter graph / Synth graph | via the palette (no default, avoids collisions) |

### Graph editor

| Command | Default | Scope |
| --- | --- | --- |
| Render once (synth) | `Mod+Enter` | graph |
| Toggle Live (synth) | `Mod+Shift+L` | graph |
| Delete selected nodes / links | `Delete` / `Backspace` | graph |
| Cancel palette drag | `Escape` | graph |

### Native menu (read-only)

`Mod+N` New · `Mod+O` Open · `Mod+S` Save · `Mod+Shift+S` Save As · `Mod+Shift+N` New
Window · `Mod+Q` Quit · Help → About / Check for Updates… / Keyboard Shortcuts. These keep
their OS accelerators; the explorer lists them so the user can see the whole keyboard
surface in one place. **Undo / Redo are not native menu items** — M24.A makes them the first
two registry commands (`Mod+Z` / `Shift+Mod+Z`, `allowInInput: false`), so a focused text
field keeps native text undo. See [`undo-redo.md`](undo-redo.md).

## Command palette

- Opens with `Mod+K` (from anywhere, including a text field), as a modal Kobalte dialog
  with a combobox input — portaled into the current document so popped-out windows work.
- Sources, in sections: **Commands** (registry), **Tools** (every analyzer + the two graph
  editors), **Open tabs**, and **Recent** (the last few commands/tools). Annotations can be a
  later source.
- Fuzzy matching over title, category, keywords and tool description; arrow keys move,
  `Enter` runs, `Escape` closes, `Tab` accepts the highlighted completion.
- Each row shows its binding chip (`⌘K`), so the palette doubles as a discovery surface.
- Running a command closes the palette unless the command opts out (e.g. "keep open").
  The *Keyboard Shortcuts* command opens the app-wide [shortcuts
  window](#keyboard-shortcuts-window) (the palette itself stays a modal dialog).

## Keyboard Shortcuts window

- Opened from `?`, Help → **Keyboard Shortcuts…**, and the palette's *Keyboard
  Shortcuts* command. An app-wide Tauri window labeled `shortcuts` (its own app window,
  like the log preview, but not parented to a project), **not** a modal: opening it leaves
  the project window usable. It is not
  aliased to a project and is not tracked in `WindowRegistry`, so it survives a project
  load. Its list uses the shared `ScrollArea`, so the bar sits in its own gutter.
- **Search** filters by command title/category; groups are collapsible; each row shows the
  title, description, scope, the **default** binding and the **current** one (with a
  *modified* marker).
- **Record** per row: click *Edit*, then press a combination. The window listens in
  capture phase, shows *Press keys…*, and validates:
  - modifier-only / unmodified reserved keys are rejected with a reason;
  - a conflict shows *Already used by “X”* before saving (including native accelerators);
  - `Backspace`/`Delete` unbinds, `Escape` cancels the **recording** (then closes the
    window), *Reset* restores the default.
- **Reset all** restores every default; a **Native menu** section is read-only.
- Changes save immediately (app-level), update the dispatcher and palette chips live, and
  announce the change in an `aria-live` region.

## Persistence

```json
{
  "version": 1,
  "bindings": {
    "transport.playPause": "Space",
    "timeline.fitAll": "0",
    "annotations.delete": null
  }
}
```

- `localStorage` key `hey-listen:keybindings`, read once at module load.
- Missing command id → its default; `null` → unbound; an unknown id is ignored (and
  dropped on the next write).
- Platform-neutral `Mod`/`Alt`; display formatting is derived, never stored.
- A `storage` event reloads the bindings, so another project window (or a popout) picks up
  a rebind without a restart.
- **Not** in the project file: rebinding is a user preference, not project content.

## Files

| Path | Role |
| --- | --- |
| `src/state/keybindings/types.ts` | `Binding`, `CommandDef`, scopes |
| `src/state/keybindings/parse.ts` | parse / format / normalize / match / conflict helpers (pure, unit-tested) |
| `src/state/keybindings/defaults.ts` | the default table above |
| `src/state/keybindings/registry.ts` | command definitions + handlers |
| `src/state/keybindings/store.ts` | signals, load/save/migration, `storage` sync, reset |
| `src/state/keybindings/dispatcher.ts` | the single `keydown` listener and its guards |
| `src/state/keybindings/palette.ts` | fuzzy ranking over commands/tools/tabs (pure) |
| `src/components/CommandPalette.tsx` | the palette dialog |
| `src/ShortcutsApp.tsx` | the `shortcuts` window root (renders `ShortcutsWindow`) |
| `src/components/ShortcutsWindow.tsx` | the explorer / rebinding UI (inside the `shortcuts` window) |
| `src/lib/windowRole.ts` | `isShortcutsWindow` (window label `shortcuts`) |
| `src/components/Tooltip.tsx` | optional `shortcut` chip |
| `src-tauri/src/commands/window.rs` | `open_shortcuts_window_for` / `open_shortcuts_window` |
| `src-tauri/capabilities/default.json` | capability window list includes `shortcuts` |
| `src-tauri/src/menu.rs`, `src/state/menu.ts` | Help → Keyboard Shortcuts (`shortcuts` action) |

## Testing

- **Unit** (`npm run test:unit`): parse/format round-trips (`Mod` vs explicit `Ctrl`,
  platform glyphs), key normalization, matching with modifiers and repeats, conflict
  detection, load/save/migration (`null`, unknown ids, bad JSON), palette ranking.
- **E2E** (`q4-keyboard`, named to sort **before** `t-close-main`): `Space` toggles the
  transport; arrows seek; `N` adds an annotation at the playhead; `Mod+K` opens the palette
  and runs a command; `?` opens the shortcuts window; rebinding makes the old key inert and the new
  one work; a conflicting binding is rejected; typing in the annotation editor and the analyzer
  search never triggers a command; bindings survive a reload; a focused button keeps
  Space/Enter. The spec switches into the `shortcuts` window with
  `browser.tauri.switchWindow` before addressing its rows, then switches back — the test
  ids are unchanged (`shortcuts.*`).
- **Selectors:** `palette.dialog`, `palette.input`, `palette.item.<id>`,
  `shortcuts.dialog`, `shortcuts.search`, `shortcuts.row.<id>`,
  `shortcuts.record.<id>`, `shortcuts.resetAll`.

## Deferred

The remaining items are the **D-25** extras — chords, modifier-only bindings,
per-project bindings, native menu accelerators, keymap import/export, preset keymaps and
mouse gestures ([`deferred.md`](deferred.md)) — none of which are part of M24.B's first
delivery.
