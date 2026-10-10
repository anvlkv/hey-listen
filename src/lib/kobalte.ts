/**
 * Helpers for the Kobalte-backed form primitives.
 */

/**
 * Unwrap the value Kobalte passes to a single-select `onChange`. The callback type
 * is shared with multi-select (`T | T[]`), so a single selection arrives as `T` but
 * is typed `T | T[]`. Return the first item, or `undefined` for a nullish value.
 */
export function unwrapSingle<T>(value: T | T[] | null | undefined): T | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
