/**
 * S4 (tables). Variadic-table nodes: the `wave_synth` wavetable and the `sequence`
 * note list (M41).
 *
 * A node kind may declare a **variadic table** (`NodeTable`): rows appended after its
 * named params, edited in the node's own Workbench tab (`table:<parent>/<node>`), packed
 * into one DOT attribute. The two roles share the whole mechanism — params tail, packed
 * attribute, tab, import/export — and differ only in the figure drawn for them (a
 * waveform cycle, or a piano roll) and in each column's range (`NodeColumn`).
 *
 * V7 pins the wavetable half; V8 pins the sequence half, including the claim that makes
 * it a *sequence*: the rendered graph is a melody (several distinct pitches), not a tone.
 *
 * Sorts before `t-close-main`, which must stay the last suite file.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SEL } from "../support/selectors.ts";
import { MELODY_FIXTURE, MELODY_ROWS, WAVETABLE_FIXTURE } from "../support/fixtures.ts";
import { openMcp } from "../support/mcp.ts";
import { expectToolOk, exportGraph, importGraph, waitForHint } from "../support/graph.ts";
import { quietSynthLive } from "../support/synth.ts";
import { activateTab, click, count, mockReturn, openTool, waitFor } from "../support/helpers.ts";
import { projectSessionHooks } from "../support/session.ts";

describe("S4b. Graph tables (M41)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "heylisten-tables-"));
  // A fresh app with no tabs and the core `confirm` prompt stubbed.
  projectSessionHooks();

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("V7 — a table node edits, imports and exports its rows in its own tab", async () => {
    await openTool("synth");
    await quietSynthLive();

    // A `wave_synth` node with no table of its own starts on the catalog's default rows.
    const source = path.join(dir, "wave-table.dot");
    writeFileSync(
      source,
      'digraph {\n  node [shape=record];\n  wt [kind="wave_synth", freq=220];\n  out [kind="output"];\n  wt -> out;\n}\n',
    );
    await importGraph(source);
    await waitForHint("2 nodes", "the wavetable patch never imported");
    expect(await count(SEL.graphTable)).toBe(1);
    expect(await count(SEL.graphError)).toBe(0);

    // The card's figure opens the rows in their own tab (16 rows: the saw seed).
    await click(SEL.graphTableOpen);
    await waitFor(
      async () => (await count(SEL.graphTableRow)) === 16,
      "the table tab did not show the default 16 partials",
    );
    expect(await count(SEL.graphTableTitle)).toBe(1);

    // Import replaces the table with the fixture's six rows (the dialog is stubbed, the
    // reader runs for real).
    await mockReturn("pick_table_file", WAVETABLE_FIXTURE);
    await click(SEL.graphTableImport);
    await waitFor(
      async () => (await count(SEL.graphTableRow)) === 6,
      "the six-row wavetable fixture was not imported",
    );

    // Export writes the same shape back: the column header, then one row per line.
    const exported = path.join(dir, "wavetable.export.csv");
    await mockReturn("pick_save_path", exported);
    await click(SEL.graphTableExport);
    await waitFor(() => Promise.resolve(existsSync(exported)), "the CSV export was never written");
    const lines = readFileSync(exported, "utf8").trim().split("\n");
    expect(lines.length).toBe(7);
    expect(lines[0]).toBe("amp,phase");
    expect(lines[5]).toBe("0.45,0.125");

    // Adding a row is an edit to the node, so the table grows to seven.
    await click(SEL.graphTableAdd);
    await waitFor(
      async () => (await count(SEL.graphTableRow)) === 7,
      "the table tab did not add a row",
    );
  });

  it("V8 — a sequence node plays its notes as a melody", async () => {
    await openTool("synth");
    await quietSynthLive();

    // The fixture is a `sequence` node whose nested voice is `input → saw_cv → lowpass`.
    await importGraph(MELODY_FIXTURE);
    await waitForHint("2 nodes", "the sequence patch never imported");
    expect(await count(SEL.graphError)).toBe(0);
    expect(await count(SEL.graphTable)).toBe(1);

    // Its eight notes are in the table tab; a CSV import replaces them with seven.
    await click(SEL.graphTableOpen);
    await waitFor(
      async () => (await count(SEL.graphTableRow)) === 8,
      "the sequence tab did not show the fixture's eight notes",
    );
    await mockReturn("pick_table_file", MELODY_ROWS);
    await click(SEL.graphTableImport);
    await waitFor(
      async () => (await count(SEL.graphTableRow)) === 7,
      "the seven-row note fixture was not imported",
    );

    // The notes export under their own column names.
    const exported = path.join(dir, "melody.export.csv");
    await mockReturn("pick_save_path", exported);
    await click(SEL.graphTableExport);
    await waitFor(() => Promise.resolve(existsSync(exported)), "the note export was never written");
    const lines = readFileSync(exported, "utf8").trim().split("\n");
    // A header plus one line per imported row (seven).
    expect(lines.length).toBe(8);
    expect(lines[0]).toBe("start,dur,note,vel");
    expect(lines[6]).toBe("1.5,0.25,67,0.75");

    // DOT keeps the table and the voice together: one packed attribute, one nested
    // block. The export button lives on the **graph** tab's toolbar, and the table tab
    // took the focus above, so come back to the synth graph first.
    await activateTab("synth");
    const dot = await exportGraph(path.join(dir, "melody.export.dot"));
    expect(dot).toContain('kind="sequence"');
    expect(dot).toContain('notes="');
    expect(dot).toContain('subgraph "seq.system"');
    expect(dot).toContain('kind="saw_cv"');

    // The claim that makes it a sequence: the render is a melody, not one tone. The
    // compact `noteMetrics` result already carries the note count and each note's
    // median f0, so no full array is needed.
    //
    // The window and `channel` are pinned and `transient`: shared params outlive a spec,
    // and an earlier one leaves a narrow window and a multi-channel pick behind.
    const client = await openMcp();
    try {
      const rendered = await client.tool(30, "render_synth", {
        graphFile: MELODY_FIXTURE,
        seconds: 3,
      });
      expectToolOk(rendered);
      const source = rendered.structuredContent as { duration: number };
      expect(source.duration).toBeCloseTo(3, 1);

      const notes = await client.tool(31, "run_analysis", {
        tool: "noteMetrics",
        start: 0,
        end: source.duration,
        params: { channel: 0 },
        transient: true,
        previewRecords: 8,
        display: false,
      });
      expectToolOk(notes);
      const payload = notes.structuredContent as {
        summary: { text: string };
        result: { noteCount: number; notes: { preview: { f0MedianHz: number }[] } };
      };
      const { result } = payload;
      if (result.noteCount !== 8) {
        throw new Error(`the melody was not segmented into 8 notes — ${payload.summary.text}`);
      }
      const pitches = new Set(result.notes.preview.map((note) => Math.round(note.f0MedianHz)));
      expect(pitches.size).toBeGreaterThanOrEqual(3);
    } finally {
      client.close();
    }
  });
});
