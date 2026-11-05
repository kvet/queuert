import { onCleanup } from "solid-js";

/**
 * Plays a figure's reveal once, the first time it scrolls into view: `data-reveal` goes from
 * `pending` (bars collapsed, labels hidden; see `app.css`) to `done`, and the transitions run.
 * Call it from `onMount`. Nothing is hidden with reduced motion, without JavaScript, or when the
 * figure is already on screen at load, so the reader never waits for what they can already see.
 * The reveal only scales and fades, so the figure's height never changes.
 */
export const revealOnView = (element: HTMLElement | undefined) => {
  if (element === undefined) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = element.getBoundingClientRect();
  if (rect.top < window.innerHeight && rect.bottom > 0) return;
  element.dataset.reveal = "pending";
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      element.dataset.reveal = "done";
      observer.disconnect();
    },
    { rootMargin: "0px 0px -20% 0px" },
  );
  observer.observe(element);
  onCleanup(() => {
    observer.disconnect();
  });
};
