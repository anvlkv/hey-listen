import { createSignal, onCleanup, onMount, Show } from "solid-js";

interface Props {
  src: string;
  poster: string;
  alt: string;
}

/**
 * The landing's opening film.
 *
 * Sound follows the **browser tab**, not the film: a tab that is already focused starts
 * with sound, and switching away mutes the film until the visitor comes back. Browsers
 * may still refuse audible autoplay before a gesture; the film then plays muted and the
 * Sound button is the way in. A deliberate mute with that button is remembered across
 * tab switches. Reduced motion starts paused on the poster.
 */
export default function HeroVideo(props: Props) {
  let video: HTMLVideoElement | undefined;
  let frame: HTMLDivElement | undefined;

  const [muted, setMuted] = createSignal(true);
  const [playing, setPlaying] = createSignal(true);
  const [userMuted, setUserMuted] = createSignal(false);
  const [failed, setFailed] = createSignal(false);

  const play = () => {
    const element = video;
    if (!element) return;
    element
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  };

  /** Play from the start, with sound when the tab is focused — muted if refused. */
  const start = (sound: boolean) => {
    const element = video;
    if (!element) return;

    const playMuted = () => {
      element.muted = true;
      setMuted(true);
      element
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    };

    element.muted = !sound;
    if (sound) element.volume = 0.65;
    setMuted(!sound);
    element
      .play()
      .then(() => {
        setPlaying(true);
        if (!sound) return;
        // A browser may accept the call and then silence the element by pausing it:
        // fall back to muted playback rather than leave a still frame.
        window.setTimeout(() => {
          if (element.paused && playing() && !userMuted()) playMuted();
        }, 300);
      })
      .catch(playMuted);
  };

  const pause = () => {
    video?.pause();
    setPlaying(false);
  };

  const mute = () => {
    if (video) video.muted = true;
    setMuted(true);
  };

  /** Sound on, unless the visitor turned it off with the Sound button. */
  const enableSound = () => {
    const element = video;
    if (!element || userMuted()) return;
    element.muted = false;
    element.volume = 0.65;
    setMuted(false);
  };

  const toggleSound = () => {
    if (muted()) {
      setUserMuted(false);
      enableSound();
    } else {
      setUserMuted(true);
      mute();
    }
  };

  const togglePlay = () => {
    if (playing()) pause();
    else play();
  };

  onMount(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) pause();
    else start(document.hasFocus());

    const onVisibility = () => {
      if (document.hidden) video?.pause();
      else if (!reduce && playing()) play();
    };

    const onWindowFocus = () => {
      if (!reduce) enableSound();
    };

    const onWindowBlur = () => mute();

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (!entry.isIntersecting) video?.pause();
        else if (!reduce && playing()) play();
      },
      { threshold: 0.2 },
    );

    if (frame) observer.observe(frame);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibility);

    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    });
  });

  return (
    <figure class="hero-film">
      <div class="hero-film__frame" ref={frame} role="group" aria-label="Workbench tour">
        <Show when={!failed()}>
          <video
            ref={video}
            class="hero-film__video"
            src={props.src}
            poster={props.poster}
            autoplay
            muted
            loop
            playsinline
            preload="auto"
            aria-hidden="true"
            onError={() => {
              setFailed(true);
            }}
          >
            <img src={props.poster} alt={props.alt} />
          </video>
        </Show>

        <Show when={failed()}>
          <img class="hero-film__video" src={props.poster} alt={props.alt} />
        </Show>

        <div class="hero-film__scrim" aria-hidden="true"></div>

        <div class="hero-film__controls">
          <button
            type="button"
            class="film-button"
            aria-pressed={!muted()}
            aria-label={muted() ? "Turn sound on" : "Turn sound off"}
            onClick={toggleSound}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M5 9h3l4-4v14l-4-4H5z" stroke-linejoin="round" />
              {muted() ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />}
            </svg>
            <span>{muted() ? "Sound off" : "Sound on"}</span>
          </button>
          <button
            type="button"
            class="film-button"
            aria-label={playing() ? "Pause film" : "Play film"}
            onClick={togglePlay}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {playing() ? <path d="M8 5h3v14H8zM13 5h3v14h-3z" /> : <path d="M8 5l11 7-11 7z" />}
            </svg>
            <span>{playing() ? "Pause" : "Play"}</span>
          </button>
        </div>
      </div>
      <figcaption class="sr-only">{props.alt}</figcaption>
    </figure>
  );
}
