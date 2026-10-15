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
 * Install a command mock through the app's own IPC seam (`src/lib/ipc.ts`).
 *
 * Installing a mock always seeds the dialog defaults first, so a real dialog can
 * never appear.
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
