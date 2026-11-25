# Source storage

A project has one source, and its audio is persisted in one of the modes of
`SourceStorage` (`src-tauri/src/project/sections.rs`, written onto
`SourceDescriptor.storage`):

| Mode | `DATA` section | On load | File watcher |
| --- | --- | --- | --- |
| `embedded` | the samples | from the file | — |
| `linked` | — | decode the recorded path | — |
| `liveLink` | — | decode the recorded path | re-read whenever the file changes |

Only a **file** source can be non-embedded. A synth render and a live capture have no
file to point at, so the writer normalises every other `SourceKind` back to `embedded`.

The mode is **project content**: it travels in the pushed `ProjectSnapshot`, it is
undoable, and it is written to the `SOURCE` section. Loading a project restores it.

## The path

`SourceDescriptor.path` stays absolute (provenance, MCP, "open reference"). At save time
the writer also records `relativePath` — the path relative to the `.heyl` file — whenever
the audio sits under the project's folder. `project::resolve_link` tries the relative
path against the project's directory first, then the absolute one, and reports nothing
when neither names a file, so a project folder can be moved (or copied beside its audio)
and still open.

## Choosing the mode

The Sources rail shows the modes as radio cards, and the same component is the modal
shown right after an audio file is picked. The first open defaults to `embedded`; every
explicit choice — the chooser's confirmation or the panel's switch — is remembered in
`localStorage`, so the next open starts there.

- Leaving `embedded` for either link mode is refused **in the UI**: both assert that the
  file on disk is the project's audio, which an in-memory copy cannot vouch for. That
  needs a fresh read — replace the source (or pick the mode in the post-pick dialog).
- `linked → embedded` is allowed: freezing the audio in hand is always sound.
- `linked ↔ liveLink` only toggles the watcher.

Agents are not UI users: MCP's `save_project` / `open_audio_file` take `storage` (the
older `embedSource` boolean is an alias for `embedded` / `linked`), and the CLI's
`project --storage` accepts the same wire spellings, with `--reference` as the `linked`
shorthand.

## The writer owns the invariant

`project::write` is the one place that decides whether a `DATA` section exists: a source
that is not `embedded` writes no samples, and a non-file source is normalised back to
`embedded` first. No caller can write a file whose `SOURCE` and `DATA` disagree.

## Live link

A `liveLink` source is watched by the core (`src-tauri/src/state/watch.rs`): a
one-second `metadata()` poll with a 500 ms settle, no extra dependency. It emits
`source-changed` (`changed` / `missing`) to the project window. The frontend re-reads the
file through the same `stream_file` command an open uses and adopts the PCM **in place**
(`applySourceInPlace`): the analysis window, view, annotations and undo history stay put,
the analyzer results are invalidated by the new source object, and a shrinking file
clamps the window and annotations. A missing file keeps the last decode and reports the
error on the source line; every re-read is logged.

## A link that does not resolve

A missing link never fails a load. The project opens with an empty timeline and a modal
offers **Locate file…** (re-link the audio) or, at save time when the audio is in memory,
**Embed this audio**. The core also refuses a save whose link does not resolve, so a
project that cannot reopen is never written.

## Container v8

`SOURCE` gained `storage` and `relativePath` (appended, so a version-7 payload is a strict
prefix of a version-8 one), and `COMPARE` gained the reference fragment
([saved-references.md](saved-references.md)). `VERSION` is 8 with a `v7 → v8` step that
infers the mode from what the file actually carried: a `File` source with no `DATA` and a
path becomes `linked`, everything else `embedded`. A project saved as a reference
therefore does not silently grow a full copy on its next save.
