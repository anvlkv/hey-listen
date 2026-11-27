import type React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {Cursor} from "./components/Cursor";
import {DisplayMatrix} from "./components/DisplayMatrix";
import {Caption, LowerScrim} from "./components/LowerThird";
import {Camera} from "./components/Camera";
import {ShotLayer} from "./components/ShotLayer";
import {APP_H, APP_W, burstProgress, FILM_H, FILM_W, getShot} from "./manifest";
import type {SceneSpec} from "./plan";
import {BACKDROP} from "./theme";

/**
 * Slow start, hard acceleration, long settle: the push-ins should feel like a lens
 * move, not a linear scale.
 */
const DRAMA = Easing.bezier(0.62, 0, 0.14, 1);

/**
 * Keeps the captured surface covering the frame: a push-in may only centre points
 * that stay inside it, otherwise the camera would reveal the backdrop at an edge.
 */
const clampFocus = (
  value: number,
  extent: number,
  view: number,
  scale: number,
) => {
  const half = view / 2 / scale;
  const lo = Math.min(half, extent - half);
  const hi = Math.max(half, extent - half);
  return Math.min(Math.max(value, lo), hi);
};

export const Scene: React.FC<{spec: SceneSpec; durationInFrames: number}> = ({
  spec,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const shot = getShot(spec.shot);
  const outgoing = spec.outgoing ? getShot(spec.outgoing.shot) : undefined;
  const burstStart = (spec.burstOffsetSec ?? 0) * fps;

  const scale = interpolate(
    frame,
    spec.scale.map(([at]) => at),
    spec.scale.map(([, value]) => value),
    {easing: DRAMA, extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );
  const focusX = clampFocus(
    interpolate(
      frame,
      spec.focus.map(([at]) => at),
      spec.focus.map(([, x]) => x),
      {easing: DRAMA, extrapolateLeft: "clamp", extrapolateRight: "clamp"},
    ) * APP_W,
    APP_W,
    FILM_W,
    scale,
  );
  const focusY = clampFocus(
    interpolate(
      frame,
      spec.focus.map(([at]) => at),
      spec.focus.map(([, , y]) => y),
      {easing: DRAMA, extrapolateLeft: "clamp", extrapolateRight: "clamp"},
    ) * APP_H,
    APP_H,
    FILM_H,
    scale,
  );

  // Pixelation only engages past a real push-in; it is what makes the extreme read
  // as a display rather than a soft image.
  const pixel = interpolate(scale, [1.32, 1.58], [1, 8], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const matrix = interpolate(pixel, [2.5, 6], [0, 0.55], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const primaryProgress = shot
    ? burstProgress(shot, Math.max(0, frame - burstStart) / fps)
    : 0;

  const fadeFrames = spec.outgoing?.fadeFrames ?? 0;
  const outgoingOpacity = outgoing
    ? interpolate(frame, [0, fadeFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  const clicks = (spec.clicks ?? []).map((click) => ({
    frame: click,
    progress: shot
      ? burstProgress(shot, Math.max(0, click - burstStart) / fps)
      : 0,
  }));

  const showCursor = Boolean(spec.cursor) && Boolean(shot?.frames.some((f) => f.cursor));
  const cursorOpacity = showCursor
    ? interpolate(
        frame,
        [burstStart + 2, burstStart + 8, durationInFrames - 9, durationInFrames - 3],
        [0, 1, 1, 0],
        {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
      )
    : 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor:
          shot?.theme === "light" ? BACKDROP.light : BACKDROP.dark,
      }}
    >
      <Camera scale={scale} focusX={focusX} focusY={focusY}>
        <ShotLayer
          shot={shot}
          shotId={spec.shot}
          progress={primaryProgress}
          pixel={pixel}
        />
        {outgoing && outgoingOpacity > 0.002 ? (
          <ShotLayer
            shot={outgoing}
            shotId={spec.outgoing!.shot}
            progress={outgoing.frames.length - 1}
            pixel={pixel}
            opacity={outgoingOpacity}
          />
        ) : null}
        {shot && showCursor ? (
          <Cursor
            shot={shot}
            progress={primaryProgress}
            frame={frame}
            opacity={cursorOpacity}
            clicks={clicks}
          />
        ) : null}
      </Camera>

      <DisplayMatrix strength={matrix} />
      <LowerScrim />
      <Caption
        text={spec.caption}
        frame={frame}
        startAt={burstStart + 10}
        endAt={durationInFrames - 12}
      />
    </AbsoluteFill>
  );
};
