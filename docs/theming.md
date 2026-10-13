# Theming (exchangeable theme files)

Today the app ships a fixed **auto / dark / light** theme. The palette is authored in
**four places** and selected with a single `data-theme` attribute:

- `src/App.css` — ~70 `--*` custom properties in `:root[data-theme="dark"]` /
  `:root[data-theme="light"]` (the whole UI chrome).
- `src/state/settings.ts` — the `ChartTheme` record (`DARK_CHART` / `LIGHT_CHART`),
  read by every uPlot / canvas chart via `chartTheme()`.
- `src/components/analyzer/colormap.ts` — the spectrogram / matrix heatmap ramps
  (`DARK_STOPS` / `LIGHT_STOPS`).
- `src/components/Workbench.tsx` (dockview `themeDark` / `themeLight`) and
  `src/components/GraphEditor.tsx` (`FLOW_STYLE_*` for `solid-flow`).

This document makes the theme **data**: a `ThemeFile` that a user can install, export,
and share, applied on top of a built-in base.

## Goal

- Themes are **loadable files**, not just a dark/light switch.
- The built-in dark and light remain the **defaults**; a theme file is a **partial
  overlay** on one of them (so a theme can tweak a handful of colours without
  restating the whole palette, and unknown/new variables degrade gracefully).
- The existing `auto` mode keeps working, resolved through **slots**: the user picks a
  dark-slot theme and a light-slot theme, and `auto` follows the OS to choose a slot.

## Model

A theme is a versioned JSON payload (`src/lib/themeFile.ts`). The extension is
`.heyltheme`; the content is JSON (hand-editable and diffable).

```jsonc
{
  "kind": "hey-listen.theme",
  "formatVersion": 1,
  "meta": {
    "id": "solarized-dark",
    "name": "Solarized Dark",
    "description": "Solarized palette, dark base",
    "base": "dark"                    // "dark" | "light" — the built-in this overlays
  },
  // Optional partial overlay of the App.css custom properties. Unknown keys are kept
  // but ignored (forward-compatible); only existing variables take effect.
  "ui": {
    "bg": "#002b36",
    "panel": "#073642",
    "--accent": "#268bd2"
  },
  // Optional partial ChartTheme (fields from `ChartTheme` in state/settings.ts).
  "chart": {
    "series": "#268bd2",
    "seriesMin": "#859900",
    "seriesMax": "#b58900",
    "waveFill": "rgba(38, 139, 210, 0.22)"
  },
  // Optional heatmap ramp: an ordered list of [position 0..1, [r, g, b]] stops.
  "colormap": {
    "stops": [[0, [0, 20, 40]], [0.5, [60, 90, 160]], [1, [240, 245, 255]]]
  },
  // Optional solid-flow (--xy-*) overrides; the rest follows `base`.
  "flow": {
    "--xy-background-color": "#073642"
  }
}
```

- **`base`** selects which built-in provides the full baseline (CSS defaults, chart
  fields, colormap, dockview theme, `solid-flow` styles). Everything the theme omits
  falls back to that base.
- **`ui` keys** may be written with or without the leading `--`; the loader normalises.
- **`meta.id`** is the stable key used for the slots and persistence. Built-ins are
  `builtin:dark` / `builtin:light`.

## Built-ins and slots

The built-in dark and light palettes become **full `ThemeFile`s** in the registry
(authored in TS, not files) — they are just two more entries, marked undeletable:

```ts
// state/themes.ts
const BUILTIN_DARK: ThemeFile = { meta: { id: "builtin:dark", name: "Dark", base: "dark", ... }, ui: {...}, chart: DARK_CHART, colormap: {...}, flow: FLOW_DARK };
const BUILTIN_LIGHT: ThemeFile = { ... base: "light" ... };
```

The preference becomes a **mode + two slots**:

```ts
interface ThemePreference {
  mode: "auto" | "dark" | "light";  // was ThemePreference
  darkThemeId: string;              // default "builtin:dark"
  lightThemeId: string;             // default "builtin:light"
}
```

Resolution:

- `mode: "dark"` → apply `darkThemeId`.
- `mode: "light"` → apply `lightThemeId`.
- `mode: "auto"` → the OS colour scheme picks the slot (`prefers-color-scheme`), so the
  existing live-reload behaviour is preserved.

A theme can be assigned to either slot regardless of its `base` (the base only supplies
fallbacks); the picker may group suggestions by base for convenience.

## Application pipeline

`resolvedTheme()` (used by dockview, solid-flow, and the colormap fallback) becomes
"the **base** of the active theme". Applying a theme:

1. Set `document.documentElement.dataset.theme = active.base` — so `App.css` supplies
   the baseline palette, and the dockview / solid-flow themes get their baseline.
2. Write the theme's `ui` map as **inline custom properties** on the root
   (`style.setProperty`) — the overlay wins over the `[data-theme]` block. Clearing a
   stale overlay on switch is part of the same routine.
3. `chartTheme()` returns `merge(baseChart, active.chart)`.
4. `colormap.ts` reads `active.colormap` (or the base ramp).
5. `GraphEditor`'s `flowStyle()` merges `FLOW_STYLE_<base>` with `active.flow`.

Font scale (`--ui-scale`) is unaffected — it is independent of the palette.

> **One source of truth.** The full set of `--*` variables lives in `App.css`; a theme
> file carries only what it changes. This keeps existing themes valid when new variables
> are added, and avoids duplicating ~70 names in TypeScript. A theme that wants to be
> fully self-contained can simply list every variable in `ui`.

## Storage and files

Themes live in the app **config** directory, mirroring `recent.rs`:

```
<app config dir>/themes/<id>.heyltheme
```

Rust module `src-tauri/src/themes.rs` (list / read / write / delete) plus
`src-tauri/src/commands/themes.rs`, registered in `lib.rs`:

| Command | Purpose |
| --- | --- |
| `list_themes` | Built-ins + every installed theme's `meta` (for the picker). |
| `read_theme(id)` | The full `ThemeFile` to apply. |
| `write_theme(theme)` | Save/overwrite (used by Save and import). |
| `delete_theme(id)` | Remove an installed theme. |
| `theme_dir` | The themes directory (shown in the UI, so a user can drop files in). |
| `import_theme_file(path)` / `export_theme_file(id, path)` | Copy a `.heyltheme` in/out via native dialogs (`tauri-plugin-dialog`). |

The frontend owns the shape (as with the project's UI state); Rust only stores bytes.
Validation (kind, `formatVersion`, key types) happens in `themeFile.ts`, with an
inline error rather than a hard failure — a bad theme leaves the current one applied.

## UI

The Toolbar **View** popover becomes **Appearance**:

- **UI scale** — unchanged (`A−` / `A+`).
- **Mode** — `Auto` / `Dark` / `Light`.
- **Dark theme / Light theme** — two selectors (the slots), listing built-ins and
  installed themes; disabled/irrelevant slot dimmed when `mode` is forced.
- **Import theme file…**, **Export current theme…**, **Delete theme** (built-ins are
  not deletable), **Reveal themes folder**.

Persistence stays app-level (localStorage, like the font scale) — a theme is chrome,
**not** part of the project file. A loaded project does not change the theme.

## CLI / MCP surface

Themes are chrome, but agents benefit from reproducibility, so expose a small surface
over the same registry (see [`mcp.md`](mcp.md)):

- MCP: `list_themes`, `get_theme`, `set_theme` (`mode` + slots). Headless lists the
  **built-ins** and can read any installed theme file (it lives under the app config
  dir); headless cannot preview the rendered UI. `import_theme` / `export_theme` are
  file operations the app can also do headless.
- CLI: no theme flag in the first pass (batch output is data, not chrome); note it as a
  possible later addition.

## Files

| Path | Role |
| --- | --- |
| `src/lib/themeFile.ts` | The `ThemeFile` type + parse/validate/normalise. |
| `src/state/themes.ts` | The registry (built-ins + installed), apply pipeline, slot resolution. |
| `src/state/settings.ts` | Keeps `--ui-scale`; the theme signals move to `themes.ts`. |
| `src/App.css` | The baseline palette (unchanged; becomes the fallback a theme overlays). |
| `src/components/analyzer/colormap.ts` | Reads the active theme's ramp (fallback: base). |
| `src/components/Workbench.tsx`, `src/components/GraphEditor.tsx` | Baseline theme by `base`. |
| `src/components/Toolbar.tsx` | The **Appearance** popover. |
| `src-tauri/src/themes.rs`, `src-tauri/src/commands/themes.rs` | Storage + commands. |

## Testing

- **`themeFile.ts` unit tests** — parse/validate (bad kind/version, unknown keys kept,
  overlay normalisation `--` prefix).
- **Apply pipeline** — a theme's `ui` overlay lands on `:root` and survives a mode
  change; clearing restores the base; `chartTheme()`/colormap merge correctly.
- **E2E (wdio)** — install a fixture theme, select it, assert a CSS variable changed on
  the root and the toolbar reflects the selection; export it and re-import it.

See [`roadmap.md`](roadmap.md) → **M11** and [`decisions.md`](decisions.md) → **ADR-15**.
