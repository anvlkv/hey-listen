import { createEffect, onCleanup } from "solid-js";
import { createAnalysis, type PitchResult, type SpectrogramResult } from "../../state/analyzer";
import { composePitchOverlay } from "./pitchOverlay";
import type { PitchOverlay } from "./spectrogramRender";

/**
 * The pitch track a spectrogram composes on demand (M36).
 *
 * It lives in its own component so the extra `pitchPyin` run only happens while the
 * overlay is switched on: `SpectrogramTab` mounts this under a `Show`, and unmounting
 * cancels the run (`createAnalysis` bumps its generation and drops the pending result).
 * The composed overlay is handed back through `onOverlay`, never re-derived from the
 * heatmap.
 */
export default function PitchOverlaySource(props: {
  spectrogram: () => SpectrogramResult | null;
  onOverlay: (overlay: PitchOverlay | null) => void;
}) {
  const pitch = createAnalysis<PitchResult>("pitchPyin");

  createEffect(() => {
    props.onOverlay(composePitchOverlay(pitch.result(), props.spectrogram()));
  });
  onCleanup(() => props.onOverlay(null));

  return null;
}
