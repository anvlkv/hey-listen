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
import type { CompareSetupDto, ComparisonDto, PeerSetupDto } from "./types";
import type { CompareBinding } from "./views";
import { setCompareFingerprint } from "./views";

/**
 * One comparison's compute (M25; saved references in M25.C).
 *
 * A's setup comes from this window's stores; B's from `compare_peer_setup` (a live
 * reference project) or from the core's **saved snapshot** (M25.C, no second window).
 * The request is debounced (~200 ms) and latest-wins, and re-runs when the peer's
 * revision changes — so a drag in either project settles into one comparison instead
 * of queuing one per pointer event. The UI asks for **full** arrays, because the
 * charts need them.
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

/** A reactive handle over one comparison: A × (live B | saved B) for `tool`. */
export function createComparison(
  tool: AnalyzerId,
  binding: () => CompareBinding | null,
  revision: () => number | null,
  /** The fine-tune offset δ: positive moves the reference later (M25.B). */
  bOffset: () => number = () => 0,
): CompareHandle {
  const [comparison, setComparison] = createSignal<ComparisonDto | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  let generation = 0;
  let timer: number | undefined;

  /** A's setup, read from this window's stores. */
  function setupA(): CompareSetupDto {
    return {
      start: windowStart(),
      end: windowEnd(),
      params: sharedParams(),
      options: engineOptions(tool),
    };
  }

  async function run() {
    const target = binding();
    if (!target) {
      generation++;
      setComparison(null);
      setError(null);
      setLoading(false);
      return;
    }
    // A popout starts with an empty analysis window (0..0) until its shared timeline
    // arrives from the core; running here would fail with "the analysis window is
    // empty". Skip instead — `windowStart`/`windowEnd` are effect dependencies, so the
    // comparison runs again the moment the window is set.
    if (windowEnd() <= windowStart()) {
      return;
    }
    const token = ++generation;
    setLoading(true);
    try {
      const a = setupA();
      const request: Record<string, unknown> = {
        tool,
        a,
        bOffset: bOffset(),
        shape: "full",
      };
      if (target.kind === "saved") {
        request.saved = true;
      } else {
        // B's window/params/options and shape, from the reference project.
        const peer = await invoke<PeerSetupDto>("compare_peer_setup", {
          reference: target.reference,
          tool,
        });
        if (token !== generation) return;
        request.reference = target.reference;
        request.b = {
          start: peer.window.start,
          end: peer.window.end,
          params: peer.params,
          options: peer.options,
        };
      }
      const reply = await invoke<ComparisonDto>("run_comparison", { request });
      if (token !== generation) return;
      setComparison(reply);
      setError(null);
      // The core recorded this result as the saved snapshot; its content fingerprint
      // is part of the project's dirty signature (M25.C).
      if (reply.savedFingerprint) setCompareFingerprint(tool, reply.savedFingerprint);
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
        binding,
        revision,
        bOffset,
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
