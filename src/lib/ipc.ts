import { invoke as tauriInvoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";

/**
 * The app's single IPC façade over `@tauri-apps/api`'s `invoke`.
 *
 * Every core-command call goes through here so the E2E suite (M8) has **one** place
 * to substitute a command's result. Tauri injects `window.__TAURI_INTERNALS__` as a
 * non-writable, non-configurable global, so `@wdio/tauri-plugin`'s `mock()` cannot
 * intercept the bundled `invoke` — a seam in our own code can. Production never
 * installs an override, so behaviour is identical to importing `invoke` directly.
 * See `docs/testing.md` → "IPC mocking".
 */
export type InvokeHandler = <T>(
  cmd: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
) => Promise<T>;

let override: InvokeHandler | null = null;

/** Test-only seam: substitute command results. Pass `null` to restore the real IPC. */
export function setInvokeOverride(next: InvokeHandler | null): void {
  override = next;
}

export function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  return override ? override<T>(cmd, args, options) : tauriInvoke<T>(cmd, args, options);
}

declare global {
  /** The E2E test seam, exposed on `globalThis` for `browser.tauri.execute()`. */

  var __heylisten_test__:
    { setInvokeOverride: typeof setInvokeOverride; real: typeof tauriInvoke } | undefined;
}

globalThis.__heylisten_test__ = { setInvokeOverride, real: tauriInvoke };
