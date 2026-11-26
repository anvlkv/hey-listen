import { readRepoFile } from "./repo";

export type RoadmapStatus = "done" | "drafted" | "planned";

export interface Milestone {
  id: string;
  title: string;
  description: string;
  status: RoadmapStatus;
}

export interface Roadmap {
  intro: string;
  milestones: Milestone[];
}

const MILESTONE = /^((?:M\d+(?:\.\w+)?)|Backlog)\s*(?:[—–-]\s*)?(.*)$/;

function statusOf(heading: string): RoadmapStatus {
  if (heading.includes("✅")) return "done";
  if (/\(drafted\)/i.test(heading)) return "drafted";
  return "planned";
}

function cleanHeading(heading: string): string {
  return heading
    .replace(/✅/g, " ")
    .replace(/\((?:planned|drafted|delivered|in progress)\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Parse `docs/development/000_roadmap.md`. The file is the index of every
 * milestone; its `##` headings carry the id, title and status marker.
 */
export function readRoadmap(): Roadmap {
  const source = readRepoFile("docs/development/000_roadmap.md");
  const blocks: { heading: string; body: string[] }[] = [];
  const intro: string[] = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of source.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (current) blocks.push(current);
      current = { heading: heading[1].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
    else intro.push(line);
  }
  if (current) blocks.push(current);

  const milestones: Milestone[] = [];
  for (const block of blocks) {
    const raw = cleanHeading(block.heading);
    const match = MILESTONE.exec(raw);
    if (!match) continue;
    const title = match[2]?.trim() ?? "";
    milestones.push({
      id: match[1],
      title: title || match[1],
      description: compact(block.body.join("\n")),
      status: statusOf(block.heading),
    });
  }

  return { intro: compact(intro.join("\n")), milestones };
}
