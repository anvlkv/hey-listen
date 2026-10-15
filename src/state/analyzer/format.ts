/** Display formatting shared by the registry entries' view descriptors. */

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(0)} Hz`;
}

/** One decimal, in dB (spectral contrast). */
export const fmtDb = (value: number) => `${value.toFixed(1)} dB`;
/** A 0…1 ratio as a whole percent (bounded ratio series). */
export const fmtRatio = (value: number) => `${(value * 100).toFixed(0)}%`;
/** Two decimals, unlabelled. */
export const fmtPlain = (value: number) => value.toFixed(2);
/** Pitch-class row labels for the chromagram (C … B). */
export const CHROMA_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
