import type React from "react";
import {AbsoluteFill} from "remotion";

/**
 * The centroid-driven light. As the music brightens, a warm bloom lifts the frame;
 * as it sinks back into the dark lulls, a cool vignette closes in. It sits over the
 * captured app (and under the captions), so the dark → bright → dark arc is felt
 * even when the screenshot itself barely changes.
 */
export const Glow: React.FC<{brightness: number}> = ({brightness}) => {
  const bloom = brightness;
  const deepen = 1 - brightness;

  return (
    <AbsoluteFill style={{pointerEvents: "none"}}>
      <AbsoluteFill
        style={{
          mixBlendMode: "screen",
          background: `radial-gradient(120% 85% at 50% 30%, rgba(255, 214, 180, ${
            0.16 * bloom
          }) 0%, rgba(255, 214, 180, 0) 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(140% 110% at 50% 42%, rgba(0, 0, 0, 0) 52%, rgba(5, 2, 12, ${
            0.3 * deepen
          }) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
