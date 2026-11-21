/**
 * Geometry for the custom `ScrollArea` (`components/ScrollArea.tsx`).
 *
 * Pure, so the part that is easy to get subtly wrong — keeping the scroll offset inside
 * the content when the content shrinks (a filtered list) — is unit-tested in
 * `src/tests/scroll.test.ts`.
 */

/**
 * Clamp a scroll offset so it stays inside the content.
 *
 * `scrollHeight` / `clientHeight` are the content's and the viewport's heights. When the
 * content is no taller than the viewport the only valid offset is `0`, so a list that is
 * filtered down never stays scrolled past its new end. A negative or `NaN` offset reads
 * as the top; an infinite one as the furthest the content scrolls.
 */
export function clampScrollTop(top: number, scrollHeight: number, clientHeight: number): number {
  if (Number.isNaN(top)) return 0;
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.max(0, Math.min(top, max));
}
