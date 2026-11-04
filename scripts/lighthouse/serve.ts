#!/usr/bin/env -S npx tsx
/**
 * Serve the Lighthouse report written by `npm run lighthouse` (M32).
 *
 * The overview (`reports/lighthouse/index.html`) links every run's untouched
 * Lighthouse HTML report. Override the port with `PORT` or `--port=`.
 */

import process from "node:process";
import { serveStatic } from "../staticServer.mjs";
import { REPORT_DIR } from "./config";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg ? portArg.slice("--port=".length) : process.env.PORT) || 4174;

const server = await serveStatic(REPORT_DIR, { port });
console.log(`\n  Hey Listen Lighthouse report →  ${server.url}/index.html\n`);
