/**
 * The analysis window a project **save** persists.
 *
 * Curating annotations while listening to a fragment (a shrunk analysis window) must not
 * leave the saved project framed on that fragment: a save that carries annotations stores
 * the whole source, so a later comparison or headless analysis runs over the recording
 * rather than a sub-span of it. A project without annotations keeps whatever window the
 * user has (see `docs/annotations.md` → Surfacing; hey-listen-report §6.6).
 *
 * Pure, so the decision is unit-tested in `src/tests/saveWindow.test.ts`.
 */

/** Tolerance for "already the whole source" (seconds). */
const WHOLE_SOURCE_EPSILON = 1e-3;

export function windowForSave(
  start: number,
  end: number,
  duration: number,
  hasAnnotations: boolean,
): { startSecs: number; endSecs: number } {
  const coversWholeSource =
    !(duration > 0) || (start <= WHOLE_SOURCE_EPSILON && end >= duration - WHOLE_SOURCE_EPSILON);
  if (!hasAnnotations || coversWholeSource) {
    return { startSecs: start, endSecs: end };
  }
  return { startSecs: 0, endSecs: duration };
}
