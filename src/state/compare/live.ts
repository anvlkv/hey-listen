import { createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "../../lib/ipc";
import type { CompareLiveDto, LiveSideDto } from "./types";

/**
 * Live peer state for a compare view (M25).
 *
 * Polled at ~20 Hz while the view is mounted: both **playheads** (read from each
 * project's core `Playback`, which is what lets a compare *popout* show them — it has
 * no Timeline), the reference's time / frequency / modulation-rate cursor, and a
 * `revision` bumped by any peer UI or audio change. A settled revision re-runs the
 * comparison; being polled, it never needs to read the peer's whole setup.
 *
 * Responses are **latest-wins**: a slow reply that arrives after a newer request is
 * dropped, so a stalled IPC call cannot rewind the markers. See
 * `docs/comparison.md` → "Live state (both sides)".
 */

/** Poll interval (~20 Hz). */
const POLL_MS = 50;

/** A latest-wins gate for polling: only the newest request may apply its reply. */
export function createPollGate() {
  let sequence = 0;
  return {
    /** Start a request, returning its token. */
    begin: () => ++sequence,
    /** Whether `token` is still the newest request. */
    accept: (token: number) => token === sequence,
  };
}

const EMPTY: LiveSideDto = { playhead: null, cursorTime: null, cursorFreq: null, cursorMod: null };

export interface CompareLiveHandle {
  a: () => LiveSideDto;
  b: () => LiveSideDto;
  /** False once the reference project is closed (the last result stays on screen). */
  open: () => boolean;
  /** The peer's revision, or `null` until the first open reply. */
  revision: () => number | null;
  error: () => string | null;
  /** Poll immediately (after a change the caller knows about). */
  refresh: () => void;
}

/** Poll the reference project's live markers while the component is mounted. */
export function createCompareLive(reference: () => string | null): CompareLiveHandle {
  const [a, setA] = createSignal<LiveSideDto>(EMPTY);
  const [b, setB] = createSignal<LiveSideDto>(EMPTY);
  const [open, setOpen] = createSignal(true);
  const [revision, setRevision] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const gate = createPollGate();
  let inflight = false;
  let stopped = false;
  let timer: number | undefined;

  async function tick() {
    const ref = reference();
    if (stopped || !ref || inflight) return;
    inflight = true;
    const token = gate.begin();
    try {
      const reply = await invoke<CompareLiveDto>("compare_live", { reference: ref });
      if (stopped || !gate.accept(token)) return;
      setA(reply.a);
      setB(reply.b);
      setOpen(reply.open);
      setError(null);
      // A closed reference keeps the last revision, so the view does not re-run (and
      // wipe the last result) — it shows the "Reference project closed" banner.
      if (reply.open) setRevision(reply.revision);
    } catch (err) {
      if (stopped || !gate.accept(token)) return;
      setOpen(false);
      setError(String(err));
    } finally {
      inflight = false;
    }
  }

  onMount(() => {
    timer = window.setInterval(() => void tick(), POLL_MS);
    void tick();
  });

  onCleanup(() => {
    stopped = true;
    if (timer != undefined) window.clearInterval(timer);
  });

  return { a, b, open, revision, error, refresh: () => void tick() };
}
