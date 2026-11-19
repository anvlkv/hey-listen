import { For } from "solid-js";
import { formatRate } from "./modulationCommon";
import type { ModulationNote } from "../../bindings/ModulationNote";

/** A depth as a percentage, or an em dash when the note has no measurable envelope. */
const percent = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(0)}%`);

/** A cents depth, or an em dash when the note's voiced run was too short. */
const cents = (value: number | null) => (value == null ? "—" : `${value.toFixed(0)} ¢`);

/** A modulation rate, or an em dash when the note claimed none. */
const rate = (hz: number | null) => (hz == null ? "—" : formatRate(hz));

/** The note's strongest AM rate, if its envelope carried one. */
const amRate = (note: ModulationNote) => {
  const peak = note.amPeaks[0];
  return peak == null ? "—" : formatRate(peak.rateHz);
};

/**
 * The per-note AM/FM table (D-18), rendered only when `modulation` ran with **Per note**
 * on. Each row is one detected note segment (the M18 gate decides the spans) with that
 * note's own AM rate / depth and FM rate / cents depth. Full spectra stay window-only, so
 * this list is the readouts and nothing heavy.
 */
export default function ModulationNotes(props: { notes: ModulationNote[] }) {
  return (
    <div class="mod-notes" data-testid="modulation.notes">
      <div class="mod-notes-row mod-notes-head">
        <span>#</span>
        <span>Start</span>
        <span>End</span>
        <span>AM rate</span>
        <span>AM depth</span>
        <span>FM rate</span>
        <span>FM peak–peak</span>
      </div>
      <For each={props.notes}>
        {(note, index) => (
          <div class="mod-notes-row" data-testid={`modulation.note.${index()}`}>
            <span>{index() + 1}</span>
            <span>{note.startSecs.toFixed(2)} s</span>
            <span>{note.endSecs.toFixed(2)} s</span>
            <span>{amRate(note)}</span>
            <span>{percent(note.amDepth)}</span>
            <span>{rate(note.fmRateHz)}</span>
            <span>{cents(note.fmPeakToPeakCents)}</span>
          </div>
        )}
      </For>
    </div>
  );
}
