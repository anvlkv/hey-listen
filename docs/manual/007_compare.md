# 007 — Compare two projects

Hey Listen compares **projects**, not tracks: the same analyzer on two recordings, each
in its own window, each with its own filter and options.

![A comparison overlaid on one chart](assets/007-compare.png)

## Set it up

Open a second project window with the recording you want to compare. In the first
project, open the analyzer you care about, then right-click its tab and choose
**Compare with…**, and pick the other project. A compare tab opens beside the analyzer.

## Read the comparison

Both results are drawn on one chart with a delta (Δ). The badge tells you whether the
two sides are **Aligned** — measuring the same kind of thing on the same grid. If the
grids differ, the comparison follows the owner's settings and re-runs the reference on
them, so you still get a delta instead of a refusal.

Switch the display between **A**, **B**, and **Δ**. Event, note, and modulation views
pair the two sides and mark anything that exists on only one of them.

## Alignment

Comparisons line up on **relative time** — the start of each analysis window — so two
recordings of different lengths still compare fairly. If one side is shifted, adjust the
reference's offset to fine-tune the match. A strip tells you which reference window is
being shown, in its own absolute time.

## Reference windows

- Closing the reference window keeps the last result; live updates stop and a banner
  says so. Reconnect explicitly when you are ready.
- **Change reference…** retargets the same compare tab instead of opening another.
- **Pop out to window** gives the comparison its own window.

## Keep it

**Save** stores the last successful comparison in the owning project, so you can reopen
it later without the reference project. Close the compare tab and it is still there.

Next: [Preview and keyboard](008_preview.md)
