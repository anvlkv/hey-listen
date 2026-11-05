import type { CachedResultInput } from "../../bindings/CachedResultInput";
import type { CachedResultOutput } from "../../bindings/CachedResultOutput";
import type { SharedParams } from "../../bindings/SharedParams";
import type { JsonValue } from "../../bindings/serde_json/JsonValue";
import { toSpec } from "../../lib/graph";
import { filterActive, FILTER_GRAPH } from "../graph";
import { source, type AudioSource } from "../source";
import type { AnalyzerId, AnyAnalysisResult } from "./types";

/**
 * The analyzer result cache — one entry per tool for the current source **and** the
 * applied filter, so a tab adopts a known result instead of re-running the analyzer.
 *
 * The key carries the source's identity (a token assigned per `AudioSource` object)
 * and the filter, so replacing either never matches an older entry: clearing is
 * implicit and no effect can drop a cache the project loader just seeded
 * (`state/project/load.ts`). The same entries are what `save_project` writes to the
 * file's `RESULTS` section and what a loaded project restores.
 */

/** One cached result, with the inputs that key it. */
export interface CachedResult {
  tool: AnalyzerId;
  start: number;
  end: number;
  params: SharedParams;
  options: Record<string, number>;
  result: AnyAnalysisResult;
}

/** The inputs [`resultCacheKey`] derives a key from. */
export interface ResultCacheKeyInput {
  tool: AnalyzerId;
  start: number;
  end: number;
  params: SharedParams;
  options: Record<string, number>;
}

/** Source identity: every `AudioSource` object gets its own token, once. */
let nextSourceToken = 1;
const sourceTokens = new WeakMap<AudioSource, number>();

function sourceToken(current: AudioSource | null): number | null {
  if (!current) return null;
  const assigned = sourceTokens.get(current);
  if (assigned != null) return assigned;
  const token = nextSourceToken++;
  sourceTokens.set(current, token);
  return token;
}

/** The applied filter as one canonical string (`""` when no filter is applied). */
function appliedFilterKey(): string {
  return filterActive() ? JSON.stringify(toSpec(FILTER_GRAPH.nodes, FILTER_GRAPH.edges)) : "";
}

/** The shared params in a fixed field order, so the key does not depend on key order. */
function paramsKey(params: SharedParams): string {
  return JSON.stringify([
    params.fftSize,
    params.hop,
    params.randomizedOverlap,
    params.windowFn,
    params.channel,
    params.resampleTo,
    params.freqMinHz,
    params.freqMaxHz,
  ]);
}

/** The per-tool options sorted by key, so their insertion order does not matter. */
function optionsKey(options: Record<string, number>): string {
  return JSON.stringify(
    Object.keys(options)
      .sort()
      .map((key) => [key, options[key]]),
  );
}

/** The values every entry is filed under: the current source and applied filter. */
function identity(): { token: number; filter: string } | null {
  const token = sourceToken(source());
  return token == null ? null : { token, filter: appliedFilterKey() };
}

/** The key for a result: every input that changes what `run_analysis` returns. */
export function resultCacheKey(input: ResultCacheKeyInput): string | null {
  const current = identity();
  if (!current) return null;
  return JSON.stringify([
    input.tool,
    input.start,
    input.end,
    current.token,
    current.filter,
    paramsKey(input.params),
    optionsKey(input.options),
  ]);
}

interface CacheSlot {
  /** The key the entry was computed under (it carries the source + filter identity). */
  key: string;
  entry: CachedResult;
}

/** One entry per tool: new inputs replace that tool's previous result. */
const slots = new Map<AnalyzerId, CacheSlot>();

/** The cached entry for `key`, or `null` (no source ⇒ no key ⇒ no hit). */
export function cachedResult(key: string | null): CachedResult | null {
  if (key == null) return null;
  for (const slot of slots.values()) {
    if (slot.key === key) return slot.entry;
  }
  return null;
}

/**
 * Cache a freshly computed result under the `key` it was **requested** with.
 *
 * The caller snapshots the key before the invoke: the source or filter may change
 * while the request is in flight, and recomputing here would file the old result
 * under the new source (a stale hit later). A key that no longer matches the current
 * identity is simply never consulted, and [`currentResults`] drops it from a save.
 */
export function storeResult(entry: CachedResult, key: string) {
  slots.set(entry.tool, { key, entry });
}

/**
 * File a loaded project's cached results under the current source + filter, so the
 * analyzers adopt them as soon as their tabs mount. An entry saved for a different
 * window or params simply never matches and is recomputed.
 */
export function seedResults(results: CachedResultOutput[]) {
  const current = identity();
  if (!current) return;
  for (const loaded of results) {
    const entry: CachedResult = {
      tool: loaded.tool,
      start: loaded.start,
      end: loaded.end,
      params: loaded.params,
      options: loaded.options,
      result: loaded.result,
    };
    const key = resultCacheKey(entry);
    if (key == null) continue;
    slots.set(entry.tool, { key, entry });
  }
}

/** The current source + filter's cached entries, as `save_project` takes them. */
export function currentResults(): CachedResultInput[] {
  if (identity() == null) return [];
  const saved: CachedResultInput[] = [];
  for (const slot of slots.values()) {
    // Only entries whose key still derives from the current source + filter.
    if (resultCacheKey(slot.entry) !== slot.key) continue;
    saved.push({
      tool: slot.entry.tool,
      start: slot.entry.start,
      end: slot.entry.end,
      params: slot.entry.params,
      options: slot.entry.options,
      result: slot.entry.result as unknown as JsonValue,
    });
  }
  return saved.sort((a, b) => a.tool.localeCompare(b.tool));
}
