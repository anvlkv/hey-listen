import type React from "react";
import {AbsoluteFill} from "remotion";

/**
 * The "display matrix" that appears while the camera is at maximum push-in: a fine
 * LED grid plus scanlines and a soft vignette, so the pixelated surface reads as an
 * intentional optical extreme rather than a decoding artefact.
 */
export const DisplayMatrix: React.FC<{strength: number}> = ({strength}) => {
  if (strength <= 0.002) return null;

  return (
    <AbsoluteFill style={{pointerEvents: "none", opacity: strength}}>
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.17) 0px, rgba(0, 0, 0, 0.17) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.1) 0px, rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <AbsoluteFill
        style={{boxShadow: "inset 0 0 200px rgba(8, 3, 18, 0.5)"}}
      />
    </AbsoluteFill>
  );
};
