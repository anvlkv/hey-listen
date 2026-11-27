/**
 * Rehype transform for the manual.
 *
 * The repository's `docs/manual/*.md` is written to be read on GitHub: chapter
 * links end in `.md`, screenshots are `assets/…`, and two links point back into
 * `docs/`. On the published site those paths need the deployment base and the
 * `/docs/` / `/manual-assets/` routes.
 *
 * The transform also removes the first H1 so the docs layout can render the title
 * consistently with the landing.
 */

const CHAPTER_LINK = /^([0-9]{3}_[\w-]+|README)\.md(#.*)?$/i;
const DEV_LINK = /^\.\.\/development\/(.*)$/;
const ARCHIVE_LINK = /^\.\.\/archive\/(.*)$/;
/** A page inside the agent skill: `graphs.md`, `./graphs.md`, `audio-analysis/graphs.md`. */
const SKILL_LINK = /^(?:\.\/)?(?:audio-analysis\/)?([A-Za-z][\w-]*)\.md$/i;

function stripHash(href) {
  const index = href.indexOf("#");
  return index === -1 ? { path: href, hash: "" } : { path: href.slice(0, index), hash: href.slice(index) };
}

/**
 * A chapter link may name a file that is being renamed (the README is often edited
 * before the chapter file is). Keep the link useful by falling back to the chapter
 * with the same number; if there is none, the manual index is still a valid target.
 */
function resolveChapter(stem, chapters) {
  const name = stem.toLowerCase();
  if (name === "readme") return "";
  if (chapters.includes(name)) return name.replace(/_/g, "-");

  const prefix = /^\d{3}/.exec(name)?.[0];
  const sibling = prefix
    ? chapters.find((chapter) => chapter.startsWith(`${prefix}_`))
    : undefined;
  return sibling ? sibling.replace(/_/g, "-") : null;
}

function rewriteHref(href, base, repo, chapters) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href;

  const { path, hash } = stripHash(href);
  const chapter = CHAPTER_LINK.exec(path);
  if (chapter) {
    const slug = resolveChapter(chapter[1].replace(/\.md$/i, ""), chapters);
    return `${base}/docs/${slug ? `${slug}/` : ""}${hash}`;
  }

  const dev = DEV_LINK.exec(path);
  if (dev) {
    const target = dev[1] ?? "";
    return target
      ? `${repo}/blob/main/docs/development/${target}`
      : `${repo}/tree/main/docs/development`;
  }

  const archive = ARCHIVE_LINK.exec(path);
  if (archive) {
    const target = archive[1] ?? "";
    return target
      ? `${repo}/blob/main/docs/archive/${target}`
      : `${repo}/tree/main/docs/archive`;
  }

  const skill = SKILL_LINK.exec(path);
  if (skill) {
    return `${base}/docs/audio-analysis/${skill[1].toLowerCase()}/${hash}`;
  }

  return href;
}

function rewriteSrc(src, base) {
  const assets = /^\.?\/?assets\/(.+)$/.exec(src);
  return assets ? `${base}/manual-assets/${assets[1]}` : src;
}

export function rehypeDocs(options = {}) {
  const base = (options.base ?? "").replace(/\/$/, "");
  const repo = options.repo ?? "";
  const chapters = options.chapters ?? [];

  return (tree) => {
    let removedH1 = false;

    const walk = (parent) => {
      if (!Array.isArray(parent.children)) return;

      for (let index = 0; index < parent.children.length; index += 1) {
        const node = parent.children[index];

        if (!removedH1 && node.type === "element" && node.tagName === "h1") {
          parent.children.splice(index, 1);
          removedH1 = true;
          index -= 1;
          continue;
        }

        if (node.type === "element" && node.tagName === "a") {
          const href = node.properties?.href;
          if (typeof href === "string") node.properties.href = rewriteHref(href, base, repo, chapters);
        }

        if (node.type === "element" && node.tagName === "img") {
          const src = node.properties?.src;
          if (typeof src === "string") node.properties.src = rewriteSrc(src, base);
        }

        walk(node);
      }
    };

    walk(tree);
  };
}
