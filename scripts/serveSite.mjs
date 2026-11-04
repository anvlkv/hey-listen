#!/usr/bin/env node
/**
 * Serve the marketing site (`site/`) locally for preview.
 *
 * A tiny static server (shared with the Lighthouse report preview) — the site has no
 * build step, so previewing it just means serving its files. Run via
 * `npm run serve:site`; override the port with `PORT`.
 */

import { fileURLToPath } from "node:url";
import { serveStatic } from "./staticServer.mjs";

const ROOT = fileURLToPath(new URL("../site", import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

const server = await serveStatic(ROOT, { port: PORT });
console.log(`\n  Hey Listen site preview →  ${server.url}\n`);
