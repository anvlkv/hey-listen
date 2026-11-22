/**
 * The MCP client the agent-facing specs share (M9, M39).
 *
 * The app hosts the MCP server on a loopback port (advertised in the
 * `mcp-settings.json` store under the app data dir, key `boundPort`); the
 * `heylisten-mcp` bridge is a stdio ⇄ socket pump. These helpers speak MCP to that
 * endpoint directly from Node (no bridge), driving the **running** app: an agent call
 * opens a source / a Workbench tab in the live window (UI following), and `get_state`
 * reports what the window is showing.
 *
 * `k-mcp` proves the control surface; `s4-graph-dot` reuses this client for the DOT
 * interchange (`list_nodes` / `get_node` / `get_graph` / `set_filter_graph` /
 * `render_synth`). One copy, because two would drift.
 */
import { connect, type Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

import { invokeCore, selectMainWindow, waitForApp } from "./helpers.ts";

/** The endpoint the running app advertises (`src-tauri/src/mcp/advertise.rs`). */
export interface ServerInfo {
  /** The loopback port the MCP server is bound to (store key `boundPort`). */
  boundPort: number;
}

/** The protocol greeting the bridge sends (`mcp::HELLO`) — a protocol marker, not a secret. */
const HELLO = "heylisten-mcp/1";

/** The shape of an MCP `tools/call` result. */
export interface ToolResult {
  content: { type: string; text: string }[];
  isError: boolean;
  structuredContent?: Record<string, unknown>;
}

/** The app's `mcp-settings.json` store path (mirrors `advertise::store_path`). */
function storePath(): string {
  const override = process.env.HEYLISTEN_MCP_SETTINGS;
  if (override) return override;
  const identifier = "com.anvlkv.heylisten";
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", identifier, "mcp-settings.json");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? homedir(), identifier, "mcp-settings.json");
  }
  const base = process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share");
  return path.join(base, identifier, "mcp-settings.json");
}

/** Wait for the app to advertise its MCP endpoint, then read it. */
async function readInfo(): Promise<ServerInfo> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const store = JSON.parse(await readFile(storePath(), "utf8")) as { boundPort?: number };
      if (typeof store.boundPort === "number" && store.boundPort > 0) {
        return { boundPort: store.boundPort };
      }
      lastError = new Error("the store has no boundPort yet");
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`the app never advertised its MCP endpoint: ${String(lastError)}`);
}

/** A minimal newline-delimited JSON-RPC client over the app's MCP socket. */
export class McpClient {
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
      const connection = connect({ host: "127.0.0.1", port: info.boundPort }, () =>
        resolve(connection),
      );
      connection.once("error", reject);
    });
    // The protocol greeting is the connection's first line (no token any more).
    socket.write(`${HELLO}\n`);
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

/**
 * Turn MCP on (on a free port, so a dev instance cannot collide), connect to the
 * advertised endpoint, and hand back a client. MCP is **off by default**.
 */
export async function openMcp(): Promise<McpClient> {
  await waitForApp();
  await selectMainWindow();
  await invokeCore("set_mcp_config", { config: { enabled: true, port: 0 } });
  return McpClient.open(await readInfo());
}
