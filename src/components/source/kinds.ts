import type { SourceChoice } from "../../state/capture";
import type { SelectOption } from "../SelectTrigger";

/** The source kinds the picker offers (the synth renders from the Sources rail). */
export const SOURCE_CHOICES: SelectOption<SourceChoice>[] = [
  { value: "file", label: "Audio file" },
  { value: "mic", label: "Microphone" },
  { value: "system", label: "System audio" },
  { value: "process", label: "Application" },
  { value: "mix", label: "Mic + system" },
  { value: "synth", label: "Synth (graph)" },
];
