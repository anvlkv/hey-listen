/*
 * Hey Listen marketing page — the only script.
 *
 * It drives a gentle scroll-reveal over `.reveal` elements with an
 * IntersectionObserver. No dependencies, no frameworks, no analytics/tracking.
 * Motion is fully disabled under `prefers-reduced-motion` (and when
 * IntersectionObserver is unavailable) by revealing everything immediately.
 */

(() => {
  const reveal = Array.from(document.querySelectorAll(".reveal"));
  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
})();
