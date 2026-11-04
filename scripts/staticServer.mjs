#!/usr/bin/env node
/**
 * A tiny, dependency-free static file server over Node's built-in `http`/`fs`.
 *
 * Shared by `scripts/serveSite.mjs` (the marketing-site preview) and the Lighthouse
 * runner/report server, so the MIME table and the "never escape the root" guard live
 * in one place. Returns a handle with the bound URL and a `close()`.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/**
 * Serve `root` on `port` (0 = an OS-assigned free port), bound to loopback.
 *
 * @param {string} root Absolute directory to serve.
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function serveStatic(root, options = {}) {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      let file = resolve(root, "." + pathname);

      // A request must never escape the served directory.
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }

      // Directories serve their index.html.
      if ((await stat(file).catch(() => null))?.isDirectory()) {
        file = resolve(file, "index.html");
      }

      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
