/**
 * S. Project UX fixes — empty-project discard, dropped projects, filter toggle.
 *
 * Three follow-ups from the multi-window hardening:
 *  - replacing a project that has no content must not ask "discard changes?";
 *  - dropping a `.heyl` file opens it as a project (not as an audio source);
 *  - the Filter switch lives in the Timeline toolbar, reads off while the graph is
 *    still the identity seed, and enabling it with no composed graph opens the filter
 *    view.
 *
 * One app instance is shared across spec files, so each case starts from File → New
 * (which resets the graphs and closes the tabs) rather than from whatever the previous
 * spec left behind.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEL, sidebarTool, tab } from "../support/selectors.ts";
import {
  click,
  closeAllTabs,
  count,
  emitEvent,
  menuAction,
  mockReturn,
  newEmptyProject,
  openFixture,
  restoreMocks,
  startInvokeCounts,
  takeInvokeCounts,
  textOf,
  timelineReadoutText,
  waitFor,
  waitForApp,
} from "../support/helpers.ts";
import {
  addPaletteNode,
  clearFilterGraph,
  filterSwitchOn,
  toggleFilter,
} from "../support/graph.ts";

describe("S. Project UX fixes", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    await mockReturn("confirm", true);
  });

  afterEach(async () => {
    await restoreMocks();
    await mockReturn("confirm", true);
  });

  it("S1 — replacing an empty project does not ask to discard changes", async () => {
    await newEmptyProject();

    // Opening a tab only changes the layout; with no source and pristine graphs the
    // project is still empty, so replacing it must not raise the discard dialog.
    await click(sidebarTool("filter"));
    await waitFor(async () => (await count(tab("filter"))) > 0, "the filter tab did not open");

    await startInvokeCounts();
    await menuAction("new");
    await waitFor(
      async () => (await count(tab("filter"))) === 0,
      "New Project did not run on the empty project",
    );

    const counts = await takeInvokeCounts();
    expect(counts.confirm ?? 0).toBe(0);
  });

  it("S2 — dropping a .heyl file opens that project", async () => {
    await newEmptyProject();
    await openFixture("sine440");

    const tmpFile = path.join(os.tmpdir(), `heylisten-drop-${Date.now()}.heyl`);
    await mockReturn("pick_project_save_path", tmpFile);
    await menuAction("saveAs");
    await waitFor(
      () => Promise.resolve(existsSync(tmpFile)),
      "the project file was never written to disk",
      20_000,
    );

    // Leave the saved project (dropping the *current* project path is a no-op, as with
    // File → Open) and load a different, unsaved source instead.
    await newEmptyProject();
    await openFixture("chirpNoise");

    // The native drag handler consumes HTML5 drags; drive the same Tauri event it emits.
    await emitEvent("tauri://drag-drop", {
      type: "drop",
      paths: [tmpFile],
      position: { x: 8, y: 8 },
    });

    await waitFor(
      async () => (await timelineReadoutText()).includes("0:02"),
      "dropping the .heyl file did not open its project",
    );
  });

  it("S3 — the Filter switch is in the Timeline toolbar and follows the graph", async () => {
    await newEmptyProject();
    await openFixture("sine440");
    await closeAllTabs();

    // One control, and it lives in the Timeline toolbar (not the app Toolbar).
    expect(await count(`.timeline-toolbar ${SEL.toolbarFilter}`)).toBe(1);
    expect(await count(`[data-testid="region.toolbar"] ${SEL.toolbarFilter}`)).toBe(0);

    // The seeded `Input → Output` graph is an identity pass-through: nothing to apply,
    // so the switch reads off even though filtering is not explicitly bypassed.
    expect(await filterSwitchOn()).toBe(false);
    expect(await count(tab("filter"))).toBe(0);

    // Enabling with no composed graph opens the filter view and leaves the switch off.
    await click(SEL.toolbarFilter);
    await waitFor(async () => (await count(tab("filter"))) > 0, "the filter view did not open");
    expect(await filterSwitchOn()).toBe(false);
    expect((await textOf(".timeline-filter-state")).trim()).toBe("off");

    // Composing a node makes the filter real, so the switch follows it on.
    await addPaletteNode("gain", "Gain");
    await waitFor(
      () => filterSwitchOn(),
      "the switch did not turn on after a filter node was composed",
    );

    await toggleFilter(); // → bypassed
    expect(await filterSwitchOn()).toBe(false);
    await toggleFilter(); // → applied again
    expect(await filterSwitchOn()).toBe(true);

    // Clearing back to the identity seed takes the switch off again.
    await clearFilterGraph();
    await waitFor(
      async () => !(await filterSwitchOn()),
      "clearing the graph did not take the filter switch off",
    );
  });
});
