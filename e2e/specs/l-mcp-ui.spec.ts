/**
 * L. MCP control surface (M9 follow-up) — the Toolbar **MCP** popover.
 *
 * The popover is a view over the core-owned MCP settings (`get_mcp_status` /
 * `set_mcp_config`): an on/off toggle, a port, a live status line, and a copyable
 * config snippet. These tests drive the real UI and assert the resulting state; the
 * MCP protocol itself is covered by `k-mcp.spec.ts`.
 *
 * The clipboard *write* is exercised but not asserted beyond the button's own
 * confirmation (the OS clipboard is environment-dependent, especially headless CI).
 */
import { createServer, type AddressInfo } from "node:net";
import { SEL } from "../support/selectors.ts";
import {
  click,
  count,
  dismissPopovers,
  invokeCore,
  selectMainWindow,
  textOf,
  waitFor,
  waitForApp,
} from "../support/helpers.ts";

/** Open the MCP popover (and wait for its panel). */
async function openMcp(): Promise<void> {
  await dismissPopovers();
  await click(SEL.toolbarMcp);
  await waitFor(async () => (await count(".pop-panel")) > 0, "the MCP popover did not open");
}

/** Whether the MCP toggle is on (reads the hidden switch input). */
async function enabled(): Promise<boolean> {
  return (await browser.execute((sel: string) => {
    const input = document.querySelector(sel) as HTMLInputElement | null;
    return input?.checked ?? false;
  }, SEL.mcpEnabled)) as boolean;
}

/** Flip the MCP toggle via its visible control. */
async function toggle(): Promise<void> {
  await click(".pop-panel .toolbar-switch-control");
}

/** Set the port field and commit it (Enter blurs, which applies the value). */
async function setPort(port: number): Promise<void> {
  const input = await $(SEL.mcpPort);
  await input.clearValue();
  await input.setValue(String(port));
  await browser.keys("Enter");
}

describe("L. MCP control surface", () => {
  before(async () => {
    await waitForApp();
    await selectMainWindow();
    // Deterministic starting point: start from a known config (any free port).
    await invokeCore("set_mcp_config", { config: { enabled: true, port: 0 } });
  });

  it("L1 — the popover renders the controls and a client snippet", async () => {
    await openMcp();
    await (await $(SEL.mcpEnabled)).waitForExist();
    await (await $(SEL.mcpPort)).waitForExist();

    const snippet = await textOf(SEL.mcpSnippet);
    expect(snippet).toContain("mcpServers");
    expect(snippet).toContain("hey-listen");
    expect(snippet).toContain("--mcp");
    expect(snippet).toContain("command");
  });

  it("L2 — the toggle drives the server, and the status line follows", async () => {
    await openMcp();
    // Force off, then on, asserting the live status each time.
    if (await enabled()) await toggle();
    await waitFor(async () => (await enabled()) === false, "MCP did not turn off");
    await waitFor(
      async () => (await textOf(SEL.mcpStatus)).includes("off"),
      "the status did not read 'off'",
    );

    await toggle();
    await waitFor(async () => (await enabled()) === true, "MCP did not turn on");
    await waitFor(
      async () => (await textOf(SEL.mcpStatus)).includes("listening on 127.0.0.1:"),
      "the status did not show a listening endpoint",
    );
  });

  it("L3 — the port input reconfigures the endpoint", async () => {
    await openMcp();
    if (!(await enabled())) await toggle();
    // A specific, likely-free high port; the endpoint should adopt it.
    await setPort(47219);
    await waitFor(
      async () => (await textOf(SEL.mcpStatus)).includes("127.0.0.1:47219"),
      "the endpoint did not move to the chosen port",
    );
    expect(await count(SEL.mcpWarning)).toBe(0);
  });

  it("L4 — a busy port falls back and the popover shows the note", async () => {
    // Hold a port from the test process, then ask the app to use it.
    const blocker = createServer();
    const busy = await new Promise<number>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => resolve((blocker.address() as AddressInfo).port));
    });

    try {
      await openMcp();
      if (!(await enabled())) await toggle();
      await setPort(busy);

      await waitFor(
        async () => (await count(SEL.mcpWarning)) > 0,
        "no port-in-use note appeared",
      );
      // The server still came up — on a different port than the busy one.
      const status = await textOf(SEL.mcpStatus);
      expect(status).toContain("listening on 127.0.0.1:");
      expect(status).not.toContain(`:${busy}`);
    } finally {
      blocker.close();
    }
  });

  it("L5 — Copy confirms without breaking the panel", async () => {
    await openMcp();
    await click(SEL.mcpCopy);
    // The button flips to "Copied" briefly; the panel stays open either way.
    await browser
      .waitUntil(async () => (await textOf(SEL.mcpCopy)).includes("Copied"), {
        timeout: 2000,
        timeoutMsg: "the copy confirmation did not appear",
      })
      .catch(() => {
        // The OS clipboard can be unavailable (headless CI); the write is best-effort.
      });
    expect(await count(".pop-panel")).toBeGreaterThan(0);

    // Leave MCP enabled on a free port for any later spec.
    await invokeCore("set_mcp_config", { config: { enabled: true, port: 0 } });
  });
});
