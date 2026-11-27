import type React from "react";
import {Img, staticFile} from "remotion";
import {
  APP_H,
  APP_W,
  type Shot,
  shotSrc,
} from "../manifest";

/**
 * One screenshot, optionally rasterized at a low resolution and scaled back up.
 * The image is laid out at `APP_* / pixel` and grown by `pixel`, with nearest-neighbour
 * scaling, so at high zoom the surface turns into a visible pixel display.
 */
const AppImage: React.FC<{src: string; pixel: number; opacity?: number}> = ({
  src,
  pixel,
  opacity = 1,
}) => {
  return (
    <Img
      src={staticFile(src)}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: APP_W / pixel,
        height: APP_H / pixel,
        objectFit: "cover",
        objectPosition: "top center",
        transformOrigin: "0 0",
        scale: pixel,
        imageRendering: pixel > 1.01 ? "pixelated" : "auto",
        opacity,
      }}
    />
  );
};

/**
 * A still or a retimed burst: adjacent captured frames are crossfaded, so the
 * crosshair, the timeline view and the drill-down card actually move. The last
 * frame holds for the rest of the scene.
 */
export const ShotLayer: React.FC<{
  shot?: Shot;
  shotId: string;
  progress: number;
  pixel: number;
  opacity?: number;
}> = ({shot, shotId, progress, pixel, opacity = 1}) => {
  if (!shot) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#C8B9DF",
          fontFamily: "ui-monospace, monospace",
          fontSize: 22,
          backgroundColor: "#12081F",
        }}
      >
        shot “{shotId}” is not in the manifest yet — re-run `npm run capture:hero`
      </div>
    );
  }

  const frames = shot.frames;
  const index = Math.min(frames.length - 1, Math.floor(progress));
  const nextIndex = Math.min(frames.length - 1, index + 1);
  const blend = progress - index;

  return (
    <div style={{position: "absolute", inset: 0, opacity}}>
      <AppImage src={shotSrc(frames[index].image)} pixel={pixel} />
      {nextIndex !== index && blend > 0.002 ? (
        <AppImage
          src={shotSrc(frames[nextIndex].image)}
          pixel={pixel}
          opacity={blend}
        />
      ) : null}
    </div>
  );
};
