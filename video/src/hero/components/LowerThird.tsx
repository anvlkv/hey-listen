import type React from "react";
import {OVERLAY} from "../theme";

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
