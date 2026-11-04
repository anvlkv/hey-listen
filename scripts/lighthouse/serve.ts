#!/usr/bin/env -S npx tsx
/**
 * Serve the Lighthouse report written by `npm run lighthouse` (M32).
 *
 * The overview (`reports/lighthouse/index.html`) links every run's untouched
 * Lighthouse HTML report. Override the port with `PORT` or `--port=`.
 */

import process from "node:process";
import { serveStatic } from "../staticServer";
import { REPORT_DIR } from "./config";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const raw = portArg ? portArg.slice("--port=".length) : process.env.PORT;
const port = raw == null || raw === "" ? 4174 : Number(raw);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`invalid port: ${raw}`);
  process.exit(2);
}

try {
  const server = await serveStatic(REPORT_DIR, { port });
  console.log(`\n  Hey Listen Lighthouse report →  ${server.url}/index.html\n`);
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(
    code === "EADDRINUSE"
      ? `port ${port} is already in use — pass --port=<n> (0 picks a free port)`
      : `could not serve the report: ${String(err)}`,
  );
  process.exitCode = 1;
}
