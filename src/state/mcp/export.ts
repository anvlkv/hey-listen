import type { ExportFormatName } from "../../lib/export";
import { isAnalyzerId, type AnalyzerId } from "../analyzer";
import { optionalStr, type Args } from "./args";

/** `format` for `export_analysis`: `json` (default) or `csv`. */
export function exportFormat(args: Args): ExportFormatName {
  const format = optionalStr(args, "format") ?? "json";
  if (format !== "json" && format !== "csv") {
    throw new Error(`unknown format: ${format} (use json or csv)`);
  }
  return format;
}

/** `formats` for `export_all`: both when omitted. */
export function exportFormats(args: Args): ExportFormatName[] | undefined {
  const value = args.formats;
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error("`formats` must be an array");
  return value.map((item) => {
    if (item !== "json" && item !== "csv") {
      throw new Error(`unknown format: ${String(item)} (use json or csv)`);
    }
    return item;
  });
}

/** `tools` for `export_all`: the open tabs when omitted. */
export function exportTools(args: Args): AnalyzerId[] | undefined {
  const value = args.tools;
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error("`tools` must be an array");
  return value.map((item) => {
    if (typeof item !== "string" || !isAnalyzerId(item)) {
      throw new Error(`unknown analyzer: ${String(item)}`);
    }
    return item;
  });
}
