import { invoke } from "../../lib/ipc";

/**
 * Open an annotation in its own **window** (M14).
 *
 * Like an analyzer popout (ADR-11), the annotation window is a *view* of the same project,
 * not a project of its own: the core creates the window and aliases it to the calling
 * window's project state, and the frontend renders just that annotation's editor. An annotation
 * that already has a window is **raised** rather than opened twice, the same rule the
 * analyzer tabs follow. See `docs/annotations.md` → The Annotations panel.
 */
export async function openAnnotationWindow(annotationId: string): Promise<void> {
  try {
    await invoke("open_annotation_window", { annotationId });
  } catch (err) {
    console.error("could not open the annotation window", err);
  }
}
