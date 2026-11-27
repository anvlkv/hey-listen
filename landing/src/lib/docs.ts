import { getCollection } from "astro:content";

import { link } from "./site";

export interface DocNavItem {
  id: string;
  title: string;
  href: string;
  number: string;
  /** `manual` for the chapters, `agent` for the skill's reference pages. */
  group: "manual" | "agent";
}

/** The manual has no frontmatter; its first H1 is the chapter title. */
export function titleFromBody(body?: string): string {
  const match = /^#\s+(.+)$/m.exec(body ?? "");
  return match ? match[1].trim().replace(/`/g, "") : "Untitled";
}

export function chapterNumber(id: string): string {
  return /^\d{3}/.test(id) ? id.slice(0, 3) : "";
}

/** A chapter's H1 carries its number; the sidebar prints the number in its own column. */
function navTitle(id: string, body?: string): string {
  const title = titleFromBody(body);
  return chapterNumber(id) ? title.replace(/^\d{3}\s*—\s*/, "") : title;
}

export async function getDocNav(): Promise<DocNavItem[]> {
  const entries = await getCollection("docs");
  return entries
    .filter((entry) => entry.id !== "readme")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => ({
      id: entry.id,
      title: navTitle(entry.id, entry.body),
      href: link(`docs/${entry.id}/`),
      number: chapterNumber(entry.id),
      group: entry.id.startsWith("audio-analysis/") ? "agent" : "manual",
    }));
}
