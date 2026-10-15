import type { SourceChoice } from "../../state/capture";
import type { SelectOption } from "../SelectTrigger";

/** The source kinds the picker offers (synth renders from its Workbench tab). */
export const SOURCE_CHOICES: SelectOption<SourceChoice>[] = [
  { value: "file", label: "Audio file" },
  { value: "mic", label: "Microphone" },
  { value: "system", label: "System audio" },
  { value: "process", label: "Application" },
  { value: "mix", label: "Mic + system" },
  { value: "synth", label: "Synth (graph)" },
];

/** Kinds whose inputs list devices (see `LiveSourceInputs`); the rest need none. */
export function usesDevices(kind: SourceChoice): boolean {
  return kind === "mic" || kind === "system" || kind === "mix";
}
