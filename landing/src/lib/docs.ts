import { getCollection } from "astro:content";

import { link } from "./site";

export interface DocNavItem {
  id: string;
  title: string;
  href: string;
  number: string;
}

/** The manual has no frontmatter; its first H1 is the chapter title. */
export function titleFromBody(body?: string): string {
  const match = /^#\s+(.+)$/m.exec(body ?? "");
  return match ? match[1].trim() : "Untitled";
}

export function chapterNumber(id: string): string {
  return /^\d{3}/.test(id) ? id.slice(0, 3) : "";
}

export async function getDocNav(): Promise<DocNavItem[]> {
  const entries = await getCollection("docs");
  return entries
    .filter((entry) => entry.id !== "readme")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => ({
      id: entry.id,
      title: titleFromBody(entry.body),
      href: link(`docs/${entry.id}/`),
      number: chapterNumber(entry.id),
    }));
}
