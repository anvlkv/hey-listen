# Audio import and export (M43)

> **Status: delivered.** Source configuration lives in the Sidebar, and the analysis
> window is exportable as audio.

## The sources rail

The Source panel stops being a bottom fixed region. The activity bar gains a
**bottom-pinned group** holding the Sources and Export activity tabs — not Workbench
tabs — and the Sidebar renders whichever one is active:

- **Sources** (`activity.tab.sources`, `file-import`) — second from the bottom.
- **Export** (`activity.tab.export`, `file-export`) — first from the bottom (closest to
  the window edge).

`ActivityTab` (`src/state/activityBar.ts`) becomes
`AnalyzerSection | "graph" | "sources" | "export"`, with type guards
(`isAnalyzerTab`, `isGraphTab`, …) as the one place the union is narrowed. `selectTab`
keeps its collapse behaviour; a new `showTab` selects **without** collapsing, for the
Timeline's **Replace** button. The activity tab defaults to Sources, so a fresh window
opens the rail there.

The bottom row is always the Timeline and keeps its splitter and height. With no source
the Timeline stays mounted and shows its existing empty-state overlay; the Sources rail
is simply the first activity tab, no longer a replacement for the Timeline.
`sourcePanelPinned` (`src/state/settings.ts`), `showSource`/`showTimeline`,
`BOTTOM_EMPTY`, the compact “Add audio” strip and the `app-bottom-solo` styles go away.
While recording, Sources is opened and cannot collapse — its Stop lives there.

Copy follows the new home: the Timeline overlay (“Open a file or record a source to
begin” → point at Sources), its source-failure line (“see the Source panel” → “see
Sources”) and the Workbench watermark's “Source panel below”.

The `AGENTS.md` fixed-region rule changes with this milestone: Timeline, Sidebar,
Workbench and Annotations stay fixed; **Source is now a Sidebar view** selected from the
Activity bar, not a separate region.

### What moves

Everything that describes or produces the source now lives in Sources:

- the kind picker, file open, storage cards (`StorageCards`) and the source summary —
  the current `SourcePanel` content;
- the live inputs, gain, meter, timing, record/pause/stop controls;
- the synth **Length**, **Render**, **Live** and the render error, from `SynthGraphTab`.
  The synth Workbench tab keeps the graph, DOT and clear controls. Sources and the synth
  editor can be visible together (rail + Workbench), so the graph is edited in the
  Workbench and rendered from the rail. The popout hint about Render/Live goes away;
- the capture monitor effect and the `stopMonitor` cleanup, from the panel component into
  `state/capture/session.ts`. Selecting a live kind opens the monitor **once**, at the
  store level, so switching activity tabs no longer closes the input session.

The kind picker stays the single owner of the choice (`state/capture` + `SourceKind`).
The rail is simply **Sources** — it shows the controls for the chosen kind; no new
Import/Input sections are introduced.

## Audio export

The Export rail exports the **current analysis window** of the project source. It never
changes the source, the filter switch, or the analysis window.

- **Range** — a read-only `windowStart`–`windowEnd` readout with the duration.
- **Format** — every `AudioExportFormat` variant. The first cut is the lossless set the
  oxiaudio pipeline helpers write; adding a variant is one enum edit plus its encoder
  branch and its dialog filter.
- **Depth** — only the depths `AudioExportDepth` permits for that format. Changing
  format snaps the depth to a supported value; the choice is remembered per format.
- **Channels** — an `AudioExportChannels` mode (`all` / `mono` / `single`) and, for
  `single`, a picker. Without a filter, `all` keeps the source channels and `single`
  picks a source channel; with a filter, they address the graph's **outputs** (the same
  lanes the Timeline draws, labelled by `state/analysis.ts` → `channelOptions`). `mono`
  uses the existing `pcm::mixdown`.
- **Filter** — an **Apply the filter graph** switch, independent of the app's filter
  switch. It defaults to `filterActive()` and is disabled when no filter is composed. It
  sends the **composed** spec, so a pending debounce is not lost. Off exports the raw
  window.

A format's channel count must be one `oxiaudio::ChannelLayout` can name explicitly
(mono, stereo, quad, 5.1, 7.1). Any other count requires `mono` or `single`; never rely
on `ChannelLayout::from(u16)`, which silently reports stereo for other counts.

Integer depths clamp to full scale; the result reports the peak and whether clipping
occurred, and the rail surfaces it. Float WAV is exact. Output stays at the source
sample rate — no resampling in this milestone.

### Where it runs

`src-tauri/src/audio/export.rs` owns slicing, filtering, channel shaping and encoding,
with no `tauri` types, so it is unit-testable. `src-tauri/src/commands/audio_export.rs`
is the IPC adapter (`spawn_blocking`), and `pick_audio_export_path(format, default_name)`
is the format-filtered native dialog. The frontend lives in
`src/components/export/AudioExportPanel.tsx` and `src/state/exportAudio.ts`.

> **Encode, not decode.** `symphonia` 0.6 is decode-only. Encoding uses `oxiaudio`,
> already a dependency: `encode_wav_with_config`, `encode_flac_with_config` and
> `AiffStreamEncoder`. `symphonia` continues to decode the source. No new dependency.

New wire types (ts-rs bindings, string-serde round-trip tested):
`AudioExportArgs`, `ExportedAudio`, `AudioExportFormat`, `AudioExportDepth`,
`AudioExportChannels`. The command is registered in `src-tauri/src/lib.rs`.

The panel defaults to the last format/depth (`localStorage`, app chrome), float WAV,
all channels, and the filter as the app has it. With no source, or an empty window, the
controls are disabled with the reason.

## Tests

- **Rust** (`audio::export`): window slicing and edge clamping; source-rate output;
  `all` / `mono` / `single` on a stereo fixture with distinct sides; filter off vs a
  gain graph; each format and each allowed depth; unsupported channel counts rejected;
  integer clipping reported; empty window and no source rejected. Decode the written
  file back with `oxiaudio::decode_file` to assert rate, channels, frames and samples.
- **Frontend/E2E**: the Export tab is reachable from the pinned activity group; the
  Sources tab exposes the picker, storage cards, summary and synth controls; with no
  source the Timeline is still mounted with its empty-state overlay and the Sources tab is
  active; the Timeline Replace button reveals Sources without collapsing it; a render
  started from Sources lands on the Timeline; switching activity tabs keeps a capture
  session monitoring; an export invocation carries the expected
  format/depth/channels/filter arguments; with no source the export controls are disabled.
- **Manual**: update `docs/manual/001_shell.md`, `002_sources.md`, `004_graphs.md` and
  `009_projects.md`, and re-capture the affected screenshots (`npm run capture:manual`).

## Delivery order

1. Activity-bar union, pinned Sources/Export tabs, Sidebar dispatch, always-on Timeline
   with its empty state and `showTab`; update e2e helpers/selectors and the shell docs.
2. Sources rail: move the panel, synth controls, monitor lifecycle; update tests.
3. `audio::export` + command + bindings + Rust tests.
4. Export rail + state + E2E.
5. Docs, screenshots, maid.

## Out of scope

- Whole-source export, resampling, dither, lossy formats.
- MCP/CLI parity. An `export_audio` tool and CLI subcommand can reuse `audio::export`;
  decide whether that ships in M43 or a follow-up.

## Confirmed decisions

1. **Pinned order** — Sources above Export; Export is closest to the window edge.
2. **One Sources rail** — the Import/Input wording was conversational only; the rail's
   name and identity stay **Sources**.
3. **Render/Live placement** — Length, Render and Live move into Sources; the synth tab
   is a pure graph editor.
4. **No-source layout** — the Timeline stays visible with a placeholder, and Sources is
   the first activity tab open, instead of replacing the Timeline.
