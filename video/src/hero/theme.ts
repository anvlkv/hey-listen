/**
 * The film's overlay palette. Both theme halves share it: the lower third always
 * fades to a dark cinematic scrim, so captions and the agent log read the same over
 * the light and the dark captures (and survive the theme dissolves unchanged).
 */
export const OVERLAY = {
  scrim: "rgba(6, 3, 12, 0.62)",
  scrimMid: "rgba(6, 3, 12, 0.3)",
  panel: "rgba(12, 8, 22, 0.58)",
  hair: "rgba(216, 180, 254, 0.26)",
  ink: "#F6F1FF",
  muted: "#C8B9DF",
  accent: "#C084FC",
  accentSoft: "rgba(192, 132, 252, 0.85)",
  ripple: "rgba(216, 180, 254, 0.9)",
} as const;

export const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

export const SANS =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif';

/** Dark / light backdrop shown outside the screenshot (behind push-ins). */
export const BACKDROP = {
  dark: "#12081F",
  light: "#FFFFFF",
} as const;
