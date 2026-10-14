/**
 * Attribution data for the About dialog.
 *
 * Kept in step with `docs/dependencies.md` (the full dependency rationale). Font
 * Awesome **requires** attribution (icons CC BY 4.0, fonts SIL OFL 1.1, code MIT), so
 * it leads; the rest is the runtime dependency list. Links are opened in the system
 * browser by the core (`open_external_url`), not inside the webview.
 */

export interface Attribution {
  name: string;
  /** The license(s) the project is distributed under. */
  license: string;
  /** A canonical page (crates.io / npm / project site). */
  url: string;
}

/** The bundled icon font's attribution — the one attribution that is *required*. */
export const FONT_AWESOME: Attribution & { note: string } = {
  name: "Font Awesome Free 7",
  license: "Icons CC BY 4.0 · Fonts SIL OFL 1.1 · Code MIT",
  url: "https://fontawesome.com/license/free",
  note: "© Fonticons, Inc. The bundled icon font and glyphs throughout the UI. The full license text ships at public/fonts/fontawesome/LICENSE.txt.",
};

/** Runtime third-party software, most prominent first. */
export const ATTRIBUTIONS: Attribution[] = [
  { name: "Tauri", license: "MIT / Apache-2.0", url: "https://tauri.app" },
  { name: "SolidJS", license: "MIT", url: "https://www.npmjs.com/package/solid-js" },
  { name: "Kobalte", license: "MIT", url: "https://www.npmjs.com/package/@kobalte/core" },
  { name: "dockview", license: "MIT", url: "https://www.npmjs.com/package/dockview" },
  { name: "@dschz/solid-flow", license: "MIT", url: "https://www.npmjs.com/package/@dschz/solid-flow" },
  { name: "@dschz/solid-uplot", license: "MIT", url: "https://www.npmjs.com/package/@dschz/solid-uplot" },
  { name: "uPlot", license: "MIT", url: "https://www.npmjs.com/package/uplot" },
  { name: "symphonia", license: "MPL-2.0", url: "https://crates.io/crates/symphonia" },
  { name: "oxiaudio", license: "Apache-2.0", url: "https://crates.io/crates/oxiaudio" },
  { name: "fundsp", license: "see crates.io", url: "https://crates.io/crates/fundsp" },
  { name: "flexaudio", license: "see crates.io", url: "https://crates.io/crates/flexaudio" },
  { name: "cpal", license: "Apache-2.0", url: "https://crates.io/crates/cpal" },
  { name: "serde / serde_json", license: "MIT / Apache-2.0", url: "https://crates.io/crates/serde" },
  { name: "postcard", license: "MIT / Apache-2.0", url: "https://crates.io/crates/postcard" },
  { name: "thiserror", license: "MIT / Apache-2.0", url: "https://crates.io/crates/thiserror" },
  { name: "log", license: "MIT / Apache-2.0", url: "https://crates.io/crates/log" },
  { name: "ts-rs", license: "MIT", url: "https://crates.io/crates/ts-rs" },
];
