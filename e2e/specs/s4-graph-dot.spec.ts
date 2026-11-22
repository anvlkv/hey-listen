/**
 * S4. Graph DOT interchange (M39, ADR-36).
 *
 * The two committed fixtures under `e2e/fixtures/` are **authored** graphs, not
 * one-node stubs: `tone-stack.dot` is a warm mono → stereo → mono filter chain and
 * `glass-pad.dot` is a detuned saw pad rendered by the synth. V5 adds the M40 pair —
 * `focus-chain.dot` (a nested `subgraph`) and `aurora-pad.dot` (nested `oversample`
 * and `feedback`, plus a `snoop`). Every boundary a graph crosses is driven with them:
 *
 *  - the **filter editor** imports a `.dot`, pushes it to the core and exports it back;
 *  - the **synth editor** imports a `.dot`, renders it to the timeline, then exports it;
 *  - **MCP** lists the node catalog (`list_nodes` / `get_node`), installs a graph from
 *    a `graphFile`, reads it back as DOT, and renders an inline DOT string;
 *  - the **CLI** explains a node, renders a DOT file, and conditions a real WAV with
 *    `--filter`.
 *
 * One pair of fixtures across all four keeps the format pinned end to end. The native
 * file dialogs are stubbed; `graph_read_file` / `graph_write_dot` / the CLI run for
 * real, so the tests read the exported bytes from disk. Sorts before `t-close-main`,
 * which must stay the last suite file.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SEL, graphNode } from "../support/selectors.ts";
import {
  FIXTURES,
  GRAPH_FIXTURES,
  SUBSYSTEM_FIXTURES,
  BAND_FIXTURE,
  WAVETABLE_FIXTURE,
} from "../support/fixtures.ts";
import { openMcp } from "../support/mcp.ts";
import {
  expectToolOk,
  exportGraph,
  filterHint,
  importGraph,
  runCli,
  waitForHint,
} from "../support/graph.ts";
import { quietSynthLive } from "../support/synth.ts";
import {
  activateTab,
  activateToolSection,
  canvasHasInk,
  click,
  closeAllTabs,
  count,
  mockReturn,
  openFixture,
  openTool,
  restoreMocks,
  timelineReadoutText,
  waitFor,
  waitForApp,
  waitForSourceLoaded,
} from "../support/helpers.ts";

describe("S4. Graph DOT interchange (M39)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "heylisten-dot-"));

  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // Replacing the source / discarding unsaved work asks the core to confirm.
    await mockReturn("confirm", true);
  });

  afterEach(async () => {
    await restoreMocks();
    // Re-stub the core's prompt: a render the spec did not ask for (a synth tab whose
    // Live preference is still on) must never open a native dialog and block the run.
    await mockReturn("confirm", true);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("V1 — the filter editor imports a DOT graph and exports it back", async () => {
    await openFixture("sine440");
    await openTool("filter");
    await waitFor(
      async () => (await count(SEL.graphCanvas)) > 0,
      "the graph canvas did not render",
    );

    await importGraph(GRAPH_FIXTURES.filter);
    await waitForHint("10 nodes", "the imported tone stack never reached the filter editor");
    expect(await filterHint()).toContain("11 links");

    // The record-labelled nodes and the stereo bridge are on the canvas, and the
    // debounced `set_filter_graph` accepted the whole chain.
    expect(await count(graphNode("lowshelf"))).toBe(1);
    expect(await count(graphNode("split"))).toBe(1);
    expect(await count(graphNode("reverb_stereo"))).toBe(1);
    expect(await count(graphNode("join"))).toBe(1);
    await browser.pause(600);
    expect(await count(SEL.graphError)).toBe(0);

    const exported = path.join(dir, "tone-stack.export.dot");
    const text = await exportGraph(exported);
    expect(text.startsWith("digraph {")).toBe(true);
    expect(text).toContain('kind="lowshelf", freq=280, q=0.7, gain=1.45');
    expect(text).toContain('kind="reverb_stereo"');
    expect(text).toContain('label="<L> L | <R> R | <L> L | <R> R"');
    expect(text).toContain("width:L -> hall:L");

    // Round-trip through the bytes we just wrote: reset, then import the export.
    await click(SEL.graphClear);
    await waitForHint("2 nodes", "the clear did not reset the filter seed");
    await importGraph(exported);
    await waitForHint("10 nodes", "the exported DOT did not import back");
    expect(await filterHint()).toContain("11 links");
    await browser.pause(600);
    expect(await count(SEL.graphError)).toBe(0);
  });

  it("V2 — the synth editor renders an imported DOT patch and exports it", async () => {
    await openTool("synth");
    // Live is persisted app chrome: an earlier spec (or the developer's own session) can
    // leave it on, and then every settled graph edit re-renders the source.
    await quietSynthLive();
    await importGraph(GRAPH_FIXTURES.synth);
    await waitForHint("14 nodes", "the imported pad never reached the synth editor");
    expect(await count(graphNode("poly_saw"))).toBe(2);
    expect(await count(graphNode("reverb_stereo"))).toBe(1);
    expect(await count(SEL.graphError)).toBe(0);

    // Render the pad (the default 4 s) and adopt it as the timeline source.
    await click(SEL.graphRender);
    await waitForSourceLoaded();
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:04"),
      "the rendered pad (4 s) never replaced the timeline source",
    );
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the rendered pad never drew");
    expect(await count(SEL.graphError)).toBe(0);

    const exported = path.join(dir, "glass-pad.export.dot");
    const text = await exportGraph(exported);
    expect(text).toContain('kind="poly_saw", freq=110');
    expect(text).toContain('kind="declick", time=0.06');
    expect(text).toContain('label="<A> A | <B> B | <out> out"');
    expect(text).toContain("blendA -> blendB:A");
  });

  it("V3 — MCP discovers nodes and round-trips DOT", async () => {
    const client = await openMcp();
    try {
      // The catalog, machine-readable — the same table the palette and CLI report.
      const listed = await client.tool(20, "list_nodes");
      const catalog = listed.structuredContent?.nodes as { kind: string }[];
      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.map((node) => node.kind)).toContain("moog_cv");

      const detail = await client.tool(21, "get_node", { kind: "moog_cv" });
      const node = detail.structuredContent as {
        dot: string;
        node: { kind: string; inputPorts: string[] };
      };
      expect(node.node.kind).toBe("moog_cv");
      expect(node.node.inputPorts).toEqual(["audio", "cut", "Q"]);
      expect(node.dot).toContain('label="<audio> audio | <cut> cut | <Q> Q | <out> out"');

      // A `graphFile` path crosses the boundary as well as inline text…
      const applied = await client.tool(22, "set_filter_graph", {
        graphFile: GRAPH_FIXTURES.filter,
        enabled: true,
      });
      expectToolOk(applied);
      const filter = (await client.tool(23, "get_graph", { graph: "filter" }))
        .structuredContent as { dot: string };
      expect(filter.dot).toContain('kind="reverb_stereo"');
      expect(filter.dot).toContain("width:L -> hall:L");

      // …and an inline DOT string renders a synth source.
      const rendered = await client.tool(24, "render_synth", {
        graph: readFileSync(GRAPH_FIXTURES.synth, "utf8"),
        seconds: 0.5,
      });
      expectToolOk(rendered);
      const source = rendered.structuredContent as { channels: number; duration: number };
      expect(source.channels).toBe(1);
      expect(source.duration).toBeCloseTo(0.5, 1);

      const synth = (await client.tool(25, "get_graph", { graph: "synth" })).structuredContent as {
        dot: string;
      };
      expect(synth.dot).toContain('kind="poly_saw"');
      expect(synth.dot).toContain('kind="reverb_stereo"');
    } finally {
      client.close();
    }
  });

  it("V4 — the CLI lists nodes, renders a DOT file and filters with one", async () => {
    const catalog = JSON.parse(runCli(["nodes", "poly_saw", "--json"])) as {
      dot: string;
      node: { kind: string; synthOnly: boolean };
    };
    expect(catalog.node.kind).toBe("poly_saw");
    expect(catalog.node.synthOnly).toBe(true);
    expect(catalog.dot).toBe('poly_saw [kind="poly_saw", freq=440];');

    // A DOT file renders as the source (0.5 s at 48 kHz).
    const rendered = JSON.parse(
      runCli(["synth", GRAPH_FIXTURES.synth, "--seconds", "0.5", "--pretty"]),
    ) as { source: { channels: number; duration: number; frames: number } };
    expect(rendered.source.channels).toBe(1);
    expect(rendered.source.frames).toBe(24_000);
    expect(rendered.source.duration).toBeCloseTo(0.5, 2);

    // The same filter chain conditions a real file, and the tone survives it.
    const analyzed = JSON.parse(
      runCli([
        "analyze",
        FIXTURES.sine440,
        "-t",
        "spectrum",
        "--filter",
        GRAPH_FIXTURES.filter,
        "--summary",
        "--pretty",
      ]),
    ) as { summary: { items: { key: string; value: number }[] } };
    const peak = analyzed.summary.items.find((item) => item.key === "peakHz");
    expect(peak?.value).toBeGreaterThan(400);
    expect(peak?.value).toBeLessThan(490);
  });

  it("V5 — a subsystem imports, opens, previews and exports as nested DOT", async () => {
    await openTool("filter");
    await importGraph(SUBSYSTEM_FIXTURES.filter);
    await waitForHint("5 nodes", "the subsystem filter never imported");
    expect(await count(graphNode("subgraph"))).toBe(1);
    expect(await count(SEL.graphSubsystemThumbnail)).toBe(1);
    expect(await count(SEL.graphSnoop)).toBe(1);
    await browser.pause(600);
    expect(await count(SEL.graphError)).toBe(0);

    // The node's preview opens the nested chain in its own tab.
    await click(SEL.graphSubsystemOpen);
    await waitFor(
      async () => (await count(SEL.graphSubsystemTitle)) > 0,
      "the subsystem tab never opened",
    );
    await waitForHint("5 nodes", "the subsystem tab did not show the nested chain");
    expect(await filterHint()).toContain("nested in filter");
    expect(await count(graphNode("bell"))).toBe(1);

    // It is listed on the Sidebar's Graphs tab too. Selecting the tab whose cards are
    // already showing would *collapse* the rail, so go through the helper that does not.
    await activateToolSection("filter");
    await waitFor(
      async () => (await count(SEL.sidebarSubsystem)) >= 1,
      "the sidebar does not list the subsystem",
    );

    // Back on the filter graph, the export carries the nesting.
    await activateTab("filter");
    const exported = path.join(dir, "focus-chain.export.dot");
    const text = await exportGraph(exported);
    expect(text).toContain('system="colour.system"');
    expect(text).toContain('subgraph "colour.system" {');
    expect(text).toContain('kind="bell", freq=2600, q=1.1, gain=1.25');
    expect(text).toContain("colour -> probe");

    // MCP installs the same nested file and reads it back as nested DOT.
    const client = await openMcp();
    try {
      const applied = await client.tool(30, "set_filter_graph", {
        graphFile: SUBSYSTEM_FIXTURES.filter,
        enabled: true,
      });
      expectToolOk(applied);
      const filter = (await client.tool(31, "get_graph", { graph: "filter" }))
        .structuredContent as {
        dot: string;
      };
      expect(filter.dot).toContain('subgraph "colour.system" {');
    } finally {
      client.close();
    }

    // The synth fixture's oversampled subgraph and feedback loop render in the CLI.
    const rendered = JSON.parse(
      runCli(["synth", SUBSYSTEM_FIXTURES.synth, "--seconds", "0.5", "--pretty"]),
    ) as { source: { channels: number; frames: number } };
    expect(rendered.source.channels).toBe(1);
    expect(rendered.source.frames).toBe(24_000);
  });

  it("V6 — a multi-output graph is analysed one channel at a time", async () => {
    await openTool("filter");
    await importGraph(BAND_FIXTURE);
    await waitForHint("7 nodes", "the three-band filter never imported");
    expect(await count(graphNode("output"))).toBe(3);
    await browser.pause(600);
    expect(await count(SEL.graphError)).toBe(0);

    // Several declared channels make the tab offer its Analyse selector.
    await waitFor(
      async () => (await count(SEL.graphChannel)) > 0,
      "the filter tab offered no Analyse selector for a 3-channel graph",
    );

    // Each Output's `Ch` survives the export.
    const exported = path.join(dir, "tri-band.export.dot");
    const text = await exportGraph(exported);
    expect(text).toContain('kind="output", channel=2');

    // The same file conditions a real tone, and each channel is its own band.
    const rms = (channel: number): number => {
      const out = JSON.parse(
        runCli([
          "analyze",
          FIXTURES.sine440,
          "-t",
          "waveform",
          "--filter",
          BAND_FIXTURE,
          "-p",
          `channel=${channel}`,
          "--summary",
        ]),
      ) as { summary: { items: { key: string; value: number }[] } };
      return out.summary.items.find((item) => item.key === "rmsDb")?.value ?? 0;
    };
    expect(rms(2)).toBeLessThan(rms(0) - 20);
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
    expect(await count(SEL.graphWavetable)).toBe(1);
    expect(await count(SEL.graphError)).toBe(0);

    // The card's preview opens the rows in their own tab (16 rows: the saw seed).
    await click(SEL.graphWavetableOpen);
    await waitFor(
      async () => (await count(SEL.graphWavetableRow)) === 16,
      "the wavetable tab did not show the default 16 partials",
    );
    expect(await count(SEL.graphWavetableTitle)).toBe(1);

    // Import replaces the table with the fixture's six rows (the dialog is stubbed, the
    // reader runs for real).
    await mockReturn("pick_wavetable_file", WAVETABLE_FIXTURE);
    await click(SEL.graphWavetableImport);
    await waitFor(
      async () => (await count(SEL.graphWavetableRow)) === 6,
      "the six-row wavetable fixture was not imported",
    );

    // Export writes the same shape back: a header, then one `amp,phase` row per line.
    const exported = path.join(dir, "wavetable.export.csv");
    await mockReturn("pick_save_path", exported);
    await click(SEL.graphWavetableExport);
    await waitFor(() => Promise.resolve(existsSync(exported)), "the CSV export was never written");
    const lines = readFileSync(exported, "utf8").trim().split("\n");
    expect(lines.length).toBe(7);
    expect(lines[0]).toBe("amp,phase");
    expect(lines[5]).toBe("0.45,0.125");

    // Adding a row is an edit to the node, so the table grows to seven.
    await click(SEL.graphWavetableAdd);
    await waitFor(
      async () => (await count(SEL.graphWavetableRow)) === 7,
      "the wavetable tab did not add a partial",
    );
  });
});
