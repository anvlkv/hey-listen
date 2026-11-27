import type React from "react";
import {interpolate} from "remotion";
import {OVERLAY, SANS} from "../theme";

/** The cinematic fade over the timeline, keeping the lower third legible. */
export const LowerScrim: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 400,
      background: `linear-gradient(to top, ${OVERLAY.scrim} 0%, ${OVERLAY.scrimMid} 42%, transparent 100%)`,
      pointerEvents: "none",
    }}
  />
);

/** One line per scene, left-aligned at the safe-area margin (y ≈ 68 %). */
export const Caption: React.FC<{
  text?: string;
  frame: number;
  startAt: number;
  endAt: number;
}> = ({text, frame, startAt, endAt}) => {
  if (!text) return null;

  const opacity = interpolate(frame, [startAt, startAt + 8, endAt - 8, endAt], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (opacity <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 46,
        top: 672,
        display: "flex",
        alignItems: "center",
        gap: 16,
        opacity,
        translate: `0px ${interpolate(frame, [startAt, startAt + 10], [10, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })}px`,
      }}
    >
      <div
        style={{
          width: 3,
          height: 24,
          borderRadius: 2,
          backgroundColor: OVERLAY.accent,
          boxShadow: `0 0 14px ${OVERLAY.accentSoft}`,
        }}
      />
      <div
        style={{
          fontFamily: SANS,
          fontSize: 27,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          color: OVERLAY.ink,
          textShadow: "0 2px 12px rgba(0, 0, 0, 0.45)",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </div>
  );
};
