# Saved references

A saved comparison (the file's `COMPARE` section) is the reference side of one compare
tab, frozen at save time: its setup, filter fingerprint and **result** (ADR-34), and now
its **window audio**.

## The fragment

`SavedComparison.fragment` holds the reference's analysis window as interleaved samples
at the reference source's own rate, `i16`-quantised — the same convention as the project
file's `i16` `DATA` format (`audio::pcm::quantize_i16` / `dequantize_i16`). There is no
size cap: a snapshot always carries its audio, so a comparison stays self-sufficient
whatever happens to the reference project.

## Re-grid

`compare::compare_saved` re-runs the reference on the **owner's** grid from that fragment:
the owner's shared params and tool options, the reference's own window and channel, and
the reference's filter rebuilt from `filter_fingerprint` (which is the canonical
`GraphSpec` JSON). That is exactly what a live reference does, so a delta always exists
and `comparability.regridded` is `true`.

The filter is never silently dropped: when the fingerprint exists but no longer parses,
the comparison keeps the stored result and the grid gate. The stored `result` is the
own-grid fallback, used only by a snapshot with no fragment — one written before v8.

## Several comparisons on one project

Because each snapshot owns its audio, a comparison is identified by **tool, reference
project and reference window** (`SavedComparison::same_pair`). Two windows of one
reference project are independent comparisons, and a project can be compared against
itself while it is open in two windows — the self-comparison guard still refuses the case
that is meaningless, a window naming itself.

## Re-link and update

`reference_path` (the reference **project** file) and `source_path` (its **audio** file)
travel with the snapshot. When the reference project is open in another window, the
notice strip offers **Update from the open reference**: the tab rebinds to the live
project, re-runs, and refreshes both the result and the fragment. A closed reference keeps
working from the fragment — that is the point of storing it.

A pre-v8 snapshot has no fragment. It is shown on its own grid (the grid gate) with a
notice saying so, and **Update from the open reference** is how it is refreshed.

## Cost

The fragment is the reference's *analysis window*, so a whole-recording window costs
about as much as embedding that recording, on top of the owner's own `DATA`. Typical
windows are kilobytes to a few megabytes. `i16` halves the size; nothing is compressed —
a compressed `DATA` section is D-29 in the deferred ledger (which the docs reorganisation
moved to [`../archive/deferred.md`](../archive/deferred.md)).

## Container v8

`fragment` and `source_path` are appended to the snapshot (a version-7 payload is a
strict prefix); the `v7 → v8` step decodes the old shape and leaves both empty, so an old
saved comparison keeps exactly the behaviour it had. See
[source-storage.md](source-storage.md) for the rest of the version bump.
