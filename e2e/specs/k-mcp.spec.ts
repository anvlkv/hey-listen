/**
 * K. MCP server (M9) — agent access + UI following.
 *
 * The app hosts the MCP server on a loopback port (advertised in `mcp.json` under
 * the app config dir); the `heylisten-mcp` bridge is a stdio ⇄ socket pump. These
 * tests speak MCP to that endpoint directly from Node (no bridge), driving the
 * **running** app: an agent call opens a source / a Workbench tab in the live
 * window (UI following), and `get_state` reports what the window is showing.
 *
 * A source is opened over MCP (not the picker), so the replace-confirm never shows.
 */
import { connect, type Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { SEL } from "../support/selectors.ts";
import { FIXTURES } from "../support/fixtures.ts";
import {
  count,
  invokeCore,
  isToolOpen,
  selectMainWindow,
  waitForApp,
  waitForTab,
} from "../support/helpers.ts";

/** The endpoint the running app advertises (`src-tauri/src/mcp/server.rs`). */
interface ServerInfo {
  port: number;
  token: string;
}

/** The shape of an MCP `tools/call` result. */
interface ToolResult {
  content: { type: string; text: string }[];
  isError: boolean;
  structuredContent?: Record<string, unknown>;
}

/** The app's `mcp.json` path (mirrors the bridge's `data_dir`). */
function infoPath(): string {
  const override = process.env.HEYLISTEN_MCP_INFO;
  if (override) return override;
  const identifier = "com.anvlkv.heylisten";
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", identifier, "mcp.json");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? homedir(), identifier, "mcp.json");
  }
  const base = process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share");
  return path.join(base, identifier, "mcp.json");
}

/** Wait for the app to advertise its MCP endpoint, then read it. */
async function readInfo(): Promise<ServerInfo> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return JSON.parse(await readFile(infoPath(), "utf8")) as ServerInfo;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`the app never advertised its MCP endpoint: ${String(lastError)}`);
}

/** A minimal newline-delimited JSON-RPC client over the app's MCP socket. */
class McpClient {
  private buffer = "";
  private waiter: ((line: string) => void) | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.feed(chunk));
    // A transport failure surfaces as a read timeout; swallow it here so Node's
    // unhandled 'error' does not abort the whole run.
    socket.on("error", () => {});
  }

  static async open(info: ServerInfo): Promise<McpClient> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const connection = connect({ host: "127.0.0.1", port: info.port }, () => resolve(connection));
      connection.once("error", reject);
    });
    // The token is the connection's first line.
    socket.write(`${info.token}\n`);
    return new McpClient(socket);
  }

  private feed(chunk: string) {
    this.buffer += chunk;
    for (let index = this.buffer.indexOf("\n"); index >= 0; index = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      const waiter = this.waiter;
      this.waiter = null;
      waiter?.(line);
    }
  }

  private readLine(): Promise<string> {
    // Fail fast instead of hanging forever if the app never answers.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error("no MCP response within 20s"));
      }, 20_000);
      this.waiter = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
    });
  }

  async request(id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
    this.socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return JSON.parse(await this.readLine()) as Record<string, unknown>;
  }

  /** Call a tool, failing the test on a JSON-RPC error. */
  async tool(id: number, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const response = await this.request(id, "tools/call", { name, arguments: args });
    if (response.error) throw new Error(`tools/call failed: ${JSON.stringify(response.error)}`);
    return response.result as ToolResult;
  }

  close() {
    this.socket.end();
  }
}

describe("K. MCP server (agent access + UI following)", () => {
  let client: McpClient;

  before(async () => {
    await waitForApp();
    await selectMainWindow();
    // MCP is **off by default**: switch it on (on a free port, so a dev instance
    // cannot collide) before connecting to the advertised endpoint.
    await invokeCore("set_mcp_config", { config: { enabled: true, port: 0 } });
    const info = await readInfo();
    client = await McpClient.open(info);
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
