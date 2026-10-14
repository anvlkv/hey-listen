import { version } from "../../package.json";

/**
 * App identity, read from `package.json` so the version shown in the About dialog
 * cannot drift from the released one (the Rust core uses `CARGO_PKG_VERSION`, kept in
 * step by the release process).
 */
export const APP_NAME = "Hey Listen";
export const APP_VERSION: string = version;
export const APP_TAGLINE = "Audio analysis workbench";
