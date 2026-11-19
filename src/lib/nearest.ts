/**
 * "Did you mean?" for the TypeScript boundary errors (D-10).
 *
 * A boundary validates an id or an option key against the catalog and fails loudly on
 * an unknown one. A bare `unknown tool: pitchyyin` leaves the caller hunting the
 * spelling, so the boundary appends the nearest known name when one is close.
 */

/** The closest candidate to `input`, or `null` when nothing is within two edits. */
export function nearestName(input: string, candidates: Iterable<string>): string | null {
  const needle = input.trim().toLowerCase();
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = damerauLevenshtein(needle, candidate.trim().toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      if (distance === 0) break;
    }
  }
  return bestDistance <= 2 ? best : null;
}

/** The ` (did you mean …?)` suffix for an error message, or `""` when nothing is close. */
export function didYouMean(input: string, candidates: Iterable<string>): string {
  const nearest = nearestName(input, candidates);
  return nearest == null ? "" : ` (did you mean ${nearest}?)`;
}

/**
 * Damerau–Levenshtein edit distance with adjacent transpositions (`synht` → `synth`
 * is one edit), on lowercased strings. Two rows of dynamic programming, so the
 * candidates are as cheap as the common Levenshtein while also catching a swap.
 */
function damerauLevenshtein(a: string, b: string): number {
  const cols = b.length + 1;
  let previous: number[] = [];
  let current: number[] = new Array<number>(cols).fill(0);
  for (let j = 0; j < cols; j++) current[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const diagonal = previous;
    previous = current;
    current = new Array<number>(cols).fill(0);
    current[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], diagonal[j - 2] + 1);
      }
    }
  }
  return current[b.length];
}
