/**
 * The synth tab's **Live** switch, shared by the specs that drive synth rendering.
 *
 * Live is app-level chrome persisted in `localStorage`, so the app instance a run reuses
 * can still be Live-on from an earlier spec (or from the developer's own session). A
 * spec that renders the synth graph on its own terms must first make sure Live is off,
 * or a settled graph edit re-renders behind its back.
 */
import { SEL } from "./selectors.ts";
import { click, count, waitFor } from "./dom.ts";

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
  // The tab strip appears before the tab's content mounts, so give the switch a moment to
  // exist; its continued absence means no synth tab is open (nothing to quiet).
  for (let waited = 0; waited < 5_000 && (await count(SEL.synthLive)) === 0; waited += 50) {
    await browser.pause(50);
  }
  if ((await count(SEL.synthLive)) === 0) return;
  if (!(await liveOn())) return;
  await click(SEL.synthLive);
  await waitFor(async () => !(await liveOn()), "the synth Live switch did not turn off");
}
