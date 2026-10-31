import { invoke } from "../../lib/ipc";
import {
  applyOptionPatch,
  engineOptions,
  isAnalyzerId,
  setToolOption,
  toolOptions,
} from "../analyzer";
import { sharedParams } from "../analysis";
import type { CompareSetupDto, PeerSetupDto } from "../compare/types";
import { openCompare, openCompareSaved } from "../compare/views";
import { source } from "../source";
import { windowEnd, windowStart } from "../timeline";
import { asArgs, optionalBool, optionalNum, str, type Args } from "./args";

/**
 * `compare_analysis` (M25; saved references in M25.C): diff the same analyzer across
 * two live projects, or against the owner's saved snapshot.
 *
 * A is the project this frontend drives (`target`); B is the `with` reference label or,
 * with `saved: true`, the project's stored reference side. Both run in the core, each
 * through the normal `run_window` path with its own PCM and filter. The result is
 * `{ tool, a, b, comparability, diff }`, shaped like `run_analysis` (`summaryOnly` /
 * `includeData` / `maxPoints` / `axis`). B is never changed.
 * See `docs/comparison.md` → "MCP".
 */
export async function compareAnalysis(args: Args) {
  const tool = str(args, "tool");
  if (!isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);
  const saved = optionalBool(args, "saved") ?? false;
  if (!saved && !("with" in args)) {
    throw new Error("`with` (a reference project label) is required unless `saved: true`");
  }
  const reference = saved ? "" : str(args, "with");

  const summaryOnly = optionalBool(args, "summaryOnly") ?? false;
  const includeData = optionalBool(args, "includeData") ?? false;
  if (summaryOnly && includeData) {
    throw new Error("`summaryOnly` and `includeData` are mutually exclusive");
  }
  if (!source()) throw new Error("no source loaded in this project — open a source first");

  // A's options: an MCP options patch writes back to A's stores, exactly as
  // `run_analysis` does; the engine-only view is what crosses IPC.
  if ("options" in args) {
    const patch = applyOptionPatch(tool, asArgs(args.options));
    for (const [key, value] of Object.entries(patch)) setToolOption(tool, key, value);
  }
  const a: CompareSetupDto = {
    start: windowStart(),
    end: windowEnd(),
    params: sharedParams(),
    options: engineOptions(tool, toolOptions[tool]),
  };

  // B is a live project (its setup comes from `compare_peer_setup`) or the stored
  // snapshot (the core fills B; nothing to fetch here).
  let b: CompareSetupDto | undefined;
  if (!saved) {
    const peer = await invoke<PeerSetupDto>("compare_peer_setup", { reference, tool });
    b = {
      start: peer.window.start,
      end: peer.window.end,
      params: peer.params,
      options: peer.options,
    };
  }

  const shape = summaryOnly ? "summary" : includeData ? "full" : "compact";
  const maxPoints = optionalNum(args, "maxPoints");
  const compactAxis = args.axis === "compact";
  // For a saved reference an omitted offset means "use the snapshot's offset".
  const bOffset = optionalNum(args, "bOffset");

  // UI following: open/focus the compare view, which charts every family (M25.A).
  if (optionalBool(args, "display") ?? true) {
    if (saved) await openCompareSaved(tool);
    else await openCompare(tool, reference);
  }

  return invoke("run_comparison", {
    request: {
      tool,
      ...(saved ? { saved: true } : { reference, b }),
      a,
      ...(bOffset != null ? { bOffset } : {}),
      shape,
      ...(maxPoints != null ? { maxPoints } : {}),
      ...(compactAxis ? { compactAxis: true } : {}),
    },
  });
}
