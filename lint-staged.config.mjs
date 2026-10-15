/**
 * lint-staged: what runs on the staged files in the pre-commit hook.
 *
 * Functions (rather than a bare command string) are used for the two repo-wide
 * checks: a plain string would have lint-staged append the staged file paths, and
 * neither `cargo fmt` nor the file-length budget takes file arguments. Returning
 * the command from a function runs it once, unfiltered.
 *
 * The heavy checks (knip, jscpd, clippy) are deliberately *not* here — they are
 * repo-scoped and slower, so they run in the pre-push hook and in CI via
 * `npm run maid`. See `docs/code-hygiene.md`.
 */
export default {
  // Formatting: prettier owns whitespace, and lint-staged restages what it fixes.
  "*.{ts,tsx,js,mjs,cjs,jsx,css,html,json,yml,yaml}": "prettier --write",

  // Lint the TS/TSX we are committing (autofix first, then fail on the rest).
  "*.{ts,tsx}": "eslint --fix",

  // The Rust core is formatted as a whole crate — rustfmt needs no file list, and
  // checking the crate keeps one file from being formatted differently from the rest.
  "*.rs": () => "cargo fmt --manifest-path src-tauri/Cargo.toml --check",

  // The file-length budget is a repo-wide invariant, not a per-file one.
  "*": () => "node scripts/checkFileSize.mjs",
};
