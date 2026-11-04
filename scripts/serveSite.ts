/**
 * Serve the marketing site (`site/`) locally for preview.
 *
 * A tiny static server (shared with the Lighthouse report preview) — the site has no
 * build step, so previewing it just means serving its files. Run via
 * `npm run serve:site`; override the port with `PORT` (0 picks a free port).
 */

import { fileURLToPath } from "node:url";
import process from "node:process";
import { serveStatic } from "./staticServer";

const ROOT = fileURLToPath(new URL("../site", import.meta.url));
const raw = process.env.PORT;
const port = raw == null || raw === "" ? 4173 : Number(raw);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`invalid PORT: ${raw}`);
  process.exit(2);
}

try {
  const server = await serveStatic(ROOT, { port });
  console.log(`\n  Hey Listen site preview →  ${server.url}\n`);
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(
    code === "EADDRINUSE"
      ? `port ${port} is already in use — set PORT=<n> (0 picks a free port)`
      : `could not serve the site: ${String(err)}`,
  );
  process.exitCode = 1;
}
