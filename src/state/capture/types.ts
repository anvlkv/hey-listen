import type { CaptureKind as GeneratedCaptureKind } from "../../bindings/CaptureKind";
import type { DeviceDto } from "../../bindings/DeviceDto";
import type { ProcessDto } from "../../bindings/ProcessDto";
import type { SourceKind } from "../../bindings/SourceKind";

/** Live source kinds, generated from the Rust `CaptureKind` (M15.B / ADR-28). */
export type CaptureKind = GeneratedCaptureKind;
/** Everything the source picker can choose, generated from the Rust `SourceKind`. */
export type SourceChoice = SourceKind;

export const KIND_LABEL: Record<CaptureKind, string> = {
  mic: "Microphone",
  system: "System audio",
  process: "Application",
  mix: "Mic + system",
};

/** Enumerated capture devices / processes (ts-rs bindings). */
export type DeviceInfo = DeviceDto;
export type ProcessInfo = ProcessDto;

/**
 * Kinds whose inputs list devices (see `LiveSourceInputs`); the rest need none.
 * Also the kinds that can only be enumerated once microphone consent is decided.
 */
export function usesDevices(kind: SourceChoice): boolean {
  return kind === "mic" || kind === "system" || kind === "mix";
}
