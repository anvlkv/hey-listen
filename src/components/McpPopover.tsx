import { createEffect, createSignal, Show } from "solid-js";
import { Switch } from "@kobalte/core/switch";
import Button from "./Button";
import Icon from "./Icon";
import Popover from "./Popover";
import Tooltip from "./Tooltip";
import {
  DEFAULT_MCP_PORT,
  copyText,
  mcpBusy,
  mcpEffectivePort,
  mcpEndpoint,
  mcpSnippet,
  mcpStatus,
  refreshMcpStatus,
  setMcpEnabled,
  setMcpPort,
  type McpEntry,
} from "../state/mcpSettings";

/**
 * The Toolbar **MCP** popover: the in-app control surface for the MCP server.
 *
 * Toggle it on/off (default off), pick the loopback port, watch a live status line,
 * and copy a ready-to-paste config snippet for an MCP client. The core owns the state
 * (see `src/state/mcpSettings.ts`); this is just a view. See `docs/mcp.md`.
 */
export default function McpPopover() {
  // The port field is edited locally and committed on blur / Enter, so typing does
  // not rebind the server on every keystroke.
  const [portDraft, setPortDraft] = createSignal("");
  const [entry, setEntry] = createSignal<McpEntry>("app");
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: number | undefined;
  let portInput!: HTMLInputElement;

  const status = () => mcpStatus();
  // The port in effect, so the field agrees with the status line: while listening
  // that is the *bound* port (the configured one may be 0/auto or have fallen back).
  const port = () => {
    const current = status();
    return current ? mcpEffectivePort(current) : DEFAULT_MCP_PORT;
  };
  const endpoint = () => {
    const current = status();
    return current ? mcpEndpoint(current) : null;
  };

  // Keep the port field in step with the core unless the user is editing it.
  createEffect(() => {
    const current = status();
    if (!current) return;
    if (document.activeElement !== portInput) setPortDraft(String(mcpEffectivePort(current)));
  });

  function open() {
    void refreshMcpStatus();
    setPortDraft(String(port()));
  }

  async function commitPort(raw: string) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      setPortDraft(String(port())); // reject and restore
      return;
    }
    setPortDraft(String(parsed));
    if (parsed !== port()) await setMcpPort(parsed);
  }

  async function copy() {
    const current = status();
    if (!current) return;
    try {
      await copyText(mcpSnippet(current, entry()));
      setCopied(true);
      if (copiedTimer != null) clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.error("could not copy the MCP config", err);
    }
  }

  return (
    <Popover
      label="MCP"
      title="Model Context Protocol server (let an AI agent drive the app)"
      icon="plug"
      testid="toolbar.mcp"
      onOpen={open}
    >
      <div class="params-form mcp-panel">
        <div class="params-heading">MCP server</div>

        <div class="params-field">
          <span class="params-label">Enabled</span>
          <Tooltip label="Serve Hey Listen as MCP tools on a loopback port">
            <Switch
              class="toolbar-switch"
              checked={status()?.enabled ?? false}
              disabled={mcpBusy()}
              onChange={(enabled) => void setMcpEnabled(enabled)}
            >
              <Switch.Input class="toolbar-switch-input" data-testid="mcp.enabled" />
              <Switch.Control class="toolbar-switch-control">
                <Switch.Thumb class="toolbar-switch-thumb" />
              </Switch.Control>
            </Switch>
          </Tooltip>
        </div>

        <div class="params-field">
          <span class="params-label">Port</span>
          <input
            ref={portInput}
            class="mcp-port"
            type="number"
            min="1"
            max="65535"
            data-testid="mcp.port"
            value={portDraft()}
            disabled={mcpBusy()}
            onInput={(event) => setPortDraft(event.currentTarget.value)}
            onBlur={(event) => void commitPort(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>

        <div class="mcp-status" data-testid="mcp.status">
          <span
            class="mcp-dot"
            classList={{ "mcp-dot-on": endpoint() != null }}
            aria-hidden="true"
          />
          <Show when={endpoint()} fallback={<span>{status()?.enabled ? "not listening" : "off"}</span>}>
            {(value) => <span>listening on {value()}</span>}
          </Show>
        </div>

        <Show when={status()?.warning}>
          <div class="mcp-note" data-testid="mcp.warning">
            {status()!.warning}
          </div>
        </Show>
        <Show when={status()?.error}>
          <div class="mcp-error" data-testid="mcp.error">
            {status()!.error}
          </div>
        </Show>

        <div class="params-heading">Client config</div>
        <Show when={status()?.bridgeBinary}>
          <div class="mcp-entry">
            <Button
              class="toolbar-btn"
              aria-pressed={entry() === "app"}
              onClick={() => setEntry("app")}
            >
              App binary
            </Button>
            <Button
              class="toolbar-btn"
              aria-pressed={entry() === "bridge"}
              onClick={() => setEntry("bridge")}
            >
              heylisten-mcp
            </Button>
          </div>
        </Show>
        <pre class="mcp-snippet" data-testid="mcp.snippet">
          {status() ? mcpSnippet(status()!, entry()) : ""}
        </pre>
        <Button
          class="toolbar-btn icon-label"
          disabled={!status()}
          onClick={() => void copy()}
          data-testid="mcp.copy"
        >
          <Icon name={copied() ? "check" : "copy"} />
          {copied() ? "Copied" : "Copy"}
        </Button>
        <p class="params-note">
          Add this to your MCP client's settings file. The app entry needs Hey Listen
          running (it drives the live project); the <code>heylisten-mcp</code> entry
          works standalone (headless when no app is running).
        </p>
      </div>
    </Popover>
  );
}
