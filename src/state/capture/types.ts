import type { DeviceDto } from "../../bindings/DeviceDto";
import type { ProcessDto } from "../../bindings/ProcessDto";

/** Live source kinds. */
export type CaptureKind = "mic" | "system" | "process" | "mix";
/** Everything the source picker can choose (synth renders from its graph tab). */
export type SourceChoice = "file" | "synth" | CaptureKind;

export const KIND_LABEL: Record<CaptureKind, string> = {
  mic: "Microphone",
  system: "System audio",
  process: "Application",
  mix: "Mic + system",
};

/** Enumerated capture devices / processes (ts-rs bindings). */
export type DeviceInfo = DeviceDto;
export type ProcessInfo = ProcessDto;
