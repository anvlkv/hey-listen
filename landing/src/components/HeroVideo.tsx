interface Props {
  /** The Vimeo video id (the number in `vimeo.com/<id>`). */
  videoId: string;
  alt: string;
}

/**
 * The landing's opening film, embedded from Vimeo.
 *
 * Autoplay forces mute (browsers refuse audible autoplay); Vimeo loops a single
 * video with `loop=1`. The player keeps its controls so the visitor can turn the
 * sound on. The frame crops the player like `object-fit: cover` — see
 * `.hero-film__player` — which is required because `object-fit` does not apply to
 * an iframe.
 */
export default function HeroVideo(props: Props) {
  const embedUrl = () => {
    const params = new URLSearchParams({
      autoplay: "1",
      muted: "1",
      loop: "1",
      autopause: "0",
      player_id: "0",
      app_id: "58479",
    });
    return `https://player.vimeo.com/video/${props.videoId}?${params.toString()}`;
  };

  return (
    <figure class="hero-film">
      <div class="hero-film__frame" role="group" aria-label="Workbench tour">
        <div class="hero-film__player">
          <iframe
            src={embedUrl()}
            title={props.alt}
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
      <figcaption class="sr-only">{props.alt}</figcaption>
    </figure>
  );
}
