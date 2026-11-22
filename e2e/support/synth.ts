/**
 * The synth tab's **Live** switch, shared by the specs that drive synth rendering.
 *
 * Live is app-level chrome persisted in `localStorage`, so the app instance a run reuses
 * can still be Live-on from an earlier spec (or from the developer's own session). A
 * spec that renders the synth graph on its own terms must first make sure Live is off,
 * or a settled graph edit re-renders behind its back.
 */
import { SEL } from "./selectors.ts";
import { click, count } from "./dom.ts";

/** Whether the Live switch reads on (Kobalte marks its hidden input `data-checked`). */
export async function liveOn(): Promise<boolean> {
  return (await browser.execute((sel: string) => {
    const input = document.querySelector(sel);
    return !!input && input.hasAttribute("data-checked");
  }, SEL.synthLive)) as boolean;
}

/**
 * Leave the synth tab quiet: no Live re-render after this point.
 *
 * A no-op when the synth tab is not open (the switch does not exist). Call it *after*
 * opening the tab, so a switch left on cannot keep overwriting the source.
 */
export async function quietSynthLive(): Promise<void> {
  if ((await count(SEL.synthLive)) === 0) return;
  if (await liveOn()) await click(SEL.synthLive);
}
