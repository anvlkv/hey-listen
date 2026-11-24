/**
 * B6–B9. Source storage (M42).
 *
 * A file source is stored **embedded**, **linked**, or **live-linked**. The post-pick
 * chooser is the only place a link can be chosen — the panel refuses to leave `embedded`
 * without a fresh read — and a linked project keeps only the path, so reopening it
 * decodes the file again. A live link also reloads the timeline in place when the file
 * is rewritten behind the app.
 */
import { copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEL } from "../support/selectors.ts";
import { FIXTURES } from "../support/fixtures.ts";
import { projectSessionHooks } from "../support/session.ts";
import {
  waitFor,
  count,
  textOf,
  click,
  mockReturn,
  menuAction,
  ensureSourcePanel,
  prepareFilePicker,
  waitForSourceLoaded,
  timelineReadoutText,
  invokeCore,
} from "../support/helpers.ts";

/** The mode whose card is marked selected in the group with `prefix`. */
async function selectedCard(prefix: string): Promise<string | null> {
  return (await browser.execute((group) => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid^="${group}."]`));
    const selected = cards.find((card) => card.className.includes("storage-card-selected"));
    return selected?.getAttribute("data-testid")?.slice(group.length + 1) ?? null;
  }, prefix)) as string | null;
}

/** The hint under `mode`'s card when it is disabled, or `null` when it can be picked. */
async function blockedReason(prefix: string, mode: string): Promise<string | null> {
  return (await browser.execute(
    (group, value) => {
      const card = document.querySelector<HTMLElement>(`[data-testid="${group}.${value}"]`);
      if (!card || !card.className.includes("storage-card-disabled")) return null;
      return card.querySelector(".storage-card-blocked")?.textContent?.trim() ?? "";
    },
    prefix,
    mode,
  )) as string | null;
}

/** The Source panel's storage badge (`""` while the panel is closed). */
async function storageBadge(): Promise<string> {
  return (await textOf(SEL.sourceStorageBadge)).trim();
}

describe("B6–B9. Source storage", () => {
  // The app instance outlives a spec file in a worker, so start from a clean shell (no
  // tabs from an earlier spec, the replace prompt stubbed).
  projectSessionHooks();

  it("B6 — the picker asks where the audio lives before it loads", async () => {
    await prepareFilePicker();
    await mockReturn("pick_audio_file", FIXTURES.sine440);
    await click(SEL.sourceOpenFile);
    await waitFor(
      async () => (await count(SEL.storageDialog)) > 0,
      "the storage chooser never opened",
    );
    // The chooser starts on the remembered mode. Pick it explicitly so the run does not
    // depend on what an earlier session stored (the chooser is the product's only link
    // entry point, and confirming it is what persists the choice).
    await click(SEL.storageDialogEmbedded);
    await waitFor(
      async () => (await selectedCard("storage.dialog.mode")) === "embedded",
      "the chooser did not select Embedded",
    );

    await click(SEL.storageDialogOpen);
    await waitForSourceLoaded();
    await ensureSourcePanel();
    await waitFor(
      async () => (await count(SEL.sourceSummary)) > 0,
      "the source summary never appeared in the panel",
    );
    await waitFor(
      async () => (await storageBadge()) === "Embedded",
      "the source badge never settled on Embedded",
    );
    // Opening a file sets no capture error: a stale one would sit beside the summary.
    expect(await textOf(SEL.sourceError)).toBe("");
  });

  it("B7 — an embedded source cannot become a link in the panel", async () => {
    await ensureSourcePanel();
    // Both link modes assert that the file on disk is the project's audio, so both need
    // a fresh read; freezing back to embedded is always available.
    expect(await blockedReason("source.storage", "linked")).toContain("Replace the source");
    expect(await blockedReason("source.storage", "liveLink")).toContain("Replace the source");
    expect(await blockedReason("source.storage", "embedded")).toBeNull();
  });

  it("B8 — a linked source survives a save and reopens by decoding the file", async () => {
    await prepareFilePicker();
    await mockReturn("pick_audio_file", FIXTURES.chirpNoise);
    await click(SEL.sourceOpenFile);
    await waitFor(
      async () => (await count(SEL.storageDialog)) > 0,
      "the storage chooser never opened",
    );
    await click(SEL.storageDialogLinked);
    await waitFor(
      async () => (await selectedCard("storage.dialog.mode")) === "linked",
      "the chooser did not select Linked",
    );
    await click(SEL.storageDialogOpen);
    await waitForSourceLoaded();
    await ensureSourcePanel();
    await waitFor(
      async () => (await count(SEL.sourceSummary)) > 0,
      "the source summary never appeared in the panel",
    );
    await waitFor(
      async () => (await storageBadge()) === "Linked",
      "the source badge never settled on Linked",
    );

    const file = path.join(os.tmpdir(), `heylisten-storage-${Date.now()}.heyl`);
    await mockReturn("pick_project_save_path", file);
    await menuAction("saveAs");
    await waitFor(
      () => Promise.resolve(existsSync(file)),
      "the project file was never written to disk",
      20_000,
    );

    // The link resolves, and the mode the file records is the one the panel showed.
    const check = await invokeCore<{ storage: string; exists: boolean }>("source_link_check");
    expect(check.storage).toBe("linked");
    expect(check.exists).toBe(true);

    // Reopening decodes the linked file again: the mode and the source come back.
    await mockReturn("pick_project_open_path", file);
    await menuAction("open");
    await waitForSourceLoaded();
    await ensureSourcePanel();
    await waitFor(
      async () => (await storageBadge()) === "Linked",
      "the reopened project lost its link",
      20_000,
    );
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:03"),
      "the reopened project did not decode the linked file",
      20_000,
    );
  });

  it("B9 — a live link reloads the timeline when the file is rewritten", async () => {
    await prepareFilePicker();
    const live = path.join(os.tmpdir(), `heylisten-live-${Date.now()}.wav`);
    await copyFile(FIXTURES.sine440, live);

    await mockReturn("pick_audio_file", live);
    await click(SEL.sourceOpenFile);
    await waitFor(
      async () => (await count(SEL.storageDialog)) > 0,
      "the storage chooser never opened",
    );
    await click(SEL.storageDialogLiveLink);
    await click(SEL.storageDialogOpen);
    await waitForSourceLoaded();
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:02"),
      "the live-linked tone never loaded",
    );

    // Rewrite the file behind the app: the core's watcher reports it and the frontend
    // re-reads it in place, so the timeline takes the new length.
    await copyFile(FIXTURES.chirpNoise, live);
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:03"),
      "the live link never reloaded the rewritten file",
      30_000,
    );

    await rm(live, { force: true });
  });
});
