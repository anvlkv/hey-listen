/**
 * The IPC stub behind the preview surfaces.
 *
 * `preview.html` already replaces `window.__TAURI_INTERNALS__` with a null-resolving
 * stub, but the UI treats several empty replies as a missing list and logs (or throws)
 * on them, and analyzer tabs need a real result. This module installs the app's own
 * test seam (`setInvokeOverride`) and answers the handful of commands a rendered
 * surface actually reads — with the generated analysis fixtures for `run_analysis`.
 *
 * It is deliberately a **shape-complete null stub plus fixtures**, not a fake core:
 * anything not listed resolves to `null`, exactly as the preview shell already did.
 */

import type { AnalyzerId } from "../state/analyzer/types";
import type { AnalysisEntry } from "./compare";
import { comparisonFixture } from "./compare";
import type { InvokeHandler } from "../lib/ipc";
import { setInvokeOverride } from "../lib/ipc";
import { FIXTURE_SAMPLE_RATE, FIXTURE_SECONDS } from "./signal";

const FALLBACK_SUMMARY = (tool: string) => ({
  tool: tool as AnalyzerId,
  label: tool,
  text: "preview fixture",
  items: [],
});

function readTool(args: unknown): string | null {
  const request = (args as { request?: { tool?: unknown } } | undefined)?.request;
  return typeof request?.tool === "string" ? request.tool : null;
}

function reply(
  cmd: string,
  args: unknown,
  entries: Record<string, AnalysisEntry>,
  fixture: string,
): unknown {
  switch (cmd) {
    case "popout_tool":
      // `index.tsx` asks for the popout target before any component mounts. The
      // preview page's inline stub answers this too; this branch keeps the answer
      // correct if the fixture module happens to be evaluated first.
      return fixture === "popout" ? "spectrum" : null;
    case "run_analysis": {
      const tool = readTool(args);
      const entry = tool ? entries[tool] : undefined;
      return entry ?? { summary: FALLBACK_SUMMARY(tool ?? "waveform"), result: null };
    }
    case "run_comparison": {
      const tool = readTool(args);
      return tool ? comparisonFixture(entries, tool) : null;
    }
    case "get_ui_state":
      return { values: {}, revision: 0 };
    case "list_themes":
      return [];
    case "compare_targets":
    case "compare_saved":
    case "compare_popouts":
    case "popout_tools":
    case "list_output_devices":
    case "list_devices":
    case "list_processes":
    case "take_pending_open_paths":
      return [];
    case "adjacent_projects":
    case "adjacent_project":
    case "take_window_open_path":
    case "preview_position":
      return null;
    case "focus_popout":
      return false;
    case "e2e_enabled":
      // The preview shell is not an E2E run, so `index.tsx` must not load the plugin.
      return false;
    case "theme_dir":
      return "/tmp/hey-listen-themes";
    case "load_shared_source":
      return {
        sampleRate: FIXTURE_SAMPLE_RATE,
        channels: 1,
        frames: Math.round(FIXTURE_SAMPLE_RATE * FIXTURE_SECONDS),
        duration: FIXTURE_SECONDS,
      };
    case "get_mcp_status":
      return {
        enabled: false,
        port: 47100,
        listening: false,
        boundPort: null,
        error: null,
        warning: null,
        appBinary: null,
        bridgeBinary: null,
      };
    default:
      return null;
  }
}

/** Install the preview stub, serving `run_analysis` from the generated fixtures. */
export function installPreviewIpc(entries: Record<string, AnalysisEntry>, fixture: string) {
  const handler: InvokeHandler = async <T>(cmd: string, args?: unknown) =>
    reply(cmd, args, entries, fixture) as T;
  setInvokeOverride(handler);
}
