/*
 * Normalize `navigator.language` before the app's module graph is evaluated.
 *
 * A `C` / `C.UTF-8` locale — the default on headless CI runners and in minimal
 * containers — makes the WebView report a non-BCP-47 `language` such as `"C"`.
 * `new Intl.NumberFormat("C")` throws a `RangeError`, and uPlot builds one at
 * **module scope**: the throw aborts the whole bundle before the first paint, leaving
 * an empty `#root`.
 *
 * This has to be a **classic** script in `<head>`, not an import: a module script is
 * deferred and its whole static import graph (including the separately chunked uPlot
 * vendor bundle) is evaluated *before* the entry module's body, so an in-module fix
 * such as `src/boot.ts` would run too late.
 *
 * Loaded from `index.html` and `preview.html`; see `docs/testing.md` →
 * "When the shell does not render".
 */
(function () {
  try {
    // Structurally invalid tags (e.g. `C`, `en_US.UTF-8`) throw a `RangeError`;
    // valid-but-unknown ones (e.g. `xx-XX`) just resolve to `[]`. Both are fine to
    // hand to `Intl.NumberFormat`, so only the throw marks a real problem.
    Intl.NumberFormat.supportedLocalesOf([navigator.language]);
  } catch {
    Object.defineProperty(navigator, "language", {
      configurable: true,
      get: function () {
        return "en-US";
      },
    });
  }
})();
