# Project file format (binary)

Single-file, versioned container. Embedded raw audio (no external refs), with
streaming for very large audio.

## Goals

- Embed raw audio data (no external file references).
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
