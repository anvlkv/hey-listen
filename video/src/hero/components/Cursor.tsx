import type React from "react";
import {interpolate} from "remotion";
import {cursorPoint, type Shot} from "../manifest";
import {OVERLAY} from "../theme";

const RIPPLE_FRAMES = 22;

/**
 * The pointer, drawn where the capture actually moved it. Positions come from the
 * manifest's per-frame `cursor`, interpolated with the same fractional frame the
 * burst crossfade uses, so the pointer always sits on the crosshair it produced.
 */
export const Cursor: React.FC<{
  shot: Shot;
  progress: number;
  frame: number;
  opacity: number;
  clicks: {frame: number; progress: number}[];
}> = ({shot, progress, frame, opacity, clicks}) => {
  const point = cursorPoint(shot, progress);
  if (!point || opacity <= 0) return null;

  const pressing = clicks.some((click) => Math.abs(frame - click.frame) <= 2);

  return (
    <div
      style={{
        position: "absolute",
        left: point.x,
        top: point.y,
        width: 0,
        height: 0,
        opacity,
      }}
    >
      {clicks.map((click) => {
        const age = frame - click.frame;
        if (age < 0 || age > RIPPLE_FRAMES) return null;
        const origin = cursorPoint(shot, click.progress);
        if (!origin) return null;
        const t = age / RIPPLE_FRAMES;
        const radius = 9 + t * 34;
        return (
          <div
            key={click.frame}
            style={{
              position: "absolute",
              left: origin.x - point.x - radius,
              top: origin.y - point.y - radius,
              width: radius * 2,
              height: radius * 2,
              borderRadius: radius,
              border: `2px solid ${OVERLAY.ripple}`,
              opacity: interpolate(t, [0, 0.15, 1], [0, 0.75, 0]),
            }}
          />
        );
      })}
      <svg
        viewBox="0 0 24 30"
        width={26}
        height={32}
        style={{
          position: "absolute",
          left: -2,
          top: -2,
          overflow: "visible",
          filter: "drop-shadow(0 3px 5px rgba(0, 0, 0, 0.5))",
          transformOrigin: "2px 2px",
          scale: pressing ? 0.88 : 1,
        }}
      >
        <path
          d="M 1.2 1.2 L 1.2 23.2 L 6.9 17.7 L 10.6 25.9 L 14.7 24.1 L 11 15.9 L 18.2 15.9 Z"
          fill="#FFFFFF"
          stroke="#151021"
          strokeWidth={1.3}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
