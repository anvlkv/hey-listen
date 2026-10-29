import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { invoke } from "../../lib/ipc";
import { engineOptions, type AnalyzerId } from "../analyzer";
import {
  channel,
  fftSize,
  freqMaxHz,
  freqMinHz,
  hop,
  randomizedOverlap,
  resampleTo,
  sharedParams,
  windowFn,
} from "../analysis";
import { filterRevision } from "../graph";
import { source, status } from "../source";
import { windowEnd, windowStart } from "../timeline";
import type { ComparisonDto, PeerSetupDto } from "./types";

/**
 * One comparison's compute (M25).
 *
 * A's setup comes from this window's stores; B's from `compare_peer_setup` (the
 * reference project's shared UI state). The request is debounced (~200 ms) and
 * latest-wins, and re-runs when the peer's revision changes — so a drag in either
 * project settles into one comparison instead of queuing one per pointer event.
 * The UI asks for **full** arrays, because the charts need them.
 */

/** Trailing debounce for a re-run, in ms. */
const DEBOUNCE_MS = 200;

export interface CompareHandle {
  comparison: () => ComparisonDto | null;
  error: () => string | null;
  loading: () => boolean;
  /** Re-run now (bypassing the debounce). */
  refresh: () => void;
}

/** A reactive handle over one comparison: A × B for `tool`. */
export function createComparison(
  tool: AnalyzerId,
  reference: () => string | null,
  revision: () => number | null,
): CompareHandle {
  const [comparison, setComparison] = createSignal<ComparisonDto | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  let generation = 0;
  let timer: number | undefined;

  async function run() {
    const ref = reference();
    if (!ref) {
      generation++;
      setComparison(null);
      setError(null);
      setLoading(false);
      return;
    }
    const token = ++generation;
    setLoading(true);
    try {
      // B's window/params/options and shape, from the reference project.
      const peer = await invoke<PeerSetupDto>("compare_peer_setup", { reference: ref, tool });
      if (token !== generation) return;

      const request = {
        tool,
        reference: ref,
        a: {
          start: windowStart(),
          end: windowEnd(),
          params: sharedParams(),
          options: engineOptions(tool),
        },
        b: {
          start: peer.window.start,
          end: peer.window.end,
          params: peer.params,
          options: peer.options,
        },
        shape: "full",
      };
      const reply = await invoke<ComparisonDto>("run_comparison", { request });
      if (token !== generation) return;
      setComparison(reply);
      setError(null);
    } catch (err) {
      if (token !== generation) return;
      setError(String(err));
    } finally {
      if (token === generation) setLoading(false);
    }
  }

  function schedule() {
    if (timer != undefined) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      void run();
    }, DEBOUNCE_MS);
  }

  createEffect(
    on(
      [
        source,
        status,
        windowStart,
        windowEnd,
        channel,
        fftSize,
        hop,
        randomizedOverlap,
        windowFn,
        resampleTo,
        freqMinHz,
        freqMaxHz,
        filterRevision,
        () => engineOptions(tool),
        reference,
        revision,
      ],
      () => schedule(),
    ),
  );

  onCleanup(() => {
    generation++;
    if (timer != undefined) clearTimeout(timer);
  });

  return { comparison, error, loading, refresh: () => void run() };
}
