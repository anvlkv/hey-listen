# MCP + CLI analysis ergonomics

Design for **M21**, a cross-cutting milestone over the analysis tools. It makes every
analyzer call through MCP and the batch CLI **compact by default, semantically
summarized, and discoverable**, and it annotates the MCP tool catalog so an agent can
choose and call tools without guessing.

**Status: delivered (M21).** M16 delivered the option metadata / canonical-key half;
M21 delivered the shared summary, compact, discovery, and annotation contract over the
M17–M20 results. Every new analyzer adds its summary arm to
`audio/analysis/summary/families.rs` when it lands.

## Goal

Every analyzer call returns:

- a **compact result** by default (bounded arrays, no accidental `{ length }` dead ends);
- a canonical **summary** (`text` plus labelled, unit-bearing items) that says what the
  result means without reading raw arrays;
- **discoverable options** and tool metadata (`list_analyzers`, a new `get_analyzer`);
- **annotated MCP tools** (`title`, `annotations`, clear descriptions);
- the same shape from the GUI MCP bridge, the headless server, and the CLI.

## Gaps this milestone closed

- `run_analysis` / CLI return a **generic** compaction: long numeric arrays become
  `{ length, min, max, argmin, argmax }`, long gapped arrays add `nulls`, and any other
  long array becomes `{ length }`. A matrix, spectrogram, onset list, or note list loses
  its dimensions, peak location, or event context.
- The result envelope (`window`, `params`, `options`, `result`) has **no summary**. An
  agent must infer the answer from array statistics.
- `list_analyzers` is id/title/description/section/keywords. M16 adds a compact option
  map (keys + defaults), but there is no single-analyzer detail call and no
  `about`/when-to-use copy in the headless catalog.
- The static MCP tool catalog has `name`, `description`, and `inputSchema` only — no
  `title` or `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`).
- The CLI `analyzers` command lists ids but cannot show one analyzer's options; `-o`
  keys are only in the docs. There is no summary-only output mode.
- Compaction is duplicated in Rust (`mcp/dispatch/shape.rs`) and TypeScript
  (`state/mcp/shaping.ts`), kept in step by convention. M21 removes the duplicate by
  making Rust the single shaper.

## The compact contract

### Three output modes

| Mode | MCP | CLI | Contains |
| --- | --- | --- | --- |
| **summary** | `run_analysis` with `summaryOnly: true` | `--summary` | `summary` only, no `result` |
| **compact** | default `run_analysis` (`includeData` false) | default | `summary` + bounded/statistical `result` |
| **full** | `includeData: true` | `--full` | `summary` + raw result arrays |

`summary` is always computed from the **full** result before compaction, so it is
identical in all three modes. `summaryOnly` is mutually exclusive with `includeData`;
`--summary` and `--full` are likewise mutually exclusive. `--pretty` still requires a
single file/tool result.

The GUI `run_analysis` command takes `shape: full | compact | summary` and `maxPoints`
(the analyzer tabs request `full`; the MCP handler forwards the caller's mode). The
headless server and CLI call the same Rust shaper, so there is one implementation.

### `ResultSummary`

Computed in Rust, serialized into the MCP/CLI envelope and returned by the GUI
`run_analysis` command beside the result:

```rust
struct SummaryItem {
    key: String,          // stable key, e.g. "peakHz"
    label: String,        // human label, e.g. "peak frequency"
    value: f64,
    unit: Option<String>, // "Hz", "dBFS", "s", "%", ...
}

struct ResultSummary {
    tool: String,
    label: String,        // e.g. "Spectrum"
    text: String,         // one compact human-readable line
    items: Vec<SummaryItem>,
}
```

Example:

```json
{
  "tool": "spectrum",
  "label": "Spectrum",
  "text": "peak 440.0 Hz · -6.0 dBFS · 43 frames",
  "items": [
    { "key": "peakHz", "label": "peak frequency", "value": 440.0, "unit": "Hz" },
    { "key": "peakDb", "label": "peak level", "value": -6.0, "unit": "dBFS" },
    { "key": "frames", "label": "frames", "value": 43, "unit": null }
  ]
}
```

The envelope becomes:

```json
{
  "window": { "start": 0.0, "end": 2.5 },
  "params": { "...": 0 },
  "options": { "...": 0 },
  "summary": { "tool": "spectrum", "text": "...", "items": [] },
  "result": { "tool": "spectrum", "...": 0 }
}
```

The GUI analyzer tabs keep using `result`; the summary is available to the MCP handler,
the CLI, exports (M12), and future readouts without another analysis pass.

`params` and `options` are the **effective** settings the call ran with: the tool's
shared params and its declared defaults, overlaid with whatever the call set. Unset
option fields are omitted rather than emitted as `null`, so a one-tool record stays
small and identical across the GUI, headless MCP, and the CLI.

### Summary content by result family

| Result | Summary items (representative) |
| --- | --- |
| Waveform / Levels | peak dBFS, RMS dBFS, duration |
| Spectrum | peak frequency, peak level, FFT size, hop, frames |
| Spectrogram | frames, bins, duration, peak time, peak frequency, peak level |
| Matrix (mel/MFCC/chroma/contrast) | frames, bands, peak frame, peak band, peak value |
| Series (spectral/pitch/loudness) | frames, min/max with their times, unit label; pitch adds voiced fraction and effective f0 range |
| Pitch | median/mean f0, voiced fraction, effective min/max f0 |
| Rhythm (tempo/onsets/downbeats) | BPM/confidence, onset/beat/downbeat counts, first/last event, strongest onset |
| Loudness integrated / range | LUFS / LU |
| Frame RMS | min/max/mean dBFS, frame and hop |
| Note metrics | note count, gap count, total/longest gap, median note, loudest note |
| Modulation | top AM rate/depth, top FM rate/depth, FM run span, voiced fraction |

The `text` line is the human-facing form; the `items` are the machine-readable form. Every
numeric item carries a unit so an agent never has to infer dBFS vs LUFS vs Hz. The Rust
summary module owns the per-tool unit mapping and must stay in step with the frontend
registry's `formatY` units; a catalog test pins the common cases (Hz, dBFS, LUFS, %, s).

### Compact shape by result family

The existing generic stats remain as a size guard, but they are no longer the whole
answer. The compact result keeps the result's **structure**:

| Result | Compact shape |
| --- | --- |
| Scalar / readouts | unchanged |
| Waveform | peak/RMS/duration; `min`/`max` arrays → stats |
| Spectrum | peak + dimensions; `freqs`/`magDb`/`minDb`/`maxDb` → stats with peak bins |
| Spectrogram | dimensions + peak time/freq; `magDb` → stats; `freqs` → range |
| Matrix | dimensions + peak frame/band/value/time; `values` → stats |
| Series / pitch | frames + min/max/argmin/argmax; gapped values keep `nulls`; pitch keeps voiced fraction/range |
| Rhythm | BPM/confidence + event counts; event arrays → `{ length, preview: [first N], truncated }` |
| Note metrics | counts/summary + `notes`/`gaps` as `{ length, preview: [first N], truncated }` |
| Modulation | top peaks preserved; spectra → stats; FM run span |
| `includeData: true` | raw arrays (unchanged) |

Object/event arrays get a **bounded preview** (five records) instead of `{ length }`;
`includeData: true` returns every record. Numeric arrays continue to use the stats shape,
and `maxPoints` still decimates them when raw data is requested.

> The canonical semantic layer is the Rust `ResultSummary`, and the compact shape is
> built by the same Rust shaper. The GUI MCP handler forwards the requested mode instead
> of compacting in TypeScript; the TS `compact`/`decimate` module is retired (M21).
> Do not let the summary or compact logic be duplicated in TS.

## MCP catalog annotations

### Tool annotations

Add a `title` and `annotations` to every catalog entry. The `tool()` helper gains a
`ToolClass` with sensible defaults, so the values are consistent rather than copied:

| Class | Examples | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
| --- | --- | --- | --- | --- | --- |
| Observe | `get_state`, `list_analyzers`, `get_analyzer`, `list_notes`, `get_note`, `list_projects`, `list_themes`, `get_theme`, `get_graph` | true | false | true | false |
| Analysis compute | `run_analysis` | false | false | true | false |
| Analysis settings | `set_analysis_window`, `set_view`, `set_shared_params`, `set_tool_options`, `open_tool`, `close_tool`, `set_filter_graph`, `set_synth_graph`, `set_output_gain`, `set_focused_note` | false | false | true | false |
| Preview | `preview` / `stop_preview` | false | false | `preview` false, `stop_preview` true | false |
| Source / project replace | `open_audio_file`, `render_synth`, `open_project`, `new_project`, `close_source` | false | true | false | true |
| Project save | `save_project` | false | false | true | true |
| Note mutation | `create_note`, `update_note`, `delete_note` | false | `delete_note` only | update/delete true | false |
| Capture | `start_capture` / `stop_capture` | false | false | `start_capture` false, `stop_capture` true | true |
| Theme / template I/O | `import_theme`, `export_theme`, `import_template`, `export_template` | false | import may overwrite | true | true |

These are **hints**, not enforcement. The source/project prompts remain in the UI, and
`run_analysis` still writes params/options unless `transient: true`. `title` and
`annotations` are additive fields; a client on an older negotiated protocol version
ignores them. `outputSchema` is deferred partly because it is newer and the result is a
tagged union.

### Descriptions and metadata

- `run_analysis`: M16 corrected the option-key copy (canonical camelCase, snake_case
  aliases, unknown keys fail) and pointed it at `list_analyzers`; M21 adds the
  summary/compact/full modes (`summaryOnly`, default compact, `includeData`).
- `set_tool_options`: M16 made the description canonical (camelCase + aliases, unknown
  keys fail) and pointed it at `list_analyzers`; M21 points it at `get_analyzer`.
- `list_analyzers`: **done in M16** — the compact list now carries each tool's option
  keys and defaults.
- **New `get_analyzer { id }`**: one analyzer's `id`, `title`, `description`, `about`,
  `section`, `keywords`, `options` (key/label/default/min/max/step/unit/help), and the
  summary item keys it produces. The GUI uses the frontend registry's full `about` copy;
  headless uses the Rust catalog, so its `about` is the short description until the copy
  is shared.
- `get_state`: include the full per-tool option defaults in both GUI and headless modes
  (the GUI already does; headless currently reports only tools whose options were set).
- `outputSchema` is **deferred**: the analysis result is a tagged union and the server
  echoes the client's protocol version, so a full output schema would be high-maintenance
  and version-sensitive. The `summary` contract plus input-schema descriptions carry the
  ergonomics for now.

## CLI ergonomics

### `analyzers [ID] [--json]`

- No `ID`: the current list (id / section / title).
- `ID`: one analyzer's description, about, options with defaults/ranges/help, and the
  summary keys. This is the discovery path for `-o` keys.
- `--json`: machine-readable (array without `ID`, one object with it).
- The `tauri.conf.json` `analyzers` entry gains an optional positional `id`; the batch
  logic reuses the same metadata source as `get_analyzer`.

### `analyze` output modes

- **Default:** compact `result` + `summary`.
- **`--summary`:** emit `{ file, window, params, options, summary }` and omit `result`.
  This is the pipeline-friendly mode for sweeping many files.
- **`--full`:** raw arrays + `summary` (as today, plus the summary).
- `--summary` and `--full` together are a usage error (exit `2`).
- `--pretty` remains single-result only.
- `synth` inherits the same flags.

Help text points at `analyzers <ID>` for option keys and documents the three modes.

## Non-analysis tool outputs

The compactness contract is primarily about analyzer results, but M21 also audits the
list-style tools so "all tools" is not just an analyzer claim:

- `list_analyzers` stays the compact catalog (option keys + defaults); `get_analyzer`
  is the detail call (full labels/ranges/help and the about copy).
- `list_notes` returns a **compact note summary** by default (id, time, optional range,
  tool, title, values text, and a body excerpt); `get_note` (or `full: true`) returns the
  full markdown body and frozen snapshot. This mirrors the CLI's `notes --full`.
- `get_state` keeps its bounded project/analysis summary; option defaults are small
  numbers, not free-form data.
- `get_graph`, `get_theme`, and `get_note` remain explicit full-object reads; they are
  the "detail" calls for their list counterparts.

## Consistency and tests

- **Rust summary:** unit tests for every `AnalysisResult` variant, including empty /
  silent / no-voiced-frame cases; the `text` line is stable and unit-annotated.
- **Rust shaping fixtures:** one fixture per result family, asserted by the single Rust
  shaper; event previews, matrix dimensions, and peak locations are pinned. The GUI
  handler is tested to forward `shape` / `maxPoints` unchanged.
- **Catalog tests:** every MCP tool has a `title` and `annotations`; every analyzer id has
  option metadata; `get_analyzer` and `list_analyzers` agree; headless `get_state` reports
  defaults.
- **CLI tests:** `analyzers <ID>` (human and JSON), `--summary`, default compact,
  `--full`, and the `--summary`/`--full` conflict.
- **End-to-end:** an agent-style sequence (`get_state` → `get_analyzer` → `run_analysis`
  → read `summary`) and a CLI sweep (`--summary | jq`).
- **Validation:** `cargo test`, `npm run typecheck`, `npm run build`, `npm run maid`.
  Regenerate `src/bindings/**` with `cargo test`.

## Decisions / deferred

- **Summary and compact shape are canonical in Rust.** Do not duplicate them in
  TypeScript. The GUI command returns `{ result, summary }`; the analyzer tabs unwrap
  `result`, and the MCP handler forwards the requested `shape`.
- **One shaper.** The headless server, CLI, and GUI MCP path all use the same Rust
  `shape_result_with` function (`shape_result` is its `Axis::Array` spelling). Retire
  the TS `compact`/`decimate` module once no non-MCP caller needs it.
- **Annotations are hints.** Do not use them to replace the app's prompts or the
  `transient` semantics.
- **Deferred:** per-tool `outputSchema`, a general structured-event contract, a
  configurable preview length, "did you mean?" suggestions for unknown tools/options, and
  summary-aware note snapshots.

## M21.A — agent hardening

M21 made results compact and discoverable. A real agent session then exposed the
places where the contract still lied or ran out of road. M21.A is the follow-up; it
does not change any analyzer's DSP.

### The result contract fixes

| Symptom | Fix |
| --- | --- |
| `analyze` stdout mixed the `[WDIO]`/`hey-listen … starting` preamble with the JSONL | The log plugin targets **stderr**; the WebDriver plugins register only for a GUI launch (`cli::is_cli_invocation`) |
| `maxPoints` strided *every* array, flattening matrices and dropping notes/onsets | Decimation is family-aware: series and `times` move together; a matrix is thinned by whole frames (`sourceFrames`, spectrogram `hopSize` scaled); event/note lists are untouched |
| The compact `noteMetrics` preview showed only five notes | `bounds` keeps every `{ startSecs, endSecs, gapAfterSecs }`; the heavy records stay previewed |
| An `argmax` index could not be turned into a time without the array | Compact axes carry `hop` (and `end`); `run_analysis` gains `axis: "compact"`, which spells a uniform `times` as `{ start, hop, length, end }` |
| Parallel tool calls raced on the project stores | The bridge runs MCP calls through a per-window promise queue |

`list_analyzers` entries now carry `family` (`series`, `matrix`, `spectrum`,
`spectrogram`, `events`, `notes`, `scalar`), and `get_analyzer` adds `decimatable`.
That is the machine-readable form of "is `maxPoints` safe here?".

### Segmentation guidance (the one that mattered)

The session's first pipeline used `loudnessMomentary` (400 ms R128 block) and hand-read
875-value `spectralFlux` arrays to find call boundaries, and misread `onsets`'
frame-grid `times` as its detected events. The catalog now says the distinction out
loud, in the one-line description and in `about`:

- `onsets` — **ungated** spectral-flux peaks; noise can produce them.
- `noteMetrics` — gated spans with hysteresis, min note/gap, level, f0, voice quality.
- `frameRms` — the fine linear envelope (10 ms frame / 5 ms hop) to threshold.
- `loudnessMomentary` — programme loudness, not boundary detection.

The canonical agent sequence lives in `initialize.instructions` and the
`audio-analysis` skill:

```text
get_state → get_analyzer → summaryOnly run
          → frameRms + noteMetrics (events)
          → per-segment/per-note analyzers
```

For a sweep: `display: false` + `transient: true`. `includeData` only when arrays are
actually needed; `maxPoints` for series/matrices; `axis: "compact"` to cut the time
arrays.

### Projects without a window

`save_project` / `open_project` / `new_project` now run in the headless session. They
build `META`/`SETUP` from the session's source, shared params, per-tool options,
window/view, and filter, and write the caller-supplied `notes`. `LAYOUT` is empty
(there is no Workbench to restore). This is what makes a 1k-recording annotation run
scriptable without keeping a GUI window alive.

`save_project { embedSource: false }` writes a **reference** project for a file
source: the `SOURCE` descriptor keeps the path and no `DATA` is written. Both loaders
(GUI `load_project` and headless `open_project`) decode the path again. It only applies
to file sources; synths and captures keep their audio.

### Observability and documentation

- `get_state` reports `server: { mode: "bridge" | "headless", version }`. A stale app
  now announces itself instead of silently serving an old catalog.
- `initialize.instructions` carries the sequence above and the batch-CLI pointer.
- `docs/mcp.md` documents the exact token handshake (`connect → token + newline →
  initialize → notifications/initialized`), a minimal Python client, and the
  `structuredContent` / `content[0].text` fallback.
- `docs/cli.md` states that logs are on stderr and stdout is JSONL-only.
- The `audio-analysis` skill carries the workflow, the pitch-range warning (defaults are
  60–1200 Hz; birds need e.g. 50–4000 Hz), and the project-write recipe.

### Tests

- Shaping: matrix thinning keeps `values.len() == frames * bins`, series `times` and
  `values` stay aligned, event lists survive, `noteMetrics.bounds`, axis `hop`, and
  `axis: "compact"`.
- Headless: `save_project` writes `SOURCE`/`SETUP`/`NOTES`, a fresh session's
  `open_project` restores them, `new_project` clears the session.
- Catalog: every analyzer has a family; the segmentation tools have `about` copy.
- CLI stdout purity is checked by hand: the batch unit tests inject `out`, so they cannot
  see the process stream.

> **Follow-up:** M21.B (planned) covers **measurement reliability** — window-level
> gating for series metrics, the `harmonicRatio`/HNR distinction, pitch and modulation
> reliability flags, syllable grouping, and multi-window CLI input. See
> [`roadmap.md`](roadmap.md) → M21.B.
