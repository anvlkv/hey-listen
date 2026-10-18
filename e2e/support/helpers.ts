/**
 * Shared E2E helpers (M8) — the suite's public surface: app lifecycle, driving the
 * Workbench/Source, reading analyzer results, and the small set of IPC affordances
 * the suite needs (mocking a native dialog, forcing an error path, emitting a menu
 * action). See `docs/testing.md`.
 *
 * This module is a barrel: the implementations live in focused submodules
 * (`app`, `dom`, `tabs`, `analyzers`, `source`, `popups`, `ipc`) and are re-exported
 * here so importers keep using the one path they always have. Only the names the
 * suite actually imports are re-exported — the module-internal ones (`countWithin`
 * in `dom.ts`, `setMock` in `ipc.ts`) stay in their submodule.
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
export { waitForApp, waitForShell, selectMainWindow } from "./app.ts";

// --- raw DOM helpers (avoid element-handle stalls) -------------------------
export { count, textOf, click, waitFor, pointerDrag, wheelOver } from "./dom.ts";

// --- Timeline canvas geometry (window handles / move bar) ------------------
export { dragTimelineHandle, dragTimelineWindow } from "./timeline.ts";

// --- Workbench tabs --------------------------------------------------------
export {
  openTool,
  activateTab,
  closeTool,
  closeAllTabs,
  openTabTitles,
  waitForTab,
  isToolOpen,
} from "./tabs.ts";

// --- Analyzer results ------------------------------------------------------
export {
  waitForAnalyzer,
  waitForReadouts,
  readoutValue,
  cardValue,
  canvasHasInk,
  canvasSignature,
  rowSignature,
  stableRowSignature,
} from "./analyzers.ts";

// --- Source ----------------------------------------------------------------
export {
  timelineReadoutText,
  ensureSourcePanel,
  openFileFixture,
  waitForSourceLoaded,
  openFixture,
} from "./source.ts";

// --- Kobalte popups (Select / Combobox / Popover) --------------------------
export { openSelect, pickOption, openThenClosePopover, dismissPopovers } from "./popups.ts";

// --- IPC: mock, invoke, emit ----------------------------------------------
export {
  mockReturn,
  mockReject,
  restoreMocks,
  invokeCore,
  emitEvent,
  menuAction,
  menuActionIn,
  startInvokeCounts,
  takeInvokeCounts,
  lastInvokeArgs,
} from "./ipc.ts";
