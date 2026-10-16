/*
 * Hey Listen marketing page — the only script.
 *
 * Two small, dependency-free behaviours:
 *   1. A gentle scroll-reveal over `.reveal` elements (IntersectionObserver).
 *   2. A **reverse parallax** on the hero: the popout card rides from the bottom of the
 *      workbench shot all the way up to its top as the hero scrolls away — from the very
 *      first scrolled pixel.
 *
 * Both are fully disabled under `prefers-reduced-motion` (and, for the reveal, when
 * IntersectionObserver is unavailable) — the page then reads exactly as it would
 * without JS. No analytics, no tracking, no dependencies.
 */

(() => {
  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** How far the card travels, as a fraction of the hero stage's height. */
  const PARALLAX_TRAVEL = 0.95;
  /** Below this width the card sits in the flow instead of overlapping (see styles.css). */
  const PARALLAX_MIN_WIDTH = "(min-width: 721px)";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // --- 1. scroll reveal -----------------------------------------------------

  function initReveal() {
    const reveal = Array.from(document.querySelectorAll(".reveal"));
    const showAll = () => reveal.forEach((el) => el.classList.add("is-visible"));

    if (reducedMotion || !("IntersectionObserver" in window)) {
      showAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -5% 0px" },
    );

    reveal.forEach((el) => observer.observe(el));
  }

  // --- 2. reverse hero parallax ---------------------------------------------

  function initParallax() {
    const cards = Array.from(document.querySelectorAll("[data-parallax]"));
    if (cards.length === 0) return;
    if (reducedMotion) return;
    if (
      typeof window.matchMedia === "function" &&
      !window.matchMedia(PARALLAX_MIN_WIDTH).matches
    ) {
      return;
    }

    let ticking = false;

    const place = () => {
      ticking = false;
      const scrolled = window.scrollY || 0;
      for (const card of cards) {
        // The stage is the card's positioned parent; the card's own CSS spot is the
        // *bottom* of it, so the travel is a pure upward offset.
        const box = (card.parentElement ?? card).getBoundingClientRect();
        if (box.height === 0) continue;
        // Driven by the scroll position itself (the page-absolute bottom of the stage),
        // so the card lifts from the very first scrolled pixel and comes to rest at the
        // top of the shot exactly as the hero leaves the viewport.
        const bottom = box.top + scrolled + box.height;
        const progress = clamp(scrolled / bottom, 0, 1);
        const lift = Math.round(progress * box.height * PARALLAX_TRAVEL);
        card.style.transform = "translate3d(0, " + -lift + "px, 0)";
      }
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(place);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Place it before the first reveal, so the card never jumps into its lane.
    place();
  }

  initReveal();
  initParallax();
})();
