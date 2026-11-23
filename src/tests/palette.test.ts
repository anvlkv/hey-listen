import { expect, it } from "vitest";
import { rankPaletteItems, type PaletteItem } from "../state/keybindings/palette";

/**
 * Unit checks for the command palette's ranking (`src/state/keybindings/palette.ts`):
 * the empty query, filtering, the title-match tiers, secondary fields, and the stable
 * tie-break.
 */

/** A palette item with only the fields a test cares about. */
function item(id: string, title: string, extra: Partial<PaletteItem> = {}): PaletteItem {
  return { id, title, kind: "command", ...extra };
}

/** The ranked ids, for compact assertions. */
function ranked(query: string, items: PaletteItem[]): string[] {
  return rankPaletteItems(query, items).map((entry) => entry.id);
}

it("returns every item in original order for an empty or whitespace query", () => {
  const items = [item("a", "Alpha"), item("b", "Beta"), item("c", "Gamma")];
  expect(ranked("", items)).toEqual(["a", "b", "c"]);
  expect(ranked("   ", items)).toEqual(["a", "b", "c"]);
});

it("drops items that match nothing", () => {
  const items = [item("a", "Undo"), item("b", "Redo")];
  expect(ranked("zzz", items)).toEqual([]);
});

it("matches case-insensitively", () => {
  const items = [item("a", "Undo")];
  expect(ranked("UNDO", items)).toEqual(["a"]);
});

it("ranks a title prefix above a word-boundary match, a mid-word one and a subsequence", () => {
  const items = [
    item("subsequence", "Zero output of music"),
    item("midword", "Customzoom"),
    item("boundary", "Fit then zoom"),
    item("prefix", "Zoom in"),
  ];
  expect(ranked("zoom", items)).toEqual(["prefix", "boundary", "midword", "subsequence"]);
});

it("matches the category, keywords and description", () => {
  const items = [
    item("category", "Play / Pause", { category: "Transport" }),
    item("keyword", "Fit all", { keywords: ["zoom"] }),
    item("description", "Render synth", { description: "Build a fundsp synth" }),
    item("none", "Something else"),
  ];
  expect(ranked("transport", items)).toEqual(["category"]);
  expect(ranked("zoom", items)).toEqual(["keyword"]);
  expect(ranked("fundsp", items)).toEqual(["description"]);
});

it("ranks a title match above a secondary-field match", () => {
  const items = [
    item("keyword", "Fit all", { keywords: ["zoom"] }),
    item("title", "Timeline zoom"),
  ];
  expect(ranked("zoom", items)).toEqual(["title", "keyword"]);
});

it("keeps the original order for equally strong matches", () => {
  const items = [item("first", "Open project"), item("second", "Open window")];
  expect(ranked("open", items)).toEqual(["first", "second"]);
});

it("returns a copy, never the caller's array", () => {
  const items = [item("a", "Alpha")];
  const result = rankPaletteItems("", items);
  expect(result).not.toBe(items);
});
