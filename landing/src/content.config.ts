import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

/**
 * The published manual is the repository's `docs/manual/*.md`, not a copy. The
 * content layer reads it in place, so a chapter edited in `docs/` is what the site
 * builds. `readme` becomes the `/docs/` index; the numbered chapters keep their
 * order in the URL and sidebar.
 */
const docs = defineCollection({
  loader: glob({
    base: "../docs/manual",
    pattern: "*.md",
    generateId: ({ entry }) =>
      entry.replace(/\.md$/, "").replace(/_/g, "-").toLowerCase(),
  }),
});

export const collections = { docs };
