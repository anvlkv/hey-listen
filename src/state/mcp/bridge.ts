import { invoke } from "../../lib/ipc";
import { listenThisWindow } from "../../lib/windowEvents";
import { asArgs } from "./args";
import { run } from "./dispatch";

/** The `mcp:request` payload the core sends. */
interface McpRequest {
  id: number;
  tool: string;
  arguments: unknown;
  /** The resolved project window label the call is routed to (multi-project). */
  target?: string;
}

/** Subscribe to tool calls from the MCP server. Call once per project window. */
export async function initMcp(): Promise<void> {
  try {
    await listenThisWindow<McpRequest>("mcp:request", (event) => {
      void handle(event.payload);
    });
    // Tell the core the listener is live, so forwarded calls are not attempted
    // before this window can answer them.
    await invoke("mcp_ready");
  } catch (err) {
    console.error("could not initialise the MCP bridge", err);
  }
}

/** Run one tool call and answer the core (never throw: always answer). */
async function handle(request: McpRequest): Promise<void> {
  try {
    const result = await run(request.tool, asArgs(request.arguments), request.target);
    await respond({ id: request.id, ok: true, result });
  } catch (err) {
    console.error(`MCP tool ${request.tool} failed`, err);
    await respond({ id: request.id, ok: false, error: String(err) });
  }
}

async function respond(payload: {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}): Promise<void> {
  try {
    await invoke("mcp_respond", payload);
  } catch (err) {
    console.error("could not answer the MCP server", err);
  }
}
