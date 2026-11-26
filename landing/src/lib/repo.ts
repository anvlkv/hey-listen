import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The repository root at build time.
 *
 * `import.meta.url` is not usable here: Astro bundles prerender code into
 * `landing/dist/.prerender/`, so the module's own location no longer points at
 * `landing/src/lib`. Walk up from the working directory instead, which works from
 * the workspace (`landing/`) and from the repo root alike.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    const hasAcknowledgements = existsSync(path.join(dir, "ACKNOWLEDGEMENTS.md"));
    const hasManual = existsSync(path.join(dir, "docs", "manual"));
    if (hasAcknowledgements && hasManual) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/**
 * Read a file from the repository root at build time. The landing sits in a
 * workspace beside `docs/`, `ACKNOWLEDGEMENTS.md` and `package.json`; reading them
 * in place keeps one source of truth.
 */
export function readRepoFile(relativePath: string): string {
  const file = path.join(repoRoot(), relativePath);
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`landing: could not read ${relativePath} (looked in ${file})`);
  }
}

export function readPackageVersion(): string {
  const pkg = JSON.parse(readRepoFile("package.json")) as { version?: string };
  return pkg.version ?? "0.0.0";
}
