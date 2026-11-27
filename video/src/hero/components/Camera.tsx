import type React from "react";
import {AbsoluteFill} from "remotion";
import {APP_H, APP_W, FILM_H, FILM_W} from "../manifest";

/**
 * Positions the captured app surface in the film frame: `focus` (app px) lands on
 * the centre of the frame and `scale` pushes in around it. Everything inside the
 * camera (the screenshot, the drawn cursor) moves as one physical surface.
 */
export const Camera: React.FC<{
  scale: number;
  focusX: number;
  focusY: number;
  children: React.ReactNode;
}> = ({scale, focusX, focusY, children}) => {
  const tx = FILM_W / 2 - focusX * scale;
  const ty = FILM_H / 2 - focusY * scale;

  return (
    <AbsoluteFill style={{overflow: "hidden"}}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: APP_W,
          height: APP_H,
          transformOrigin: "0 0",
          scale,
          translate: `${tx}px ${ty}px`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
