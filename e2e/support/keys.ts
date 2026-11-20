/**
 * Keyboard dispatch for the command registry (M24.A seam, then M24.B).
 *
 * The registry's dispatcher is a single `window` `keydown` listener
 * (`src/state/keybindings/dispatcher.ts`). W3C `browser.keys` doesn't reliably drive a
 * real keypress into the system WebView, so a chord is dispatched as a `KeyboardEvent`
 * in-page — still the app's real handler. The event bubbles from `target` to `window`,
 * so targeting a focused text field (rather than `body`) exercises the text-field guard:
 * `event.target` is the field, and the command must not fire.
 */

/**
 * Press a `Mod`-style chord (e.g. `Mod+Z`, `Shift+Mod+Z`) at `target`.
 *
 * `target` is a CSS selector for the element the event is dispatched at (defaults to
 * `body`). Pass a text-field selector to test the guard. The key's letter is matched
 * case-insensitively by the dispatcher, so the last `+`-separated part is the key.
 */
export async function pressChord(chord: string, target = "body"): Promise<void> {
  await browser.execute(
    (c: string, sel: string) => {
      // Computed **inside** the browser: a module-scope constant lives in the test
      // runner's Node process, not in the page this `execute` runs in.
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      const parts = c.split("+");
      const key = parts.pop();
      if (!key) throw new Error(`pressChord: no key in "${c}"`);
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) throw new Error(`pressChord: no element for ${sel}`);
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          shiftKey: parts.includes("Shift"),
          altKey: parts.includes("Alt"),
          metaKey: isMac && parts.includes("Mod"),
          ctrlKey: !isMac && parts.includes("Mod"),
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    chord,
    target,
  );
}
