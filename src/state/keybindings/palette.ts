/**
 * Command-palette ranking. Pure and node-safe: no `window`, no DOM, no store — the
 * dialog supplies
 * the items, so the ranking rules can be unit-tested.
 *
 * Matching is deliberately simple: an item survives when the query appears in its
 * title, category, keywords or description. Survivors sort by how *strongly* the title
 * matched (a prefix beats a mid-word substring, which beats a subsequence), then by
 * where the match starts, then by their original position — so the order is
 * deterministic and ties never shuffle.
 */

/** One row the palette can run: a command, a tool, or an open Workbench tab. */
export interface PaletteItem {
  /** The command id or tool id. */
  id: string;
  title: string;
  /** The command category, or the tool's section name. */
  category?: string;
  keywords?: string[];
  description?: string;
  /** The binding chip to display, or null (tools have none). */
  binding?: string | null;
  kind: "command" | "tool";
}

/** Where the first subsequence match starts, or `null` when the needle does not fit. */
function subsequenceStart(needle: string, haystack: string): number | null {
  let cursor = 0;
  let first = -1;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;
    if (first === -1) first = found;
    cursor = found + 1;
  }
  return first;
}

/** Whether `index` starts a word (the string start, or after a non-alphanumeric char). */
function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  return !/[a-z0-9]/i.test(text.charAt(index - 1));
}

/**
 * How well the title matches: `0` prefix, `1` word-boundary substring, `2` any
 * substring, `3` subsequence — or `null` for no match. Lower is better.
 */
function titleMatchTier(title: string, query: string): number | null {
  const text = title.toLowerCase();
  if (text.startsWith(query)) return 0;
  const index = text.indexOf(query);
  if (index >= 0) return isWordStart(text, index) ? 1 : 2;
  return subsequenceStart(query, text) !== null ? 3 : null;
}

/** Whether a secondary field (category, keyword, description) matches at all. */
function fieldMatches(value: string, query: string): boolean {
  const text = value.toLowerCase();
  return text.includes(query) || subsequenceStart(query, text) !== null;
}

/** A scored row, with the original index kept for a stable tie-break. */
interface Ranked {
  item: PaletteItem;
  tier: number;
  detail: number;
  index: number;
}

/** Score one item against a lowercased, trimmed query, or `null` when it does not match. */
function rankItem(item: PaletteItem, query: string, index: number): Ranked | null {
  const tier = titleMatchTier(item.title, query);
  if (tier !== null) {
    const lowerTitle = item.title.toLowerCase();
    const at = lowerTitle.indexOf(query);
    return { item, tier, detail: at < 0 ? 0 : at, index };
  }

  const secondary =
    (item.category != null && fieldMatches(item.category, query)) ||
    (item.description != null && fieldMatches(item.description, query)) ||
    (item.keywords ?? []).some((keyword) => fieldMatches(keyword, query));
  if (!secondary) return null;
  return { item, tier: 4, detail: 0, index };
}

/**
 * Filter `items` to those that fuzzy-match `query` and sort them best-first. An empty
 * or whitespace-only query returns every item in its original order.
 */
export function rankPaletteItems(query: string, items: PaletteItem[]): PaletteItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items.slice();

  const ranked: Ranked[] = [];
  items.forEach((item, index) => {
    const scored = rankItem(item, needle, index);
    if (scored) ranked.push(scored);
  });

  ranked.sort((a, b) => a.tier - b.tier || a.detail - b.detail || a.index - b.index);
  return ranked.map((row) => row.item);
}
