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
import { openCompare } from "../compare/views";
import { source } from "../source";
import { windowEnd, windowStart } from "../timeline";
import { asArgs, optionalBool, optionalNum, str, type Args } from "./args";

/**
 * `compare_analysis` (M25): diff the same analyzer across two live projects.
 *
 * A is the project this frontend drives (`target`); B is the `with` reference label.
 * Both run in the core, each through the normal `run_window` path with its own PCM
 * and filter. The result is `{ tool, a, b, comparability, diff }`, shaped like
 * `run_analysis` (`summaryOnly` / `includeData` / `maxPoints` / `axis`). B is never
 * changed. See `docs/comparison.md` → "MCP".
 */
export async function compareAnalysis(args: Args) {
  const tool = str(args, "tool");
  if (!isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);
  const reference = str(args, "with");

  const summaryOnly = optionalBool(args, "summaryOnly") ?? false;
  const includeData = optionalBool(args, "includeData") ?? false;
  if (summaryOnly && includeData) {
    throw new Error("`summaryOnly` and `includeData` are mutually exclusive");
  }
  if (!source()) throw new Error("no source loaded in this project — open a source first");

  // B's window/params/options and shape, from the reference project.
  const peer = await invoke<PeerSetupDto>("compare_peer_setup", { reference, tool });

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
  const b: CompareSetupDto = {
    start: peer.window.start,
    end: peer.window.end,
    params: peer.params,
    options: peer.options,
  };

  const shape = summaryOnly ? "summary" : includeData ? "full" : "compact";
  const maxPoints = optionalNum(args, "maxPoints");
  const compactAxis = args.axis === "compact";

  // UI following: open/focus the compare view, which now charts every family (M25.A).
  if (optionalBool(args, "display") ?? true) {
    await openCompare(tool, reference);
  }

  return invoke("run_comparison", {
    request: {
      tool,
      reference,
      a,
      b,
      shape,
      ...(maxPoints != null ? { maxPoints } : {}),
      ...(compactAxis ? { compactAxis: true } : {}),
    },
  });
}
