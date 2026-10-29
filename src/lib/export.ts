/**
 * Analysis exports (M12): the frontend half of `docs/exports.md`.
 *
 * The **rendering** (provenance envelope + wide-matrix CSV) happens in Rust, shared
 * with the MCP server and the batch CLI, so the app never re-implements the formats.
 * This module owns the interactive parts: gather the current source/window/params,
 * pick a destination, write text/bytes, and capture the rendered chart canvas.
 */
import { writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import type { ExportArgs } from "../bindings/ExportArgs";
import type { ExportedAnalysis } from "../bindings/ExportedAnalysis";
import type { ExportSource } from "../bindings/ExportSource";
import type { ToolOptions } from "../bindings/ToolOptions";
import { invoke } from "./ipc";
import { sharedParams } from "../state/analysis";
import { engineOptions, isAnalyzerId, type AnalyzerId } from "../state/analyzer";
import { chartPng } from "../state/exportRegistry";
import { currentDescriptor } from "../state/project/snapshot";
import { source } from "../state/source";
import { windowEnd, windowStart } from "../state/timeline";
import { openTools } from "../state/workbench";

export type ExportFormatName = "json" | "csv";

/** One written analysis export. */
export interface ExportOutcome {
  tool: AnalyzerId;
  format: ExportFormatName;
  path: string;
  /** The CSV provenance sidecar, when one was written. */
  sidecarPath: string | null;
}

/** One file written by "export all open analyses". */
export interface ExportedFile {
  tool: string;
  format: ExportFormatName;
  path: string;
  sidecarPath?: string;
}

/** The source's provenance for the envelope (name, kind, rate, duration, path). */
function sourceInfo(): ExportSource {
  const current = source();
  if (!current) throw new Error("Open an audio source first");
  const descriptor = currentDescriptor();
  return {
    name: current.name,
    kind: descriptor?.kind ?? "file",
    sampleRate: current.sampleRate,
    channels: current.channels,
    duration: current.duration,
    path: descriptor?.path ?? null,
  };
}

/**
 * Re-run `tool` over the current window and render it (no file is written). This is
 * the same analysis the tab shows, at the settings in effect now.
 */
export function renderAnalysis(
  tool: AnalyzerId,
  format: ExportFormatName,
): Promise<ExportedAnalysis> {
  const args: ExportArgs = {
    tool,
    start: windowStart(),
    end: windowEnd(),
    params: sharedParams(),
    options: engineOptions(tool) as ToolOptions,
    source: sourceInfo(),
    format,
  };
  return invoke<ExportedAnalysis>("export_analysis", { args });
}

/**
 * Save one analysis as JSON or CSV. Without `path`, the native save dialog opens;
 * `null` means the user cancelled. CSV writes its `.meta.json` sidecar by default.
 */
export async function exportAnalysis(
  tool: AnalyzerId,
  format: ExportFormatName,
  options: { path?: string; includeSidecar?: boolean } = {},
): Promise<ExportOutcome | null> {
  const rendered = await renderAnalysis(tool, format);
  const path =
    options.path ??
    (await invoke<string | null>("pick_save_path", {
      kind: format,
      defaultName: rendered.fileName,
    }));
  if (!path) return null;

  await invoke("write_text", { path, contents: rendered.text });
  let sidecarPath: string | null = null;
  if (format === "csv" && rendered.sidecar && (options.includeSidecar ?? true)) {
    sidecarPath = sidecarPathFor(path);
    await invoke("write_text", { path: sidecarPath, contents: rendered.sidecar });
  }
  return { tool, format, path, sidecarPath };
}

/**
 * Save a tab's chart as a PNG. Without `path`, the native save dialog opens; `null`
 * means the user cancelled, and a tool without a chart (the readouts) throws so the
 * menu can explain why.
 */
export async function exportChart(tool: AnalyzerId, path?: string): Promise<string | null> {
  const blob = await chartPng(tool);
  if (!blob) {
    throw new Error("This analysis has no chart to export — open the tab to draw it first");
  }
  const target =
    path ??
    (await invoke<string | null>("pick_save_path", {
      kind: "png",
      defaultName: chartFileName(tool),
    }));
  if (!target) return null;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  await invoke("write_bytes", { path: target, data: toBase64(bytes) });
  return target;
}

/** Write every open analysis tab (JSON + CSV by default) to a folder. */
export async function exportAllOpenAnalyses(
  options: {
    tools?: AnalyzerId[];
    dir?: string;
    formats?: ExportFormatName[];
  } = {},
): Promise<{ dir: string; files: ExportedFile[] } | null> {
  const tools =
    options.tools ?? openTools().filter((tool): tool is AnalyzerId => isAnalyzerId(tool));
  if (tools.length === 0) throw new Error("No analysis tabs are open");

  const dir =
    options.dir ??
    (await invoke<string | null>("pick_directory", {
      title: "Export all open analyses",
    }));
  if (!dir) return null;

  const toolOptions: Record<string, ToolOptions> = {};
  for (const tool of tools) toolOptions[tool] = engineOptions(tool) as ToolOptions;

  return invoke<{ dir: string; files: ExportedFile[] }>("export_all", {
    args: {
      dir,
      tools,
      formats: options.formats ?? ["json", "csv"],
      start: windowStart(),
      end: windowEnd(),
      params: sharedParams(),
      options: toolOptions,
      source: sourceInfo(),
    },
  });
}

/** Copy a tool's CSV to the system clipboard (the plugin, not the flaky WebView API). */
export async function copyAnalysisCsv(tool: AnalyzerId): Promise<string> {
  const rendered = await renderAnalysis(tool, "csv");
  await writeClipboardText(rendered.text);
  return rendered.text;
}

/** `mix.spectrum.csv` → `mix.spectrum.meta.json` (mirrors the Rust sidecar path). */
export function sidecarPathFor(path: string): string {
  return `${path.replace(/\.[^./\\]+$/, "")}.meta.json`;
}

/** A suggested PNG name, mirroring the Rust data-export naming. */
function chartFileName(tool: AnalyzerId): string {
  const name = source()?.name ?? "audio";
  const stem =
    name
      .replace(/\.[^./\\]+$/, "")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "export";
  return `${stem}.${tool}.png`;
}

/** Base64 without spreading a large buffer into one call (keeps the UI responsive). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
