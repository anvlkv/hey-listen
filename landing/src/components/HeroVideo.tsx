import { createSignal, Match, Switch } from "solid-js";

interface Props {
  /** The YouTube video id (the part after `youtu.be/` or `watch?v=`). */
  videoId: string;
  poster: string;
  alt: string;
}

/**
 * The landing's opening film, as a lazy YouTube embed.
 *
 * Nothing from YouTube loads until the visitor asks for it: the poster and a play
 * button are rendered locally, so the page keeps its own first paint and no
 * third-party cookie is set for someone who never plays the film. Reduced motion
 * changes nothing here — the film only starts on a deliberate click.
 */
export default function HeroVideo(props: Props) {
  const [playing, setPlaying] = createSignal(false);

  const embedUrl = () =>
    `https://www.youtube-nocookie.com/embed/${props.videoId}` +
    "?autoplay=1&rel=0&modestbranding=1&playsinline=1";

  return (
    <figure class="hero-film">
      <div class="hero-film__frame" role="group" aria-label="Workbench tour">
        <Switch>
          <Match when={playing()}>
            <iframe
              class="hero-film__video"
              src={embedUrl()}
              title={props.alt}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              referrerpolicy="strict-origin-when-cross-origin"
            />
          </Match>
          <Match when={!playing()}>
            <button
              type="button"
              class="hero-film__play"
              aria-label="Play the workbench tour"
              onClick={() => setPlaying(true)}
            >
              <img class="hero-film__video" src={props.poster} alt={props.alt} />
              <span class="hero-film__play-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5l11 7-11 7z" />
                </svg>
              </span>
            </button>
          </Match>
        </Switch>

        <div class="hero-film__scrim" aria-hidden="true"></div>
      </div>
      <figcaption class="sr-only">{props.alt}</figcaption>
    </figure>
  );
}
