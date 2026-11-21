import { afterEach, expect, it, vi } from "vitest";
import {
  LIVE_MAX_SECONDS,
  createSynthDebounce,
  liveRenderSeconds,
  needsSynthConfirmation,
} from "../lib/synthPlan";

/**
 * Unit checks for the synth Live scheduler's pure decisions (M22): the length one
 * render asks for, its cap, first-adoption confirmation, and the latest-wins debounce.
 */

afterEach(() => {
  vi.useRealTimers();
});

it("asks for the requested length, capped for responsiveness", () => {
  expect(liveRenderSeconds(4)).toBe(4);
  expect(liveRenderSeconds(30)).toBe(LIVE_MAX_SECONDS);
});

it("keeps a tiny or non-finite length usable", () => {
  expect(liveRenderSeconds(0)).toBe(0.1);
  expect(liveRenderSeconds(Number.NaN)).toBe(4);
});

it("confirms only when a non-synth source would be replaced", () => {
  expect(needsSynthConfirmation(null)).toBe(false);
  expect(needsSynthConfirmation({ origin: "synth" })).toBe(false);
  expect(needsSynthConfirmation({})).toBe(true);
});

it("debounces to the latest settle", () => {
  vi.useFakeTimers();
  const seen: number[] = [];
  const debounce = createSynthDebounce((token) => seen.push(token), 100);

  debounce.schedule();
  debounce.schedule();
  vi.advanceTimersByTime(99);
  expect(seen).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(seen).toEqual([2]);

  // A newer settle makes the finished one stale, so its render is discarded.
  expect(debounce.isCurrent(2)).toBe(true);
  debounce.schedule();
  expect(debounce.isCurrent(2)).toBe(false);
  vi.advanceTimersByTime(100);
  expect(seen).toEqual([2, 3]);
});

it("cancel drops the pending render", () => {
  vi.useFakeTimers();
  const seen: number[] = [];
  const debounce = createSynthDebounce((token) => seen.push(token), 100);
  debounce.schedule();
  debounce.cancel();
  vi.advanceTimersByTime(100);
  expect(seen).toEqual([]);
});
