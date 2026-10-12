import { invoke } from "../lib/ipc";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createSignal } from "solid-js";
import type { McpStatus } from "../bindings/McpStatus";

/**
 * MCP control surface (M9 follow-up).
 *
 * The Rust core owns the MCP server, its port, and the persisted settings; this
 * module is a thin view over the `get_mcp_status` / `set_mcp_config` commands (which
 * are the only writer), plus a `writeText` helper for the copyable config snippet.
 * The plugin store has no cross-instance sync, so keeping the core authoritative —
 * and the popover a view — avoids diverging copies. See `docs/mcp.md`.
 */

/** The default port shown when nothing is configured (mirrors `mcp::DEFAULT_PORT`). */
export const DEFAULT_MCP_PORT = 47100;

/** Which entry point a config snippet points at. */
export type McpEntry = "app" | "bridge";

export const [mcpStatus, setMcpStatus] = createSignal<McpStatus | null>(null);
/** True while a `set_mcp_config` round-trip is in flight (disables the controls). */
export const [mcpBusy, setMcpBusy] = createSignal(false);

/** Pull the current MCP status from the core. */
export async function refreshMcpStatus(): Promise<void> {
  try {
    setMcpStatus(await invoke<McpStatus>("get_mcp_status"));
  } catch (err) {
    console.error("could not read the MCP status", err);
  }
}

/** Toggle the server on/off, keeping the configured port. */
export async function setMcpEnabled(enabled: boolean): Promise<void> {
  await applyMcpConfig({ enabled, port: mcpStatus()?.port ?? DEFAULT_MCP_PORT });
}

/** Set the port, keeping the enabled state. */
export async function setMcpPort(port: number): Promise<void> {
  await applyMcpConfig({ enabled: mcpStatus()?.enabled ?? false, port });
}

async function applyMcpConfig(config: { enabled: boolean; port: number }): Promise<void> {
  setMcpBusy(true);
  try {
    setMcpStatus(await invoke<McpStatus>("set_mcp_config", { config }));
  } catch (err) {
    console.error("could not update the MCP config", err);
  } finally {
    setMcpBusy(false);
  }
}

/** Write text to the system clipboard (via the plugin, not WKWebView's flaky API). */
export async function copyText(text: string): Promise<void> {
  await writeText(text);
}

/** The endpoint shown in the status line, or `null` when not listening. */
export function mcpEndpoint(status: McpStatus): string | null {
  const port = mcpEffectivePort(status);
  return status.listening && port ? `127.0.0.1:${port}` : null;
}

/**
 * The port actually in effect: the **bound** port while listening (which can differ
 * from the configured one after a free-port fallback, or when the configured port is
 * `0`/auto), else the configured port, else the default.
 *
 * Both the status line and the port field read this, so the field never disagrees
 * with what is listening (e.g. configured `0` but bound `51640`).
 */
export function mcpEffectivePort(status: McpStatus): number {
  return status.boundPort ?? (status.port || DEFAULT_MCP_PORT);
}

/** A ready-to-paste MCP-client config snippet for one of the two entry points. */
export function mcpSnippet(status: McpStatus, entry: McpEntry): string {
  const command = (entry === "bridge" ? status.bridgeBinary : status.appBinary) ?? "";
  const args = entry === "bridge" ? [] : ["--mcp"];
  return JSON.stringify({ mcpServers: { "hey-listen": { command, args } } }, null, 2);
}
