import {Composition} from "remotion";
import {HeroFilm} from "./HeroFilm";

// Each <Composition> is an entry in the sidebar.

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HeroFilm"
      component={HeroFilm}
      durationInFrames={936}
      fps={30}
      width={1600}
      height={900}
    />
  );
};
