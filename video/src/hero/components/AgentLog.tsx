import type React from "react";
import {interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {LOG} from "../plan";
import {MONO, OVERLAY} from "../theme";

/**
 * The agent, working alongside the UI: one compressed step at a time in a
 * lower-third console strip. Calls are `verb → result`; thoughts are italic (·).
 */
export const AgentLog: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;

  const line = LOG.find((entry) => seconds >= entry.fromSec && seconds <= entry.toSec);
  if (!line) return null;

  const localFrame = (seconds - line.fromSec) * fps;
  const lineFrames = (line.toSec - line.fromSec) * fps;

  const opacity = interpolate(
    localFrame,
    [0, 4, lineFrames - 4, lineFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );

  const revealed = Math.floor(
    interpolate(localFrame, [0, 9], [0, line.text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  const thinking = line.kind === "thought";
  const pulse = interpolate(frame % 48, [0, 24, 48], [0.45, 1, 0.45]);
  const caret = frame % 30 < 15 ? 0.75 : 0.15;

  return (
    <div
      style={{
        position: "absolute",
        left: 46,
        top: 744,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 16px 9px 13px",
        borderRadius: 11,
        backgroundColor: OVERLAY.panel,
        border: `1px solid ${OVERLAY.hair}`,
        boxShadow: "0 18px 40px rgba(0, 0, 0, 0.35)",
        opacity,
        fontFamily: MONO,
        fontSize: 15.5,
        lineHeight: 1.2,
        letterSpacing: "0.005em",
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 8,
          backgroundColor: OVERLAY.accent,
          opacity: pulse,
          boxShadow: `0 0 12px ${OVERLAY.accentSoft}`,
        }}
      />
      <div
        style={{
          color: thinking ? OVERLAY.muted : OVERLAY.accent,
          fontStyle: thinking ? "italic" : "normal",
          width: 12,
        }}
      >
        {thinking ? "·" : "›"}
      </div>
      <div
        style={{
          color: thinking ? OVERLAY.muted : OVERLAY.ink,
          fontStyle: thinking ? "italic" : "normal",
          whiteSpace: "nowrap",
        }}
      >
        {line.text.slice(0, revealed)}
      </div>
      <div
        style={{
          width: 7,
          height: 15,
          marginLeft: 2,
          backgroundColor: OVERLAY.accent,
          opacity: revealed === line.text.length ? caret : 0,
        }}
      />
    </div>
  );
};
