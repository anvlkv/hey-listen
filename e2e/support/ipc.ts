/**
 * IPC affordances (M8): mock, invoke and emit.
 *
 * `@wdio/tauri-plugin`'s `mock()` can't intercept this app's calls: it patches
 * `window.__TAURI__.core.invoke`, but Tauri injects `__TAURI_INTERNALS__` as
 * non-writable/non-configurable and the app goes through the bundled
 * `@tauri-apps/api` `invoke`. So the suite drives the app's own documented override
 * seam (`src/lib/ipc.ts`, `globalThis.__heylisten_test__`) instead. See
 * `docs/testing.md`.
 */

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
 * Install the seam override (idempotent) through the app's own IPC seam
 * (`src/lib/ipc.ts`), seeding the dialog defaults so a real dialog can never appear.
 * The override counts invokes when a count is active and dispatches any mock.
 */
async function ensureOverride(): Promise<void> {
  await browser.tauri.execute(
    (_tauri, defaults) => {
      const g = globalThis as unknown as {
        __heylisten_test__?: {
          setInvokeOverride: (fn: unknown) => void;
          real: (...args: unknown[]) => Promise<unknown>;
        };
        __e2e_mocks__?: Record<string, MockEntry>;
        __e2e_counts__?: Record<string, number>;
        __e2e_installed__?: boolean;
      };
      const seam = g.__heylisten_test__;
      if (!seam) throw new Error("the app's __heylisten_test__ IPC seam is missing");
      g.__e2e_mocks__ = {
        ...(defaults as Record<string, MockEntry>),
        ...(g.__e2e_mocks__ ?? {}),
      };
      if (g.__e2e_installed__) return;
      seam.setInvokeOverride((c: string, a?: unknown, o?: unknown) => {
        // Read the table per call: `__e2e_mocks__` is re-created on every install, and a
        // capture here would go stale the moment a later `setMock` added an entry.
        const table = g.__e2e_mocks__ ?? {};
        const counts = g.__e2e_counts__;
        if (counts) counts[c] = (counts[c] ?? 0) + 1;
        const mock = table[c];
        if (mock) {
          if (mock.reject) return Promise.reject(new Error(mock.message ?? "mocked rejection"));
          return Promise.resolve(mock.value);
        }
        return seam.real(c, a, o);
      });
      g.__e2e_installed__ = true;
    },
    DIALOG_DEFAULTS as unknown as Record<string, unknown>,
  );
}

/**
 * Install a command mock through the app's own IPC seam (`src/lib/ipc.ts`).
 *
 * Installing a mock always seeds the dialog defaults first, so a real dialog can
 * never appear.
 */
export async function setMock(command: string, entry: MockEntry): Promise<void> {
  await ensureOverride();
  await browser.tauri.execute(
    (_tauri, cmd, patch) => {
      (globalThis as unknown as { __e2e_mocks__: Record<string, unknown> }).__e2e_mocks__[
        cmd as string
      ] = patch;
    },
    command,
    entry as unknown as Record<string, unknown>,
  );
}

/**
 * Start counting invokes per command (they still run for real). Used to assert that a
 * gesture does not talk to the core at pointer rate — see [`takeInvokeCounts`].
 */
export async function startInvokeCounts(): Promise<void> {
  await ensureOverride();
  await browser.tauri.execute(() => {
    (globalThis as unknown as { __e2e_counts__?: Record<string, number> }).__e2e_counts__ = {};
  });
}

/** Read and reset the per-command invoke counts from [`startInvokeCounts`]. */
export async function takeInvokeCounts(): Promise<Record<string, number>> {
  return (await browser.tauri.execute(() => {
    const g = globalThis as unknown as { __e2e_counts__?: Record<string, number> };
    const counts = g.__e2e_counts__ ?? {};
    g.__e2e_counts__ = {};
    return counts;
  })) as Record<string, number>;
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
  await browser.tauri.execute(
    (_tauri, defaults) => {
      const g = globalThis as unknown as { __e2e_mocks__?: Record<string, unknown> };
      g.__e2e_mocks__ = { ...(defaults as Record<string, unknown>) };
    },
    DIALOG_DEFAULTS as unknown as Record<string, unknown>,
  );
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
  await browser.tauri.execute(
    (_tauri, ev, p) => {
      const g = globalThis as unknown as {
        __TAURI__: { event: { emit: (n: string, x: unknown) => Promise<void> } };
      };
      return g.__TAURI__.event.emit(ev as string, p);
    },
    name,
    payload,
  );
}

/** Trigger a File/Edit menu action (`save`, `open`, `new`, `undo`, …). */
export async function menuAction(action: string): Promise<void> {
  await emitEvent("app:menu", action);
}

/**
 * Trigger a File/Edit menu action in **one named window**.
 *
 * [`menuAction`] emits with `event.emit`, which Tauri delivers to *all* targets. A targeted
 * emit is the faithful equivalent of the native menu (`src-tauri/src/menu.rs` →
 * `emit_to(focused_label, …)`) — **but** Tauri matches a listener's own target *before*
 * applying the emit filter (`match_any_or_filter`, `tauri/src/event/listener.rs`), and the
 * app's `listen("app:menu")` uses the default `Any` target. So today the action still
 * reaches every window; callers must keep the other windows' dialogs mocked to `null`.
 * See the R spec.
 */
export async function menuActionIn(label: string, action: string): Promise<void> {
  await browser.tauri.execute(
    (_tauri, target, event, payload) => {
      const g = globalThis as unknown as {
        __TAURI__: { event: { emitTo: (t: string, e: string, p: unknown) => Promise<void> } };
      };
      return g.__TAURI__.event.emitTo(target as string, event as string, payload);
    },
    label,
    "app:menu",
    action,
  );
}
