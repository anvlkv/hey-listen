import type { AnalysisWindow } from "../../bindings/AnalysisWindow";
import type { Note } from "../../bindings/Note";
import { isAnalyzerId } from "../analyzer";
import { noteById } from "../notes";
import { themeById } from "../themes";
import type { ToolId } from "../workbench";

export type Args = Record<string, unknown>;

export function asArgs(value: unknown): Args {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("arguments must be an object");
  }
  return value as Args;
}

export function str(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`\`${key}\` is required`);
  }
  return value;
}

export function optionalStr(args: Args, key: string): string | null {
  const value = args[key];
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`\`${key}\` must be a string`);
  return value;
}

export function num(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`\`${key}\` must be a finite number`);
  }
  return value;
}

export function optionalNum(args: Args, key: string): number | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`\`${key}\` must be a finite number`);
  }
  return value;
}

export function bool(args: Args, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") throw new Error(`\`${key}\` must be a boolean`);
  return value;
}

export function optionalBool(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== "boolean") throw new Error(`\`${key}\` must be a boolean`);
  return value;
}

/** Set a nullable string field (a device id), but only when the agent supplied it. */
export function applyNullable(args: Args, key: string, set: (value: string | null) => void) {
  if (key in args) set(optionalStr(args, key));
}

/** Set a nullable numeric field (a process id), but only when the agent supplied it. */
export function applyPid(args: Args, key: string, set: (value: number | null) => void) {
  if (key in args) set(optionalNum(args, key) ?? null);
}

export function analyzerId(args: Args) {
  const tool = str(args, "tool");
  if (!isAnalyzerId(tool)) throw new Error(`unknown analyzer: ${tool}`);
  return tool;
}

export function toolId(id: string): ToolId {
  if (id !== "filter" && id !== "synth" && !isAnalyzerId(id)) {
    throw new Error(`unknown tool: ${id}`);
  }
  return id as ToolId;
}

/** One note by id, or a thrown error (the MCP tools fail loudly on a bad id). */
export function requireNote(id: string): Note {
  const note = noteById(id);
  if (!note) throw new Error(`unknown note: ${id}`);
  return note;
}

/** Read a note range argument (`{ startSecs, endSecs }`) or `null`. */
export function rangeArg(value: unknown): AnalysisWindow | null {
  if (value == null) return null;
  const object = asArgs(value);
  return { startSecs: num(object, "startSecs"), endSecs: num(object, "endSecs") };
}

export function graphKind(args: Args): "filter" | "synth" {
  const graph = str(args, "graph");
  if (graph !== "filter" && graph !== "synth") {
    throw new Error(`\`graph\` must be "filter" or "synth"`);
  }
  return graph;
}

/** Read a slot theme id, validating it names a registered theme. */
export function slotThemeId(args: Args, key: string): string {
  const id = str(args, key);
  if (!themeById(id)) throw new Error(`unknown theme: ${id} (see list_themes)`);
  return id;
}
