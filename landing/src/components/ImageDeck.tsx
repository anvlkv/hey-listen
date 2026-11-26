import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";

export interface DeckCard {
  id: string;
  label: string;
  caption: string;
  image: string;
  alt: string;
  /** The app panel's own background, so a contained image has no visible frame. */
  background?: string;
}

interface Props {
  cards: DeckCard[];
  /** `rail` is a tall app panel; `panel` is a wide popover or rail. */
  variant?: "rail" | "panel";
  /** The accessible name of the dot group. */
  label?: string;
}

const ROTATE_MS = 4200;

/**
 * A small deck of app screenshots.
 *
 * The deck advances on its own; the dots let a visitor choose a card. There is no
 * simulated cursor and no hover behaviour — only the slides and the dots. Keyboard
 * focus pauses the rotation so a card does not move out from under a tabbing reader,
 * and reduced motion starts on the first card with no interval.
 */
export default function ImageDeck(props: Props) {
  const [order, setOrder] = createSignal(props.cards.map((_, index) => index));
  const [paused, setPaused] = createSignal(false);

  const frontIndex = () => order()[0] ?? 0;
  const front = createMemo(() => props.cards[frontIndex()]);
  const positionOf = (cardIndex: number) => Math.max(0, order().indexOf(cardIndex));

  const advance = () => {
    setOrder((current) => (current.length > 1 ? [...current.slice(1), current[0]] : current));
  };

  const show = (cardIndex: number) => {
    setOrder((current) => {
      const at = current.indexOf(cardIndex);
      if (at <= 0) return current;
      return [...current.slice(at), ...current.slice(0, at)];
    });
  };

  onMount(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      if (!paused()) advance();
    }, ROTATE_MS);

    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <div
      class={`image-deck image-deck--${props.variant ?? "rail"}`}
      onFocusIn={() => setPaused(true)}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <div class="image-deck__stage">
        <For each={props.cards}>
          {(card, index) => (
            <figure
              class={`image-card image-card--${positionOf(index())}`}
              style={card.background ? { background: card.background } : undefined}
            >
              <img src={card.image} alt={card.alt} loading="lazy" decoding="async" />
            </figure>
          )}
        </For>
      </div>

      <div class="image-deck__caption" aria-live="polite">
        <strong>{front()?.label}</strong>
        <span>{front()?.caption}</span>
      </div>

      <div class="image-deck__dots" role="group" aria-label={props.label ?? "Choose a slide"}>
        <For each={props.cards}>
          {(card, index) => (
            <button
              type="button"
              class="image-deck__dot"
              aria-label={`Show ${card.label}`}
              aria-pressed={frontIndex() === index()}
              onClick={() => show(index())}
            />
          )}
        </For>
      </div>
    </div>
  );
}
