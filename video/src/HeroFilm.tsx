import type React from "react";
import {AbsoluteFill, Html5Audio, Sequence, staticFile, useVideoConfig} from "remotion";
import {AgentLog} from "./hero/components/AgentLog";
import {manifest} from "./hero/manifest";
import {SCENES} from "./hero/plan";
import {Scene} from "./hero/Scene";
import {BACKDROP} from "./hero/theme";

/**
 * 31.2 s hero loop: one pass of the scenario, cut to the music, ending on the frame
 * it started from. See story-assets/SCENARIO.md.
 */
export const HeroFilm: React.FC = () => {
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{backgroundColor: BACKDROP.dark}}>
      <Html5Audio src={staticFile(`hero/${manifest.audio}`)} />

      {SCENES.map((spec) => {
        const from = Math.round(spec.fromSec * fps);
        const durationInFrames = Math.round(spec.toSec * fps) - from;

        return (
          <Sequence
            key={spec.id}
            name={spec.id}
            from={from}
            durationInFrames={durationInFrames}
          >
            <Scene spec={spec} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}

      <AgentLog />
    </AbsoluteFill>
  );
};
