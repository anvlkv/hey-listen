/** Type surface for `scripts/staticServer.mjs` (Node cannot consume a TS module there). */

export interface StaticServer {
  url: string;
  close: () => Promise<void>;
}

export function serveStatic(root: string, options?: { port?: number }): Promise<StaticServer>;
