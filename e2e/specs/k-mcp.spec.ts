/**
 * K. MCP server (M9) — agent access + UI following.
 *
 * The app hosts the MCP server on a loopback port (advertised in the `mcp-settings.json`
 * store under the app data dir, key `boundPort`); the `heylisten-mcp` bridge is a
 * stdio ⇄ socket pump. These tests speak MCP to that endpoint directly from Node (no
 * bridge), driving the **running** app: an agent call opens a source / a Workbench tab in
 * the live window (UI following), and `get_state` reports what the window is showing.
 *
 * A source is opened over MCP (not the picker), so the replace-confirm never shows.
 */
import { SEL } from "../support/selectors.ts";
import { FIXTURES } from "../support/fixtures.ts";
import { openMcp, type McpClient } from "../support/mcp.ts";
import { count, isToolOpen, waitForTab } from "../support/helpers.ts";

describe("K. MCP server (agent access + UI following)", () => {
  let client: McpClient;

  before(async () => {
    // MCP is **off by default**; `openMcp` switches it on (on a free port, so a dev
    // instance cannot collide) and connects to the advertised endpoint.
    client = await openMcp();
  });

  after(() => {
    client?.close();
  });

  it("K1 — initialize and tools/list describe the server", async () => {
    const init = await client.request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1" },
    });
    const result = init.result as { serverInfo: { name: string }; protocolVersion: string };
    expect(result.serverInfo.name).toBe("hey-listen");
    expect(result.protocolVersion).toBe("2025-06-18");

    const list = await client.request(2, "tools/list");
    const tools = (list.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(tools).toContain("get_state");
    expect(tools).toContain("run_analysis");
    expect(tools).toContain("set_filter_graph");
    expect(tools).toContain("open_audio_file");
  });

  it("K2 — opening a source over MCP lands on the live timeline", async () => {
    const opened = await client.tool(3, "open_audio_file", {
      path: FIXTURES.sine440,
      replace: true,
    });
    expect(opened.isError).toBe(false);

    // The agent can observe the source it just opened…
    const state = (await client.tool(4, "get_state")).structuredContent as {
      source: { channels: number; duration: number } | null;
    };
    expect(state.source).not.toBeNull();
    expect(state.source?.channels).toBe(1);
    expect(state.source?.duration).toBeCloseTo(2, 1);

    // …and the user's window follows: the Timeline replaced the "Add audio" strip.
    await browser.waitUntil(async () => (await count(SEL.timeline)) > 0, {
      timeoutMsg: "the source opened over MCP never reached the timeline",
    });
  });

  it("K3 — run_analysis returns the result and opens the analyzer tab", async () => {
    const result = await client.tool(5, "run_analysis", {
      tool: "spectrum",
      start: 0.2,
      end: 1.8,
    });
    expect(result.isError).toBe(false);

    const payload = result.structuredContent as {
      window: { start: number; end: number };
      params: { fftSize: number };
      result: { tool: string; peakHz: number };
    };
    // The `tool` tag rides on the result (the envelope no longer repeats it), and the
    // effective window/params the call ran with are echoed.
    expect(payload.result.tool).toBe("spectrum");
    expect(payload.result.peakHz).toBeGreaterThan(400);
    expect(payload.result.peakHz).toBeLessThan(480);
    expect(payload.params.fftSize).toBeGreaterThan(0);
    expect(payload.window.start).toBeCloseTo(0.2, 1);

    // UI following: the analyzer's tab is now open in the Workbench.
    await waitForTab("spectrum");
  });

  it("K5 — display:false computes without a tab; transient does not write back", async () => {
    // A tool that is not open yet: `display: false` must not open its tab.
    const before = await isToolOpen("spectralCentroid");
    const computed = await client.tool(7, "run_analysis", {
      tool: "spectralCentroid",
      display: false,
      transient: true,
      params: { fftSize: 4096 },
    });
    expect(computed.isError).toBe(false);
    const payload = computed.structuredContent as { params: { fftSize: number } };
    // The result echoes the transient override…
    expect(payload.params.fftSize).toBe(4096);
    // …without opening a tab…
    expect(await isToolOpen("spectralCentroid")).toBe(before);

    // …and without writing the override back to the shared params.
    const state = (await client.tool(8, "get_state")).structuredContent as {
      params: { fftSize: number };
    };
    expect(state.params.fftSize).not.toBe(4096);
  });

  it("K4 — open_tool drives the Workbench", async () => {
    await client.tool(6, "open_tool", { tool: "waveform" });
    await waitForTab("waveform");
    expect(await isToolOpen("waveform")).toBe(true);
  });
});
