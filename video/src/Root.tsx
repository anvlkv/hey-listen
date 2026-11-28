import {Composition} from "remotion";
import {HeroFilm} from "./HeroFilm";
import {LOOP_DURATION_SECONDS} from "./hero/manifest";

const FPS = 30;

// Each <Composition> is an entry in the sidebar.

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HeroFilm"
      component={HeroFilm}
      durationInFrames={Math.round(LOOP_DURATION_SECONDS * FPS)}
      fps={FPS}
      width={1600}
      height={900}
    />
  );
};
