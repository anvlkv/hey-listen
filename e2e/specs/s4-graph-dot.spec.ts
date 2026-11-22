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
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SEL, graphNode } from "../support/selectors.ts";
import { CLI_BINARY, FIXTURES, GRAPH_FIXTURES, SUBSYSTEM_FIXTURES } from "../support/fixtures.ts";
import { openMcp, type ToolResult } from "../support/mcp.ts";
import { filterHint } from "../support/graph.ts";
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

/** Fail with the tool's own message when an MCP call reports an error. */
function expectToolOk(result: ToolResult): void {
  if (result.isError) {
    throw new Error(`the MCP tool failed: ${result.content?.[0]?.text ?? "(no message)"}`);
  }
}

/** Wait until the active graph editor reports `text` in its toolbar hint. */
async function waitForHint(text: string, failure: string): Promise<void> {
  await waitFor(async () => (await filterHint()).includes(text), failure);
}

/** Import a graph into the active editor (the picker is stubbed to `source`). */
async function importGraph(source: string): Promise<void> {
  await mockReturn("pick_graph_file", source);
  await click(SEL.graphImport);
}

/** Export the active editor's graph (the save dialog is stubbed to `destination`). */
async function exportGraph(destination: string): Promise<string> {
  await mockReturn("pick_save_path", destination);
  await click(SEL.graphExport);
  await waitFor(() => Promise.resolve(existsSync(destination)), "the DOT export was never written");
  return readFileSync(destination, "utf8");
}

/** Run the CLI sidecar; a missing build is a clear failure, not a cryptic ENOENT. */
function runCli(args: string[]): string {
  if (!existsSync(CLI_BINARY)) {
    throw new Error(`the CLI sidecar is missing at ${CLI_BINARY} — run \`npm run tauri build\``);
  }
  return execFileSync(CLI_BINARY, args, { encoding: "utf8", maxBuffer: 8 << 20 });
}

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
});
