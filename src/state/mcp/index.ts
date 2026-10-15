/**
 * MCP tool dispatch (M9).
 *
 * The Rust core owns the MCP server (protocol + transport; see
 * `src-tauri/src/mcp/`). For every `tools/call` it emits `mcp:request` to this
 * project window, which runs the tool here and answers through the `mcp_respond`
 * command. So the agent drives the **same** stores and commands the UI does — an
 * agent action is reflected in the live window, and the window's state is what the
 * agent observes. See `docs/mcp.md`.
 *
 * The tool catalog (names + schemas) lives in `src-tauri/src/mcp/tools/`; the
 * handlers below must cover exactly those names.
 */
export { initMcp } from "./bridge";
