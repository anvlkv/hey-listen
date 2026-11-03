import { createEffect, createRoot, createSignal } from "solid-js";
import type { Annotation } from "../../bindings/Annotation";
import { analyzerBus } from "../chartSync";
import { annotationsPanelOpen } from "../settings";

export const [annotations, setAnnotations] = createSignal<Annotation[]>([]);
export const [selectedAnnotationId, setSelectedAnnotationId] = createSignal<string | null>(null);
/** The annotation whose inline editor is open (panel-level, so create can open it). */
export const [editingAnnotationId, setEditingAnnotationId] = createSignal<string | null>(null);

// Publish to the shared chart bus whenever the annotations, the selection or the panel change.
createRoot(() => {
  createEffect(() => {
    analyzerBus.setData("annotations", {
      annotations: annotations(),
      selectedId: selectedAnnotationId(),
      panelOpen: annotationsPanelOpen(),
    });
  });

  // The **selected** annotation is a panel concept: with the rail closed there is no row to
  // highlight and no label to read, so clear the selection. That also clears every chart's
  // full-height overlay and the Timeline's selected stem; the lane anchors stay behind,
  // drawn dull (see `analyzer/annotationPlugins.ts` and `timeline/draw.ts`).
  createEffect(() => {
    if (!annotationsPanelOpen()) setSelectedAnnotationId(null);
  });
});
