/** Above this length a numeric / gapped array is summarized. */
const COMPACT_ARRAY_MIN = 8;
/** Above this length any array (numeric or not) is reduced to its length. */
const COMPACT_LENGTH_MIN = 16;

/**
 * Shrink a result for the agent. A long numeric array becomes
 * `{ length, min, max, argmin, argmax }`; a long array with gaps (`null`s, e.g. a pitch
 * track's unvoiced frames) becomes `{ length, nulls, min, max, argmin, argmax }` over
 * the present numbers; any other long array becomes `{ length }`. Objects recurse.
 * `includeData: true` returns the raw result instead. Mirrors the Rust `compact`.
 */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length > COMPACT_ARRAY_MIN) return compactArray(value);
    return value.map(compact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = compact(item);
    }
    return out;
  }
  return value;
}

function compactArray(items: unknown[]): unknown {
  const length = items.length;
  let min = Infinity;
  let max = -Infinity;
  let argmin = 0;
  let argmax = 0;
  let nulls = 0;
  let present = 0;
  for (let index = 0; index < length; index++) {
    const item = items[index];
    if (item === null) {
      nulls++;
      continue;
    }
    if (typeof item !== "number") {
      return length > COMPACT_LENGTH_MIN ? { length } : items.map(compact);
    }
    present++;
    if (item < min) {
      min = item;
      argmin = index;
    }
    if (item > max) {
      max = item;
      argmax = index;
    }
  }
  if (present === 0) return { length, nulls };
  if (nulls > 0) return { length, nulls, min, max, argmin, argmax };
  return { length, min, max, argmin, argmax };
}

/**
 * Decimate every array longer than `maxPoints` to at most `maxPoints` entries by
 * striding (keeping the first and last), so a bounded `includeData` need not dump every
 * frame. Objects recurse. Mirrors the Rust `decimate`.
 */
export function decimate(value: unknown, maxPoints: number): unknown {
  const n = Math.max(2, Math.floor(maxPoints));
  if (Array.isArray(value)) {
    if (value.length > n) {
      const step = (value.length - 1) / (n - 1);
      const out: unknown[] = [];
      for (let index = 0; index < n; index++) {
        out.push(decimate(value[Math.round(index * step)], n));
      }
      return out;
    }
    return value.map((item) => decimate(item, n));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = decimate(item, n);
    }
    return out;
  }
  return value;
}
