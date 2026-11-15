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
    // Tool calls mutate shared stores (window, params, tabs, annotations). Run them one at a
    // time so a parallel batch (e.g. several `open_tool` calls) cannot interleave and
    // answer from a half-applied state; `handle` never throws, so the chain survives a
    // failed tool.
    let queue: Promise<void> = Promise.resolve();
    await listenThisWindow<McpRequest>("mcp:request", (event) => {
      // Confirm receipt **before** running the tool: the core only holds a call while it
      // knows the window is on it, so a cold-starting window fails the call fast instead
      // of leaving the agent waiting until its own request timeout kills the bridge.
      void acknowledge(event.payload.id);
      queue = queue.then(() => handle(event.payload));
    });
    // Tell the core the listener is live, so forwarded calls are not attempted
    // before this window can answer them.
    await invoke("mcp_ready");
  } catch (err) {
    console.error("could not initialise the MCP bridge", err);
  }
}

/** Tell the core the window has this call in hand (a no-op once the call gave up). */
async function acknowledge(id: number): Promise<void> {
  try {
    await invoke("mcp_ack", { id });
  } catch (err) {
    // The call may already have failed fast; the core ignores an unknown id.
    console.error("could not acknowledge the MCP call", err);
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
