# MCP comparison — improvements backlog

Findings from a test drive of `compare_analysis` (M25 / M25.B) over the live MCP bridge
against two real projects, and how each was resolved.

Status legend: **bug** = contract violation; **gap** = behaviour narrower than the docs
imply; **nit** = cosmetic/ergonomic. All four were fixed; the last section records what
changed and the tests that cover it.

---

## 1. `maxPoints` does not thin the delta — only the side results (**bug — fixed**)

**Observed.** With `{ tool: "spectrogram", includeData: true, maxPoints: 8 }`:

- `a.result.magDb` / `b.result.magDb` — thinned to 8 frames × 342 bins ✅
- `diff.times` / `diff.columns` / `diff.values` — still **375 × 342** (128,250 values) ❌

**Root cause.** `Comparison::to_value` passed `max_points` only to `side_value` →
`analysis::shape_result_with` for the two **side** results. The `diff` was serialized and
only *stripped* (for non-`Full` shape); `max_points` was never applied to it.

**Contract.** Both the tool schema (`compare_analysis` → `maxPoints`) and
`docs/comparison.md` ("Raw delta arrays … are thinned by `maxPoints` for
series/matrices") promise delta thinning.

**Fix.** `ComparisonDiff::thin` (`compare/diff/mod.rs`) applies family-aware decimation to
a cloned delta before serialization:

- `series` — `times`, `values`, `a`, `b` thinned by the same evenly spaced indices;
- `matrix` — thinned by **whole frames**, keeping `times`, `columns`, `bins` and the
  `frames × bins` `values` consistent;
- `waveform` — `times`/`values` thinned together; `buckets` follows the kept array and
  `sourceBuckets` records the original count (mirroring `sourceFrames`);
- `spectrum` / `modulation` / `scalar` / `notes` / `events` — left whole (event lists are
  never thinned; the rest are single-axis or small).

Stats, `summary` and `matched` keep describing the **full** comparison; only the arrays
are bounded.

**Tests.** `max_points_thins_the_delta_arrays_and_keeps_them_aligned` (series),
`thinning_a_matrix_delta_keeps_whole_frames`, and
`thinning_a_waveform_delta_keeps_times_and_values_aligned`.

---

## 2. `axis: "compact"` is a no-op for overlap-add series (**gap — fixed**)

**Observed.** `run_analysis` / `compare_analysis` with `includeData: true, axis:
"compact"` returned a full `times` array for `frameRms` (and every other hop-based
overlap-add series). Verified the axis is genuinely non-uniform: an overlap-add series
ends with one short edge frame (`frameRms`: steps `0.00452…0.00501`), so the old
"perfectly uniform" test declined to compact.

**Fix.** `uniform_axis` (`shape/decimate.rs`) now requires the **interior** intervals to
be uniform and treats the first/last interval as edge frames. The axis stays lossless:
`firstHop` / `lastHop` are emitted when an edge interval differs from `hop`, so every
time is reconstructible (`t[i] = t[i−1] + hop` inside, the named hop at an edge).
`axis: "compact"` now also applies to the comparison's delta `times`
(`Comparison::to_value`), so side results and the delta agree.

**Tests.** `compact_axis_keeps_an_overlap_add_edge_frame` and
`compact_axis_leaves_a_non_uniform_interior_as_an_array`.

---

## 3. Pitch families diff as generic scalars (**gap — fixed**)

**Observed.** `pitchYin` / `pitchPyin` fell through to `scalar_delta`'s
`generic_fields` fallback, so the delta was a long list of mostly-zero noise:

```
Δ effectiveMaxF0Hz +0 · Δ effectiveMinF0Hz +0 · Δ frames +0 · Δ hopSize +0 ·
Δ plus sampleRate, windowStart, …
```

The meaningful per-frame f0 change was absent.

**Fix.** Pitch results (`pitchYin` / `pitchPyin` / `pitchAutocorr`) now route through
`series_delta` (relative-time matching, gapped `Option<f32>` values), matching how pitch
is already documented under the **series** family. `series_delta` takes the value tracks
as slices, so pitch and the rhythm envelope share it without a synthetic
`SeriesResult`.

**Tests.** `a_pitch_track_compares_as_a_series` (440 Hz vs 220 Hz → a series delta with
a ≈ −220 Hz mean).

---

## 4. `list_analyzers` returns `text`, not `structuredContent` (**nit — fixed**)

**Observed.** `list_analyzers` answered the catalog as a JSON string under
`content[0].text`, whereas `list_projects` / `get_state` also carried
`structuredContent`.

**Fix.** `call_result` (`mcp/protocol.rs`) now wraps an array payload under its natural
key for the 2025-06-18 revision: `list_analyzers` → `{ "analyzers": [...] }`,
`list_output_devices` / `list_input_devices` → `{ "devices": [...] }`,
`list_processes` → `{ "processes": [...] }`. The text form is unchanged, so existing
clients keep working.

**Tests.** `tools_call_wraps_an_array_payload_under_its_key`.

---

## Validation performed

- `cargo test --lib` — 316 passed (includes the five new tests).
- `cargo clippy --all-targets` — clean.
- `npm run typecheck`, `npm run typecheck:e2e`, `npm run test:unit`, `npm run build`
  — all pass.
- `npm run maid` — green (prettier, eslint, the 400-line budget, duplication, knip,
  rustfmt + clippy).
- Runtime, fresh headless MCP binary (`heylisten-mcp --headless`): `list_analyzers`
  answers `structuredContent.analyzers` (one entry per analyzer); `frameRms` with `axis: "compact"`
  returns `{ start, hop, length, end }`; `maxPoints: 8` returns 8 aligned
  `times`/`values`. The running GUI still serves the pre-fix release build until it is
  rebuilt.
