export const REPO = "https://github.com/anvlkv/hey-listen";
export const PROFILE = "https://github.com/anvlkv";
export const ISSUES = `${REPO}/issues`;
export const NEW_FEATURE = `${REPO}/issues/new?labels=enhancement&title=Feature%20proposal%3A%20`;
export const NEW_BUG = `${REPO}/issues/new?labels=bug&title=Bug%3A%20`;
export const NEW_STORY = `${REPO}/issues/new?labels=show-and-tell&title=Success%20story%3A%20`;
export const UNLICENSE = "https://unlicense.org/";

const rawBase = import.meta.env.BASE_URL || "/";

/** The deployment base without its trailing slash (`/hey-listen` or `""`). */
export const BASE = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;

/**
 * Resolve a site path against the deployment base. Leaves absolute URLs, protocol
 * URLs (`mailto:`), and fragments alone.
 */
export function link(path = ""): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path) || path.startsWith("#")) return path;
  const clean = path.replace(/^\/+/, "");
  return clean ? `${BASE}/${clean}` : `${BASE}/`;
}

/** An absolute URL for canonical and Open Graph tags. */
export function absolute(path: string): string {
  const site = import.meta.env.SITE || "https://anvlkv.github.io";
  return new URL(link(path), site).href;
}
