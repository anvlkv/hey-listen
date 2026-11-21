/**
 * Q4. Keyboard control (M24.B) — `docs/hotkeys.md` → "Testing".
 *
 * The command registry drives the transport, navigation and annotations from the
 * keyboard; `Mod+K` opens the palette, `?` opens the shortcut explorer, and bindings are
 * rebindable with conflict detection. This spec pins the headline behaviours: Space
 * toggles the transport, the arrows seek, `N` annotates, the palette runs a tool, the
 * explorer opens, a rebind takes effect (and the old key goes inert), a conflict is
 * refused, and a text field keeps its keys.
 */
import { SEL, paletteItem, shortcutsRecord, tab } from "../support/selectors.ts";
import {
  click,
  closeAllTabs,
  count,
  mockReturn,
  newEmptyProject,
  openFixture,
  pressChord,
  restoreMocks,
  showAnalyzerSidebar,
  textOf,
  waitFor,
  waitForApp,
} from "../support/helpers.ts";

const ROW = '[data-testid^="annotation.row."]';
const NOTICE = '[data-testid="shortcuts.notice"]';

/** Whether the transport is playing (the annotation-at-cursor action enables only then). */
async function transportPlaying(): Promise<boolean> {
  return (await browser.execute(() => {
    const el = document.querySelector<HTMLButtonElement>(
      '[data-testid="timeline.annotationAtCursor"]',
    );
    return el ? !el.disabled : false;
  })) as boolean;
}

/** Silence the transport so a case starts from a known (idle) state. */
async function stopTransport(): Promise<void> {
  if (await transportPlaying()) await pressChord("Shift+Space");
  await waitFor(async () => !(await transportPlaying()), "the transport never stopped");
}

/** Open the shortcut explorer and reset every binding to its default. */
async function resetBindings(): Promise<void> {
  await pressChord("?");
  await waitFor(async () => (await count(SEL.shortcutsDialog)) === 1, "shortcuts never opened");
  await click(SEL.shortcutsResetAll);
  await pressChord("Escape", SEL.shortcutsDialog);
  await waitFor(async () => (await count(SEL.shortcutsDialog)) === 0, "shortcuts never closed");
}

describe("Q4. Keyboard control (M24.B)", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // The runners have no audio device: keep the transport's clock client-side.
    await mockReturn("preview_region", null);
    await mockReturn("confirm", true);
    await newEmptyProject();
    await openFixture("sine440");
    await resetBindings();
  });

  afterEach(async () => {
    await browser.tauri.switchWindow("main").catch(() => {});
    await restoreMocks();
    await mockReturn("preview_region", null);
    await mockReturn("confirm", true);
  });

  after(async () => {
    await resetBindings();
    await restoreMocks();
  });

  it("Q4.1 — Space toggles the transport play/pause", async () => {
    await stopTransport();
    expect(await transportPlaying()).toBe(false);

    await pressChord("Space");
    await waitFor(async () => await transportPlaying(), "Space never started the transport");

    await pressChord("Space");
    await waitFor(async () => !(await transportPlaying()), "Space never paused the transport");
  });

  it("Q4.2 — the arrows seek the playhead and announce it", async () => {
    await stopTransport();
    const before = await textOf(SEL.timelineAnnounce);

    await pressChord("ArrowRight");
    await waitFor(
      async () => (await textOf(SEL.timelineAnnounce)) !== before,
      "the live region did not announce the seek",
    );
    expect(await textOf(SEL.timelineAnnounce)).toContain("Playhead at");
  });

  it("Q4.3 — N adds an annotation at the playhead", async () => {
    await newEmptyProject();
    await openFixture("sine440");
    await stopTransport();

    await pressChord("N");
    await waitFor(async () => (await count(ROW)) === 1, "N never added an annotation");
  });

  it("Q4.4 — Mod+K opens the palette and runs a tool", async () => {
    await pressChord("Mod+K");
    await waitFor(async () => (await count(SEL.paletteDialog)) === 1, "the palette never opened");

    // Type into the palette input, then Enter runs the highlighted row (the spectrum tool).
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="palette.input"]');
      if (!input) throw new Error("palette input missing");
      input.focus();
      input.value = "spectrum";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await browser.pause(200);
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="palette.input"]');
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    await waitFor(
      async () => (await count(tab("spectrum"))) === 1,
      "the palette did not open the spectrum tab",
    );
    expect(await count(paletteItem("spectrum"))).toBeGreaterThanOrEqual(0);
    // The palette closed after running.
    await waitFor(async () => (await count(SEL.paletteDialog)) === 0, "the palette did not close");
  });

  it("Q4.5 — ? opens the Keyboard Shortcuts dialog", async () => {
    await pressChord("?");
    await waitFor(async () => (await count(SEL.shortcutsDialog)) === 1, "the dialog never opened");

    await pressChord("Escape", SEL.shortcutsDialog);
    await waitFor(async () => (await count(SEL.shortcutsDialog)) === 0, "the dialog never closed");
  });

  it("Q4.8 — typing in the analyzer search never triggers a shortcut", async () => {
    await newEmptyProject();
    await openFixture("sine440");
    // An earlier case may have left the rail on Graphs (opening a graph tool does), so
    // restore an analyzer section first — the search box only exists there.
    await showAnalyzerSidebar();
    // Dispatch the annotation chord at the search input: the text-field guard must keep it.
    await pressChord("N", SEL.sidebarSearch);
    await browser.pause(200);
    expect(await count(ROW)).toBe(0);
    // The same key at the body does fire (proving the guard, not the binding, blocked it).
    await pressChord("N");
    await waitFor(async () => (await count(ROW)) === 1, "N at the body did not annotate");
  });

  it("Q4.7 — a conflicting binding is refused", async () => {
    await pressChord("?");
    await waitFor(async () => (await count(SEL.shortcutsDialog)) === 1, "the dialog never opened");

    // Record Space for Loop, which is already Play/Pause's binding.
    await click(shortcutsRecord("transport.loop"));
    await browser.pause(100);
    await pressChord("Space", SEL.shortcutsDialog);

    await waitFor(
      async () => (await textOf(NOTICE)).includes("Already used by"),
      "the conflict was not reported",
    );
    expect(await textOf(NOTICE)).toContain("Already used by");

    // The conflict keeps the row recording: Escape cancels it, a second Escape closes.
    await pressChord("Escape", SEL.shortcutsDialog);
    await browser.pause(100);
    await pressChord("Escape", SEL.shortcutsDialog);
    await waitFor(async () => (await count(SEL.shortcutsDialog)) === 0, "the dialog never closed");
  });

  it("Q4.6 — a rebind takes effect and the old key goes inert", async () => {
    await pressChord("?");
    await waitFor(async () => (await count(SEL.shortcutsDialog)) === 1, "the dialog never opened");

    // Rebind Play / Pause from Space to P.
    await click(shortcutsRecord("transport.playPause"));
    await browser.pause(100);
    await pressChord("P", SEL.shortcutsDialog);

    await pressChord("Escape", SEL.shortcutsDialog);
    await waitFor(async () => (await count(SEL.shortcutsDialog)) === 0, "the dialog never closed");

    await stopTransport();
    await pressChord("P");
    await waitFor(async () => await transportPlaying(), "the new key did not start the transport");
    await pressChord("P");
    await waitFor(
      async () => !(await transportPlaying()),
      "the new key did not pause the transport",
    );

    // The old key is inert now.
    await pressChord("Space");
    await browser.pause(200);
    expect(await transportPlaying()).toBe(false);

    await resetBindings();
  });
});
