# Theming (exchangeable theme files)

Themes are **data** (M11): a `ThemeFile` that a user can install, export and share,
applied on top of a built-in **base**. Before M11 the app shipped a fixed **auto /
dark / light** theme; that palette is what a theme now overlays, and it is authored in
**four places** and selected with a single `data-theme` attribute:

- `src/App.css` — ~70 `--*` custom properties in `:root[data-theme="dark"]` /
  `:root[data-theme="light"]` (the whole UI chrome).
- `src/state/themes.ts` — the `ChartTheme` record (`DARK_CHART` / `LIGHT_CHART`) and
  the heatmap ramps, read by every uPlot / canvas chart via `chartTheme()` and
  `colormap.ts`.
- `src/App.css` — the level-meter colours (`--meter-*`, M11.A) join the ~70 `--*`
  custom properties above.
- `src/components/Workbench.tsx` (dockview `themeDark` / `themeLight`) and the
  `solid-flow` (`--xy-*`) styles in `src/state/themes.ts` (`BASE_FLOW`).

This document makes the theme **data**: a `ThemeFile` that a user can install, export,
and share, applied on top of a built-in base.

## Goal

- Themes are **loadable files**, not just a dark/light switch.
- The built-in dark and light remain the **defaults** (a theme file is a **partial
  overlay** on one of them), and the registry **bundles** a few full themes of its own
  — **Retrowave Neon** (the shipped default), Nord, Solarized Dark / Light — authored
  in TS, undeletable. A theme can tweak a handful of colours without restating the
  whole palette, and unknown/new variables degrade gracefully.
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
  // Optional partial ChartTheme (fields from `ChartTheme` in lib/themeFile.ts).
  "chart": {
    "series": "#268bd2",
    "seriesMin": "#859900",
    "seriesMax": "#b58900",
    "waveFill": "rgba(38, 139, 210, 0.22)",
    "reference": "rgba(181, 137, 0, 0.8)",  // chart reference line (targets / floors)
    "overlayCentroid": "#2aa198",           // spectrogram centroid contour
    "overlayRolloff": "#cb4b16"             // spectrogram rolloff contour
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
- **`chart`** is a partial `ChartTheme`. Beyond the fields shown, `reference` draws a
  chart reference line (e.g. the −14 LUFS target, 0 dBFS), and `overlayCentroid` /
  `overlayRolloff` colour the spectrogram contour overlays (M11.A).
- **Meter colours** (the `levels` tool) are the `ui` variables `--meter-low` /
  `--meter-mid` / `--meter-high` / `--meter-peak` / `--meter-unlit`.
- **`meta.id`** is the stable key used for the slots and persistence. Built-ins are
  `builtin:dark` / `builtin:light`.

## Built-ins and slots

The built-in dark and light palettes become **full `ThemeFile`s** in the registry
(authored in TS, not files) — they are just two more entries, marked undeletable —
and the registry **bundles** several more palettes the same way:

```ts
// state/themes.ts
const BUILTIN_THEMES: ThemeFile[] = [
  { meta: { id: "builtin:dark", name: "Dark", base: "dark" }, chart: DARK_CHART },
  { meta: { id: "builtin:light", name: "Light", base: "light" }, chart: LIGHT_CHART },
  { meta: { id: "builtin:retrowave-neon", name: "Retrowave Neon", base: "dark" }, ui: {...}, chart: {...}, colormap: {...}, flow: {...} },
  { meta: { id: "builtin:nord", name: "Nord", base: "dark" }, ... },
  { meta: { id: "builtin:solarized-dark", name: "Solarized Dark", base: "dark" }, ... },
  { meta: { id: "builtin:solarized-light", name: "Solarized Light", base: "light" }, ... },
];
```

The **shipped default preference** is `mode: "dark"` with **Retrowave Neon** in the
dark slot, so a fresh install wears the retrowave palette; the light slot keeps
`builtin:light` for `auto` / `light`. Bundled ids are `builtin:`-prefixed and
undeletable. (The bundled ids/names/bases are mirrored in
`src-tauri/src/themes.rs` → `BUILTIN_THEMES`, for the **headless** MCP surface, which
has no webview to run the TS registry.)

The preference becomes a **mode + two slots**:

```ts
interface ThemePreference {
  mode: "auto" | "dark" | "light";
  darkThemeId: string;              // default "builtin:retrowave-neon"
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

Rust module `src-tauri/src/themes.rs` (list / write / delete / import / export) plus
`src-tauri/src/commands/themes.rs`, registered in `lib.rs`:

| Command | Purpose |
| --- | --- |
| `list_themes` | Every installed theme as `{ id, content }` (raw JSON; the frontend parses it). |
| `write_theme(id, content)` | Save/overwrite an installed theme (used by Save and import). |
| `delete_theme(id)` | Remove an installed theme (bundled ids are refused). |
| `theme_dir` | The themes directory (shown in the UI, so a user can drop files in). |
| `import_theme_file(path)` / `export_theme_file(path, content)` | Read/write a `.heyltheme` file at an explicit path. |
| `pick_theme_import_path` / `pick_theme_export_path` | Native dialogs (`tauri-plugin-dialog`) returning a path. |
| `reveal_theme_dir` | Open the themes directory in the OS file manager. |

The frontend owns the shape (as with the project's UI state); Rust only stores bytes
(and reports the **bundled** themes' identity for the headless MCP surface).
Validation (kind, `formatVersion`, key types) happens in `themeFile.ts`, with an
inline error rather than a hard failure — a bad theme leaves the current one applied
(an unreadable installed file is skipped with a warning).

## UI

The Toolbar **View** popover is now **Appearance** (an icon-only `circle-half-stroke`
trigger with a tooltip):

- **UI scale** — `minus` / `plus` icon buttons (tooltips).
- **Mode** — `Auto` / `Dark` / `Light` icon buttons (`circle-half-stroke` / `moon` /
  `sun`; each keeps an `aria-label`, e.g. `"Dark mode"`).
- **Dark theme / Light theme** — two selectors (the slots), listing built-ins and
  installed themes; the irrelevant slot is dimmed when `mode` is forced.
- **Import / Export / Delete / Reveal folder** — icon buttons (each with a tooltip);
  Delete is disabled for a built-in theme.

Persistence stays app-level (localStorage, like the font scale) — a theme is chrome,
**not** part of the project file. A loaded project does not change the theme.

## CLI / MCP surface

Themes are chrome, but agents benefit from reproducibility, so expose a small surface
over the same registry (see [`mcp.md`](mcp.md)):

- MCP: `list_themes` (bundled + installed summaries, plus the active mode/slots),
  `get_theme` (one theme, or the active one), `set_theme` (`mode` + slots),
  `import_theme` / `export_theme` (file paths). With the app running the handlers run
  in the webview against the same registry the UI drives. **Headless** reports the
  bundled themes only (`list_themes` / `get_theme`), since it has no webview and
  cannot resolve the app config dir; `set_theme` / `import_theme` / `export_theme`
  return "requires the app".
- CLI: no theme flag in the first pass (batch output is data, not chrome); note it as a
  possible later addition.

## Files

| Path | Role |
| --- | --- |
| `src/lib/themeFile.ts` | The `ThemeFile` type + parse/validate/normalise. |
| `scripts/themeFile.test.ts` | Unit checks for the model (`npm run test:unit`). |
| `src/state/themes.ts` | The registry (built-ins + installed), apply pipeline, slot resolution, and the base palettes. |
| `src/state/settings.ts` | Keeps `--ui-scale`; the theme signals live in `themes.ts`. |
| `src/App.css` | The baseline palette (unchanged; becomes the fallback a theme overlays). |
| `src/components/analyzer/colormap.ts` | Reads the active theme's ramp (fallback: base). |
| `src/components/Workbench.tsx`, `src/components/GraphEditor.tsx` | Baseline theme by `base`. |
| `src/components/Toolbar.tsx` | The **Appearance** popover. |
| `src-tauri/src/themes.rs`, `src-tauri/src/commands/themes.rs` | Storage + commands. |

## Testing

- **`themeFile.ts` unit checks** — parse/validate (bad kind/version/base, unknown keys
  kept, overlay normalisation `--` prefix): `npm run test:unit`
  (`scripts/themeFile.test.ts`).
- **`themes.rs` unit tests** — id validation (no path traversal) and bundled-id
  uniqueness: `cargo test` in `src-tauri/`.
- **E2E (wdio)** — `e2e/specs/m-themes.spec.ts`: reset to the default, assert the
  retrowave palette is applied, switch the mode and the dark slot (asserting the root
  CSS variables + `data-theme`), and assert the preference persists to `localStorage`.
  The apply pipeline itself (base + inline `ui` overlay) is exercised by those
  assertions.

See [`roadmap.md`](roadmap.md) → **M11** and [`decisions.md`](decisions.md) → **ADR-15**.
