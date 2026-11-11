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
| 0x02 | `SOURCE` | postcard | `SourceDescriptor` (file path / input config / synth graph) |
| 0x03 | `DATA` | raw PCM blob | interleaved `f32` (or `i16`) samples, chunked |
| 0x04 | `SETUP` | postcard | `AnalysisSetup` (tools, configs, shared params) |
| 0x05 | `LAYOUT` | serde_json | dockview JSON + solid-flow node positions |
| 0x06 | `RESULTS` | postcard | cached `AnalysisResult` list |
| 0x07 | `ANNOTATIONS` | postcard | the project's annotations (`Annotation` list: anchor time + optional range, tool, markdown body, frozen values) |
| 0x08 | `COMPARE` | postcard | saved comparison snapshots (M25.C): one reference analysis result + setup per tool |

## Cached results (`RESULTS`)

The `RESULTS` section (id `0x06`) carries the analyzer results the project had already
computed, as a `postcard` `Vec<StoredResult>` — one entry per cached analyzer result:

| Field | Meaning |
| --- | --- |
| `tool` | The analyzer id that produced the result. |
| `start` / `end` | The analysis window it covers (source seconds). |
| `params` | The shared params it was computed with. |
| `options` | The per-tool options it was computed with. |
| `result` | The result itself, postcard-encoded. |

`save_project` writes the frontend's result cache (`src/state/analyzer/cache.ts`), which
holds one entry per tool for the current source **and** applied filter. On load the
frontend seeds that cache from the section, so the analyzer tabs show the saved results
instead of re-running every analyzer. The cache key is the source, the window, the
shared params, the per-tool options and the filter: an entry that does not match the
restored setup is simply recomputed, and a tool without an entry runs as usual. An
entry this build cannot decode is logged and skipped, so the section stays
forward-compatible. Its payload is the postcard-safe mirror of `AnalysisResult`
(`StoredAnalysisResult`), for the reason the `COMPARE` section gives [below](#comparisons-m25c).

## Annotations (M14)

The `ANNOTATIONS` section (id `0x07`) carries the project's **annotations** as a `postcard`
`Vec<Annotation>` — the same `Annotation` / `AnnotationValues` types the frontend and the MCP surface use
(see [`annotations.md`](annotations.md)). The section and the type are both named for
**annotations**; the `noteMetrics` analyzer's *detected note segments* are a different
thing. It is written from the frontend's annotations store through
`save_project` and returned by `load_project`, exactly like `SETUP`. Because the header
version governs the section set and readers skip unknown ids, an `ANNOTATIONS` section is
**forward-compatible**: an older build opens the project and simply ignores it, and a
file with no `ANNOTATIONS` section loads with zero annotations. Keeping annotations in their own section
(rather than inside `SETUP`) keeps the analysis setup a pure `AnalysisSetup` and lets the
CLI read just the annotations (`hey-listen-cli annotations <FILE.heyl>`).

## Comparisons (M25.C)

The `COMPARE` section (id `0x08`) carries the project's **saved comparisons** as a
`postcard` `Vec<SavedComparison>` (see [`comparison.md`](comparison.md)). Each entry is a
**snapshot of the reference side**, not a link:

| Field | Meaning |
| --- | --- |
| `tool` | The analyzer id (one saved comparison per tool). |
| `referenceName` | The reference project's display name (window labels are session-scoped, so they are not stored). |
| `referencePath` | The reference project's **file path** (`null` when the reference was never saved). The compare view's **Open reference** opens exactly this file; it is not resolved by name. |
| `source` | The reference's source shape (rate / channels / duration), for the header. |
| `window` | The reference's analysis window (`start..end`, absolute source seconds). |
| `params` / `options` | The shared params and effective tool options the result was produced with. |
| `filterFingerprint` | A canonical JSON fingerprint of the reference's applied filter (`null` = unfiltered), so `filtersDiffer` still works after reload. |
| `bOffset` | The fine-tune offset (M25.B) in seconds, relative to the owner. |
| `savedMs` | When the snapshot was written (Unix ms). |
| `result` | The reference's full `AnalysisResult` for that window (M25.C). |

No reference **audio** is embedded: the snapshot is the final analysis window, so a
saved comparison is reproducible without the other project. `save_project` writes one
entry per comparison open at save time (tab or popout); `load_project` returns them and
the core keeps them per window, so a compare view can bind to the snapshot after reload.
The frontend supplies the open compare tools (`compareOpen`) and the core fills each
entry from its last successful comparison; a closed comparison is dropped on the next
save. A **headless** session writes the same section: `compare_analysis` against a
project file stores that reference side, and `save_project` writes it (M25.D).

The payload is `postcard` with a **postcard-safe mirror** of the result
(`results::StoredAnalysisResult`): the IPC enum is internally tagged (`tool` key), which
`postcard` cannot decode, and JSON would make a 512-frame spectrogram several megabytes
instead of roughly 0.5 MB. The mirror is an externally tagged enum with one newtype
variant per tool, and the conversions are exhaustive, so a new analyzer cannot be added
without a stored form.

The mirror also covers the payloads that **skip** an absent optional key on the JSON
wire (`SeriesResult`'s `frameSize` / `gate` and `NoteMetricsResult`'s `syllables`).
`skip_serializing_if` only affects writing, so a stored result that skipped a field
would make the reader run off the end of the buffer; `StoredSeries` and
`StoredNoteMetrics` write every field in struct order instead. The `COMPARE` section
itself is additive: an older build opens a project that has one and ignores it, and a
file without one loads with no saved comparisons.

`referencePath` was appended after the first released snapshot layout, so a file from
an older build decodes as that layout (the reader tries the current payload, then the
older one) and simply has no recorded path. The reverse does not hold: a build that
predates `referencePath` cannot read a newer `COMPARE` payload — postcard carries no
field names to skip.

The panel itself is still not in `LAYOUT` (compare panels are sanitised out); restoring a
saved comparison re-creates its Workbench **tab** after the project state is ready.

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
  sections (`RESULTS`, `COMPARE`) default to empty. Older builds open a project with
  saved comparisons and simply ignore them.
- `checksum` validates the whole file on load.

### Format version history

`VERSION` (in `project/mod.rs` and the header) is the **single** container version this
build writes. It is bumped only by an **incompatible** change, and every bump is recorded
here — this table is the authoritative history; the reader's supported range and migration
steps are derived from it (see [Migrations](#migrations)).

| Version | Change | Introduced in |
| --- | --- | --- |
| 1 | Initial container (M6). Sections grew **additively** without a bump: `ANNOTATIONS` (M14), `COMPARE` (M25.C), the `RESULTS` payload, `LAYOUT.filterSpec` (M25.D), and the `COMPARE` `referencePath` field. | M6 |

**Not a bump.** Adding a section id, a `LAYOUT` JSON key, or a key in the flexible
`SETUP.tool_options` / `tool id → key → number` map is forward/backward compatible and
does not bump. Only a change to a `postcard` payload shape, a field's *meaning*, or the
`DATA` sub-layout is incompatible. M37 added the migration mechanism itself, which reads
and writes version 1 unchanged, so the table still has one row.

`MIN_READ_VERSION` (in `project/mod.rs`, next to `VERSION`) is the oldest version this
build reads; it moves only when a step can no longer read its input. The reader accepts
exactly `MIN_READ_VERSION..=VERSION`.

## Migrations

Incremental, **version-to-version**, and never silent (M37). See ADR-32 for the design and
[`roadmap.md`](roadmap.md) → M37 for the delivered surface; this section records the file
contract.

- **Chain, not a rewrite.** A bump adds one step `from_vN_to_vNp1` to `STEPS` in
  `project/migrate/`. The reader hands the payloads over **undecoded** (raw `postcard`
  bytes, plus the JSON `LAYOUT` and the already-decoded `DATA`), so a step decodes each
  section it changes with its own **frozen** `vN` type, converts it to today's type and
  re-encodes it; sections it did not change pass through untouched. `read_project` decodes
  every payload only after the chain reaches `VERSION`, so each step knows exactly two
  adjacent versions. `DATA` is never copied or rewritten to migrate. The frozen `vN` types
  are release snapshots and are never edited after the fact.
- **What survives.** `SOURCE`, `DATA`, `SETUP` (open tools, shared params, tool options,
  window/view), `LAYOUT` (both graph editors, `filterSpec`, popouts), `META`, and
  `ANNOTATIONS` must survive every hop. A step that cannot produce one of these fails the
  load with a clear error rather than silently emptying it.
- **What may be dropped.** `RESULTS` is dropped for any pre-`VERSION` file (it is a cache,
  recomputed on demand), and a `COMPARE` section whose stored snapshots cannot be decoded
  is dropped with a warning (those are analysis output too). Neither is an error; `migrate`
  reports both per file (`dropped`).
- **Two surfaces, both visible.** (1) **On load** — `read_project` accepts
  `MIN_READ_VERSION..=VERSION`, migrates in memory, and reports the source version
  (`LoadedProject.upgraded_from`, `LoadedProjectDto.upgradedFrom`); the app shows
  *“upgraded from vN”* and keeps the project dirty so a save writes the current version.
  Nothing is rewritten at open. (2) **The migration script** — `hey-listen-cli migrate`
  (see [`cli.md`](cli.md)) runs the same chain and writes the current version atomically,
  with a `.bak` sibling by default (`--no-backup` opts out), for bulk/headless upgrades.
- **Newer versions are refused.** A file outside `MIN_READ_VERSION..=VERSION` is
  `UnsupportedVersion`, never a best-effort read: `postcard` is not self-describing, so a
  newer file read by an older build would silently misread trailing fields. The header is
  the contract.
- **Reference projects.** The loader reports `embedded` (did the file carry `DATA`); a
  re-save and `migrate` keep `embedSource: false`, so a reference project is not silently
  grown into a full copy. `migrate --embed` is the explicit opt-in.
- **Tests.** The step table is asserted to cover `MIN_READ_VERSION..VERSION`; a synthetic
  step pins ordering, the version guard and the `RESULTS` drop; a newer version is
  rejected; and `migrate` is tested for the untouched-current-file, `--embed` + `.bak`, and
  missing-file cases (`project/migrate/tests.rs`, `cli/src/batch/tests/migrate.rs`).

## Writing is atomic

Every save (GUI, headless MCP `save_project`, CLI `project` / `annotations` / `compare
--save`) goes through one helper, `project::write_project_atomic`: the complete file is
written to a unique sibling temporary file, flushed and `sync_all`ed, then renamed over
the destination. A write error, a full disk or a crash before the rename therefore leaves
the previous project intact instead of truncating it; the temporary file is removed on a
pre-rename failure. Readers never see a partial file, because the rename is atomic on the
same file system.

The loader is also bounds-first: every `DATA` allocation (the chunk index, the sample
buffer) is validated against the section's actual length with checked arithmetic before it
is made, so a crafted header with a recomputed checksum is a `Corrupt` error rather than an
oversized allocation.

## Implemented (M6)

Implemented in `src-tauri/src/project/` (`mod` = constants + CRC-32, `sections` =
payload types, `write`/`read` = the codec, `migrate` = the version chain, M37); the
`save_project` / `load_project` commands in `src-tauri/src/commands/project.rs` bridge it to
the frontend, with `pick_project_open_path` / `pick_project_save_path` for the native
dialogs.

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
  internally-tagged enums. `kind` is the `SourceKind` enum (`file` / `mic` / `system` /
  `process` / `mix` / `synth`), serialized as that same string (M15.B); the
  kind-specific fields (`path`, `deviceId`, `targetPid`, `gain`,
  `graph`, …) are optional.
- **`LAYOUT`** carries the dockview `toJSON()` snapshot, both graph editors'
  nodes/edges (with positions), the list of **popped-out tools** (`popouts`), and the
  **compiled filter** (`filterSpec`) as `serde_json`. On load the popped tools' windows
  are re-created (ADR-11). `filterSpec` is the `GraphSpec` the app applied to
  preview/analysis (`null` when no filter is applied), so the batch CLI's `compare` can
  condition each project like the app: it is additive JSON, the app ignores it on load
  (the editor state is authoritative), old files simply lack it, and the CLI then
  compares unfiltered with a warning. Compare panels are stripped from the dockview
  snapshot before it is written (see [`comparison.md`](comparison.md)).
- **`SETUP.openTools`** lists the analyzer tabs the project was saved with. A GUI save
  also carries the full `LAYOUT.dockview`, so the layout is authoritative; a **headless**
  save has no dockview, and the loader opens the listed tabs to fill an empty Workbench
  (M25.D).
- **`RESULTS`** is a `postcard` `Vec<StoredResult>`, one entry per cached analyzer result
  (see [Cached results](#cached-results-results)).

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

- **`i16` `DATA`.** The format allows it (`format` byte), but the core stores `f32`
  and always writes `format = 0`.
- **FLAC-compressed `DATA`** (the optional future optimization) is not implemented.
