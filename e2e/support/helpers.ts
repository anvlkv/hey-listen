import { SEL, analyzerPanel, sidebarTool, tab } from "./selectors.ts";
import { FIXTURES } from "./fixtures.ts";

/**
 * Shared E2E helpers (M8): app lifecycle, driving the Workbench/Source, reading
 * analyzer results, and the small set of IPC affordances the suite needs (mocking
 * a native dialog, forcing an error path, emitting a menu action). See
 * `docs/testing.md`.
 *
 * Two practical rules learned against the system WebView, applied throughout:
 *  - **One app instance per run**, so a helper that swaps the source must tolerate a
 *    source already existing (it reveals the Source panel and auto-answers the
 *    core's replace-confirm prompt).
 *  - **Prefer `browser.execute` DOM reads to element handles inside `waitUntil`
 *    polls** — element-handle commands occasionally stall in WKWebView, so `count`,
 *    `countWithin`, clicks and readouts are done in-page.
 */

// --- app lifecycle ---------------------------------------------------------

/**
 * Wait until the shell has rendered (the fixed regions are present).
 *
 * The app instance is launched **once for the whole run** and reused across spec
 * files, so a spec that leaves a popout window focused (J2) would otherwise leave the
 * *next* session pointed at that popout — which renders no Workbench. Switch to the
 * `main` window first so every spec starts on the project window.
 */
export async function waitForApp(): Promise<void> {
  await selectMainWindow();
  try {
    await browser.waitUntil(async () => (await count(SEL.workbench)) > 0, {
      timeoutMsg: "the app shell did not render",
    });
  } catch (err) {
    // A bare timeout says nothing about *why*: report what the window actually shows
    // (a partially mounted app is a very different bug from an empty document), and
    // let the app's own `[startup]` logs — which `src/boot.ts` sends to the log file
    // and, under the suite, to this run's frontend log — carry the error itself.
    throw new Error(`${(err as Error).message}\n${await describeWindow()}`);
  }
}

/** What the window currently shows, for a failure message (best-effort). */
async function describeWindow(): Promise<string> {
  try {
    const shown = await browser.execute(() => ({
      href: location.href,
      readyState: document.readyState,
      rootChildren: document.getElementById("root")?.childElementCount ?? -1,
      testIds: Array.from(document.querySelectorAll("[data-testid]")).map((el) =>
        el.getAttribute("data-testid"),
      ),
      body: document.body?.innerHTML?.slice(0, 600) ?? "",
    }));
    return `window: ${JSON.stringify(shown, null, 2)}`;
  } catch (err) {
    return `window: unavailable (${String(err)})`;
  }
}

/** The release binary launches a "main" window; make sure it is the active one. */
export async function selectMainWindow(): Promise<void> {
  await browser.tauri.switchWindow("main").catch(() => {});
}

// --- raw DOM helpers (avoid element-handle stalls) -------------------------

/** Count elements matching a selector via a raw DOM read. */
export async function count(selector: string): Promise<number> {
  return (await browser.execute(
    (sel: string) => document.querySelectorAll(sel).length,
    selector,
  )) as number;
}

/** Like [`count`], scoped to descendants of `scopeSelector`. */
export async function countWithin(scopeSelector: string, selector: string): Promise<number> {
  return (await browser.execute(
    (scope: string, sel: string) => {
      const root = document.querySelector(scope);
      return root ? root.querySelectorAll(sel).length : 0;
    },
    scopeSelector,
    selector,
  )) as number;
}

/** The text content of the first element matching `selector` (`""` if absent). */
export async function textOf(selector: string): Promise<string> {
  return (await browser.execute(
    (sel: string) => document.querySelector(sel)?.textContent ?? "",
    selector,
  )) as string;
}

/** Click the first element matching `selector` (in-page, no element handle). */
export async function click(selector: string): Promise<void> {
  await browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`no element for ${sel}`);
    el.click();
  }, selector);
}

/** Poll until `selector` matches at least one element. */
async function waitForSelector(selector: string, timeoutMsg: string, timeout = 15_000) {
  await browser.waitUntil(async () => (await count(selector)) > 0, { timeout, timeoutMsg });
}

// --- Workbench tabs --------------------------------------------------------

/** Open a tool from the Sidebar (or focus it if already open). */
export async function openTool(id: string): Promise<void> {
  await waitForSelector(sidebarTool(id), `the sidebar entry for "${id}" is missing`);
  const entry = await $(sidebarTool(id));
  await entry.click();
  try {
    await waitForTab(id, 8_000);
  } catch {
    // A first click can be swallowed while a portal/overlay settles; retry in-page.
    await click(sidebarTool(id));
    await waitForTab(id);
  }
}

/** Focus an already-open tool's tab (dockview unmounts hidden panels, so this
 * re-mounts its content). */
export async function activateTab(id: string): Promise<void> {
  await waitForTab(id);
  await click(tab(id));
}

/** Close a tool's dockview tab (via the tab's close button). */
export async function closeTool(id: string): Promise<void> {
  await browser.execute((sel: string) => {
    const el = document.querySelector(sel);
    const button = el?.querySelector(".dv-default-tab-action") as HTMLElement | null;
    button?.click();
  }, tab(id));
}

/** Close every open Workbench tab (used to reset between spec files). */
export async function closeAllTabs(): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    const remaining = await count(".dv-default-tab-action");
    if (remaining === 0) return;
    await browser.execute(() => {
      document
        .querySelectorAll(".dv-default-tab-action")
        .forEach((button) => (button as HTMLElement).click());
    });
    await browser.pause(150);
  }
}

/** The title text of every open Workbench tab. */
export async function openTabTitles(): Promise<string[]> {
  return (await browser.execute(() =>
    Array.from(document.querySelectorAll(".dv-tab")).map((t) =>
      (t.textContent ?? "").replace(/[\s\u00d7]+$/, "").trim(),
    ),
  )) as string[];
}

/** Wait until a tool's tab exists (stamped with `data-testid="tab.<id>"`). */
export async function waitForTab(id: string, timeout = 15_000): Promise<void> {
  await browser.waitUntil(async () => (await count(tab(id))) > 0, {
    timeout,
    timeoutMsg: `tab for "${id}" did not open`,
  });
}

/** True when a tool's tab is open. */
export async function isToolOpen(id: string): Promise<boolean> {
  return (await count(tab(id))) > 0;
}

// --- Analyzer results ------------------------------------------------------

/** Wait until an analyzer has a rendered result (or surfaced an error). */
export async function waitForAnalyzer(id: string, timeout = 60_000): Promise<void> {
  const scope = analyzerPanel(id);
  await browser.waitUntil(
    async () => {
      if ((await count(scope)) === 0) return false;
      if ((await countWithin(scope, ".analyzer-error")) > 0) return true;
      if ((await countWithin(scope, '[data-testid="analyzer.busy"]')) > 0) return false;
      const empty = await countWithin(scope, ".analyzer-empty");
      const canvas = await countWithin(scope, "canvas");
      const readouts = await countWithin(scope, ".readout-value");
      return empty === 0 && (canvas > 0 || readouts > 0);
    },
    { timeout, timeoutMsg: `analyzer "${id}" never rendered a result` },
  );
}

/** Wait until a readout-only analyzer renders its `.readout-card` values. */
export async function waitForReadouts(id: string, timeout = 60_000): Promise<void> {
  const scope = analyzerPanel(id);
  await browser.waitUntil(
    async () => {
      if ((await count(scope)) === 0) return false;
      if ((await countWithin(scope, '[data-testid="analyzer.busy"]')) > 0) return false;
      return (await countWithin(scope, ".readout-card-value")) > 0;
    },
    { timeout, timeoutMsg: `analyzer "${id}" never rendered its readouts` },
  );
}

/** The current value of a labeled readout inside an analyzer panel. */
export async function readoutValue(id: string, label: string): Promise<string | null> {
  return (await browser.execute(
    (scope: string, wanted: string) => {
      const root = document.querySelector(scope);
      if (!root) return null;
      for (const r of Array.from(root.querySelectorAll(".readout"))) {
        const name = r.querySelector(".readout-label")?.textContent?.trim();
        if (name === wanted) return r.querySelector(".readout-value")?.textContent?.trim() ?? null;
      }
      return null;
    },
    analyzerPanel(id),
    label,
  )) as string | null;
}

/** The value of a labeled readout card (levels, tempo, loudness…) inside a panel. */
export async function cardValue(id: string, label: string): Promise<string | null> {
  return (await browser.execute(
    (scope: string, wanted: string) => {
      const root = document.querySelector(scope);
      if (!root) return null;
      for (const c of Array.from(root.querySelectorAll(".readout-card"))) {
        const name = c.querySelector(".readout-card-label")?.textContent?.trim();
        if (name === wanted)
          return c.querySelector(".readout-card-value")?.textContent?.trim() ?? null;
      }
      return null;
    },
    analyzerPanel(id),
    label,
  )) as string | null;
}

/**
 * True when a canvas (scoped to `scope` when given) has drawn something over its
 * own background — the "renders non-empty" check the smoke tests use.
 */
export async function canvasHasInk(selector: string): Promise<boolean> {
  return (await browser.execute((sel: string) => {
    const c = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!c) return false;
    const ctx = c.getContext("2d");
    if (!ctx || c.width === 0 || c.height === 0) return false;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const r0 = data[0];
    const g0 = data[1];
    const b0 = data[2];
    for (let i = 4; i < data.length; i += 4) {
      if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) return true;
    }
    return false;
  }, selector)) as boolean;
}

// --- Source --------------------------------------------------------------

/** The Timeline window readout text (e.g. `0:00.00 – 0:02.00 …`). */
export async function timelineReadoutText(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/**
 * Make the Source panel reachable: once a source exists the panel is hidden behind
 * the Timeline's *Replace…* button, so click it when the panel is absent.
 */
export async function ensureSourcePanel(): Promise<void> {
  if ((await count(SEL.source)) > 0) return;
  if ((await count(SEL.timelineReplace)) > 0) await click(SEL.timelineReplace);
  await browser.waitUntil(async () => (await count(SEL.source)) > 0, {
    timeoutMsg: "the source panel did not open",
  });
}

/** Open a file source by mocking the native picker, then clicking *Open*. */
export async function openFileFixture(path: string): Promise<void> {
  await ensureSourcePanel();
  // A prior test may have switched the kind (e.g. B4 selects Microphone); make the
  // file kind active so the "Open audio file…" button exists.
  await openSelect('[data-testid="source.kind"]');
  await pickOption("Audio file");
  await mockReturn("pick_audio_file", path);
  await waitForSelector(SEL.sourceOpenFile, "the file picker button did not appear");
  await click(SEL.sourceOpenFile);
}

/** Wait until a source is on the timeline (the Timeline region replaced the strip). */
export async function waitForSourceLoaded(timeout = 30_000): Promise<void> {
  await browser.waitUntil(async () => (await count(SEL.timeline)) > 0, {
    timeout,
    timeoutMsg: "the timeline never replaced the source strip (no source loaded?)",
  });
}

/** The known duration (seconds) of each fixture — used to confirm a source swapped. */
const FIXTURE_SECONDS: Record<keyof typeof FIXTURES, number> = {
  sine440: 2,
  chirpNoise: 3,
  stereo: 2.5,
  corrupt: 0,
  synthGraph: 0,
};

/**
 * Open one of the generated fixtures and wait for the **new** source to land. The
 * core prompts before replacing an existing source, so the confirm is auto-answered.
 * If a fixture of the same duration is already loaded (the app is one long-lived
 * instance across the whole run), the load is skipped.
 */
export async function openFixture(name: keyof typeof FIXTURES): Promise<void> {
  const seconds = FIXTURE_SECONDS[name];
  const clock = `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
  const before = await timelineReadoutText();
  if (before && seconds > 0 && before.includes(clock)) return; // already loaded

  await ensureSourcePanel();
  await mockReturn("confirm", true);
  await openFileFixture(FIXTURES[name]);
  await waitForSourceLoaded();
  if (seconds > 0) {
    await browser.waitUntil(async () => (await timelineReadoutText()).includes(clock), {
      timeoutMsg: `the timeline never showed the ${name} duration (${clock})`,
    });
  }
}

// --- Kobalte popups (Select / Combobox / Popover) --------------------------

/** Open a Kobalte Select/Combobox trigger, tolerating WebView click quirks. */
export async function openSelect(trigger: string): Promise<void> {
  await waitForSelector(trigger, `the control "${trigger}" is missing`);
  await click(trigger);
  try {
    await browser.waitUntil(async () => (await count(".pop-item")) > 0, { timeout: 2_000 });
    return;
  } catch {
    // Fall back to synthesized pointer events: Kobalte opens on pointerdown.
    await browser.execute((sel: string) => {
      const target = document.querySelector(sel);
      if (!target) return;
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const event = type.startsWith("pointer")
          ? new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              button: 0,
              buttons: 1,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
            })
          : new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1 });
        target.dispatchEvent(event);
      }
    }, trigger);
  }
  await browser.waitUntil(async () => (await count(".pop-item")) > 0, {
    timeoutMsg: `the popup for "${trigger}" did not open`,
  });
}

/** Click a Kobalte popup option by its label (portal items carry `.pop-item`). */
export async function pickOption(label: string): Promise<void> {
  const clicked = (await browser.execute((wanted: string) => {
    const items = Array.from(document.querySelectorAll(".pop-item"));
    for (const item of items) {
      const text = (item.textContent ?? "").replace(/✓/g, "").trim();
      if (text === wanted || text.startsWith(wanted)) {
        (item as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, label)) as boolean;
  if (!clicked) throw new Error(`popup option "${label}" not found`);
}

/** Click a popover trigger, assert its panel opened, then dismiss it (by toggling). */
export async function openThenClosePopover(trigger: string): Promise<void> {
  await click(trigger);
  await browser.waitUntil(async () => (await count(".pop-panel")) > 0, {
    timeoutMsg: `popover "${trigger}" did not open`,
  });
  await dismissPopovers();
}

/** Dismiss any open Kobalte popover/select (robust across WebView quirks). */
export async function dismissPopovers(): Promise<void> {
  if ((await count(".pop-panel")) === 0) return;
  await browser.execute(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  if ((await count(".pop-panel")) > 0) await click(SEL.toolbar);
  await browser.waitUntil(async () => (await count(".pop-panel")) === 0, {
    timeoutMsg: "a popover did not close",
  });
}

// --- IPC: mock, invoke, emit ----------------------------------------------

/** Install a mock entry for a backend command (see [`setMock`]). */
interface MockEntry {
  reject: boolean;
  value?: unknown;
  message?: string;
}

/**
 * Native-dialog commands are always mocked, so a real OS/Tauri dialog can never
 * appear — WebDriver cannot interact with native modals and they block the webview
 * (`confirm` → replace-source / discard-changes; the file pickers return `null`).
 */
const DIALOG_DEFAULTS: Record<string, MockEntry> = {
  confirm: { reject: false, value: true },
  pick_audio_file: { reject: false, value: null },
  pick_project_save_path: { reject: false, value: null },
  pick_project_open_path: { reject: false, value: null },
};

/**
 * Install a command mock through the app's own IPC seam (`src/lib/ipc.ts`).
 *
 * `@wdio/tauri-plugin`'s `mock()` can't intercept this app's calls: it patches
 * `window.__TAURI__.core.invoke`, but Tauri injects `__TAURI_INTERNALS__` as
 * non-writable/non-configurable and the app goes through the bundled
 * `@tauri-apps/api` `invoke`. So the test drives the app's documented override
 * seam instead — still a real, drivable UI path, with the command's result
 * substituted. Installing a mock always seeds the dialog defaults first, so a real
 * dialog can never appear.
 */
export async function setMock(command: string, entry: MockEntry): Promise<void> {
  await browser.tauri.execute(
    (_tauri, cmd, patch, defaults) => {
      const g = globalThis as unknown as {
        __heylisten_test__?: {
          setInvokeOverride: (fn: unknown) => void;
          real: (...args: unknown[]) => Promise<unknown>;
        };
        __e2e_mocks__?: Record<string, unknown>;
        __e2e_installed__?: boolean;
      };
      const seam = g.__heylisten_test__;
      if (!seam) throw new Error("the app's __heylisten_test__ IPC seam is missing");
      g.__e2e_mocks__ = {
        ...(defaults as Record<string, unknown>),
        ...(g.__e2e_mocks__ ?? {}),
      };
      const table = g.__e2e_mocks__;
      table[cmd as string] = patch;
      if (!g.__e2e_installed__) {
        seam.setInvokeOverride((c: string, a?: unknown, o?: unknown) => {
          const current = g.__e2e_mocks__!;
          if (Object.prototype.hasOwnProperty.call(current, c)) {
            const m = current[c] as MockEntry;
            if (m.reject) return Promise.reject(new Error(m.message ?? "mocked rejection"));
            return Promise.resolve(m.value);
          }
          return seam.real(c, a, o);
        });
        g.__e2e_installed__ = true;
      }
    },
    command,
    entry as unknown as Record<string, unknown>,
    DIALOG_DEFAULTS as unknown as Record<string, unknown>,
  );
}

/** Mock a backend command to always resolve with `value`. */
export async function mockReturn(command: string, value: unknown): Promise<void> {
  await setMock(command, { reject: false, value });
}

/** Mock a backend command to reject (forces an error-path test). */
export async function mockReject(command: string, message: string): Promise<void> {
  await setMock(command, { reject: true, message });
}

/** Drop test-specific mocks, restoring the dialog defaults (the override stays). */
export async function restoreMocks(): Promise<void> {
  await browser.tauri.execute((_tauri, defaults) => {
    const g = globalThis as unknown as { __e2e_mocks__?: Record<string, unknown> };
    g.__e2e_mocks__ = { ...(defaults as Record<string, unknown>) };
  }, DIALOG_DEFAULTS as unknown as Record<string, unknown>);
}

/** Call a real Tauri command from the test. */
export async function invokeCore<T = unknown>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return (await browser.tauri.execute(
    (tauri, c, a) => tauri.core.invoke(c as string, a as Record<string, unknown>),
    command,
    args,
  )) as T;
}

/** Emit a Tauri event from the app's own context (e.g. a native menu action). */
export async function emitEvent(name: string, payload: unknown): Promise<void> {
  await browser.tauri.execute((_tauri, ev, p) => {
    const g = globalThis as unknown as {
      __TAURI__: { event: { emit: (n: string, x: unknown) => Promise<void> } };
    };
    return g.__TAURI__.event.emit(ev as string, p);
  }, name, payload);
}

/** Trigger a File/Edit menu action (`save`, `open`, `new`, `undo`, …). */
export async function menuAction(action: string): Promise<void> {
  await emitEvent("app:menu", action);
}

// --- pointer interactions --------------------------------------------------

/**
 * Drag an element by (dx, dy) from its centre, driving the app's `pointer*`
 * handlers. W3C pointer actions don't reliably produce Pointer Events inside the
 * system WebView, so we dispatch them directly (still the app's real handlers).
 */
export async function pointerDrag(selector: string, dx: number, dy: number): Promise<void> {
  await browser.execute(
    (sel: string, offX: number, offY: number) => {
      const target = document.querySelector(sel) as HTMLElement | null;
      if (!target) throw new Error(`pointerDrag: no element for ${sel}`);
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const fire = (type: string, cx: number, cy: number, buttons: number) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: cx,
            clientY: cy,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons,
          }),
        );
      };
      fire("pointerdown", x, y, 1);
      fire("pointermove", x + offX, y + offY, 1);
      fire("pointerup", x + offX, y + offY, 0);
    },
    selector,
    dx,
    dy,
  );
}

/** Wait for a condition with a friendly message. */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMsg: string,
  timeout = 15_000,
): Promise<void> {
  await browser.waitUntil(condition, { timeout, timeoutMsg });
}
