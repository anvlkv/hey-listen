# Project file format (binary)

Single-file, versioned container. Embedded raw audio (no external refs), with
streaming for very large audio.

## Goals

- Embed raw audio data by default (no external file references), with an explicit
  opt-in **reference** mode for large annotation sets (M21.A).
- Good performance for large audio (chunked, streamable, append-friendly).
- Compact structured data (postcard); JSON only where it's already JSON (layout).

## Byte layout

```
+0      magic                4 bytes   "HEYL"
+4      version              4 bytes   u32 LE, currently 1
+8      flags                4 bytes   u32 LE (endianness/features)
+12     section_count        4 bytes   u32 LE
+16     section_index        N * 24    offset (u64) + length (u64) + id (u8) + reserved
...     sections             ...
+end    checksum             8 bytes   xxHash/CRC of everything before it
```

## Sections

| id | name | codec | content |
| --- | --- | --- | --- |
| 0x01 | `META` | postcard | name, timestamps, app version, format version |
| 0x02 | `SOURCE` | postcard | `Source` descriptor (file path / input config / synth graph) |
| 0x03 | `DATA` | raw PCM blob | interleaved `f32` (or `i16`) samples, chunked |
| 0x04 | `SETUP` | postcard | `AnalysisSetup` (tools, configs, shared params) |
| 0x05 | `LAYOUT` | serde_json | dockview JSON + solid-flow node positions |
| 0x06 | `RESULTS` | postcard | cached `AnalysisResult` list |
| 0x07 | `NOTES` | postcard | the project's annotations (`Note` list: anchor time + optional range, tool, markdown body, frozen values) |

## Notes (M14)

The `NOTES` section (id `0x07`) carries the project's **annotations** as a `postcard`
`Vec<Note>` — the same `Note` / `NoteValues` types the frontend and the MCP surface use
(see [`notes.md`](notes.md)). (The section and type keep the historical `notes` name;
the UI labels the feature **Annotations** to distinguish it from M18's detected note
segments.) It is written from the frontend's notes store through
`save_project` and returned by `load_project`, exactly like `SETUP`. Because the header
version governs the section set and readers skip unknown ids, a `NOTES` section is
**forward-compatible**: an older build opens the project and simply ignores it, and a
file with no `NOTES` section loads with zero notes. Keeping notes in their own section
(rather than inside `SETUP`) keeps the analysis setup a pure `AnalysisSetup` and lets the
CLI read just the notes (`hey-listen notes <FILE.heyl>`).

## Reference projects (M21.A)

`DATA` is optional. `save_project { embedSource: false }` (or the headless tool's
`embedSource`) writes the `SOURCE` descriptor — including the original `path` for a
file source — and **no samples**. Both loaders (`load_project` in the GUI and the
headless `open_project`) then call `project::decode_reference`: if the path still
decodes, the audio comes back exactly as if it had been embedded. If the file is
missing, the project still opens with an empty timeline; the setup and annotations are
intact, and opening the recording again re-links it.

The flag only applies to **file** sources. A synth or a live capture still embeds its
rendered/recorded PCM, because there is no path to re-derive it from. The `.heyl`
stays self-contained for the common case and small for the batch case: one project per
recording would otherwise duplicate every recording's raw `f32` (4.4 MB for 25 s).

## `DATA` section and streaming

- The `DATA` section is the one that can be large; it is written/read in fixed
  chunks and supports **append** (recording) without rewriting earlier chunks.
- A trailing **chunk index** (chunk offsets + lengths) inside the section makes
  random access possible for seeking/zooming without loading the whole file.
- Sample format, rate, and channels are recorded in a small `DATA`-section header
  so the blob is self-describing.
- Optional future optimization: FLAC-compress the `DATA` section (oxiaudio
  `encode_flac` / flexaudio-encode) while keeping the "embedded" property.

## Codec choices

- **postcard** — compact, no_std-friendly binary serialization for structured
  data (metadata, setup, results). No schema/self-describing overhead.
- **serde_json** — for layout, which dockview already serializes as JSON.
- **Raw bytes** — for PCM bulk data (no per-sample serialization overhead).

## Versioning & compatibility

- `version` in the header governs the section set and codecs.
- Readers skip unknown section ids (forward compatibility); missing optional
  sections (`RESULTS`) default to empty.
- `checksum` validates the whole file on load.

## Implemented (M6)

Implemented in `src-tauri/src/project/` (`mod` = constants + CRC-32, `sections` =
payload types, `write`/`read` = the codec); the `save_project` / `load_project`
commands in `src-tauri/src/commands/project.rs` bridge it to the frontend, with
`pick_project_open_path` / `pick_project_save_path` for the native dialogs.

- **Checksum** is a **CRC-32** (IEEE 802.3), stored as a little-endian `u64` (the
  upper 32 bits are zero) over every byte before it.
- **Section index entries** are `offset u64` + `length u64` + `id u8` + 7 reserved
  zero bytes; offsets are absolute from the start of the file.
- **`DATA`** sub-layout: a 24-byte self-describing header (`sample_rate u32`,
  `channels u16`, `format u8` = 0 for `f32`, `frames u64`, `chunk_samples u32`,
  `chunk_count u32`), then the raw interleaved-`f32` chunks, a trailing chunk index
  (`offset u64` + `length u64` per chunk, relative to the payload start), and a
  16-byte footer (`chunk_count u64`, `index_offset u64`). Appending a chunk rewrites
  only the index/footer, never earlier chunks.
- **`SOURCE`** is a `kind`-tagged struct (not a Serde enum): `postcard` cannot encode
  internally-tagged enums. `kind` is `file` / `mic` / `system` / `process` / `mix` /
  `synth`; the kind-specific fields (`path`, `deviceId`, `targetPid`, `gain`,
  `graph`, …) are optional.
- **`LAYOUT`** carries the dockview `toJSON()` snapshot, both graph editors'
  nodes/edges (with positions), and the list of **popped-out tools** (`popouts`) as
  `serde_json`. On load the popped tools' windows are re-created (ADR-11).
- **`RESULTS`** is a `postcard` `Vec<StoredResult>`; it is written **empty** today
  (result caching is deferred — see below). The type is defined now so the format
  stays forward-compatible.

### File association

Project files use the **`.heyl`** extension. `tauri.conf.json` declares it under
`bundle.fileAssociations` (exported UTI `com.anvlkv.heylisten.project`, role
`Editor`, rank `Owner`), so the OS can open a project by double-click. Tauri
delivers the path through the run loop — a macOS `open` event (`RunEvent::Opened`)
or, on Windows/Linux, the command line — and the app loads it. A request that
arrives before the frontend is listening is queued and drained by the
`take_pending_open_paths` command (see `src-tauri/src/commands/project.rs`).

The **supported audio formats** are listed too (role `Viewer`, rank `Alternate`),
so the app can be chosen for an audio file — a Finder *Open With*, a dock drop, or
a command-line path. An opened audio path is delivered alongside `.heyl` paths; the
frontend (`src/state/menu.ts` → `openPaths`) loads a `.heyl` path as a project and
opens any other supported audio path as **a fresh project with that file as its
source**, so you can double-click an `.mp3` and analyse it straight away.

Per-file-type **icons** are not configured: the association reuses the app icon
(or a platform default). A distinct document icon needs platform packaging — a
macOS `.icns` referenced from `Info.plist`, a Windows `DefaultIcon` registry
entry, a Linux `.desktop` icon — which rides with the M7 packaging work.

Opened and saved projects are remembered in **File → Open Recent** (up to 10,
most-recent first, with a **Clear Menu** item). The list is stored as
`recent-projects.json` under the app config directory (`src-tauri/src/recent.rs`);
entries whose file no longer exists are hidden. The native window **title** shows
the project file name on open/save, and the Toolbar shows the project name.

### Related JSON formats (themes M11 ✅; templates M13, planned)

Themes (`.heyltheme`) and analysis templates (`.heyltemplate`) are deliberately **not**
stored in this binary container: they carry no PCM and must be hand-editable and
shareable, so they are JSON files under the app config dir (`themes/`, `templates/`) or
user-chosen paths. Themes shipped in M11 (bundled palettes are authored in TS; installed
files live under `themes/`). A template reuses the `SETUP` / `LAYOUT` *payload types*
(`AnalysisSetup`, `GraphSpec`) encoded with `serde_json` instead of the container's
`postcard` / JSON sections. See [`theming.md`](theming.md) and [`templates.md`](templates.md).

### Deferred

- **Result caching.** `RESULTS` is written empty and the analyzers re-derive their
  results from the embedded audio on load. Persisting the cached results needs a
  central result registry keyed by `(source, window, params)` (the architecture's
  planned cache) and `Deserialize` on `AnalysisResult`; both are out of scope for
  M6.
- **`i16` `DATA`.** The format allows it (`format` byte), but the core stores `f32`
  and always writes `format = 0`.
- **FLAC-compressed `DATA`** (the optional future optimization) is not implemented.
