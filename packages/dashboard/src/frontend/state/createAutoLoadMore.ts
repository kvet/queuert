import { createEffect, createSignal, onCleanup } from "solid-js";

/**
 * Calls `load` whenever the `ref` element (the bottom-of-list sentinel) scrolls into view;
 * `trigger` does the same from a click.
 *
 * The observer is re-armed only after a successful load. A rejected load sets `failed` and leaves
 * it disarmed, so a failing fetch stops the loop instead of hammering the API; a click on the
 * sentinel then retries and re-arms it once it succeeds.
 */
export const createAutoLoadMore = (
  load: () => Promise<void>,
): {
  ref: (element: HTMLElement) => void;
  loading: () => boolean;
  failed: () => boolean;
  trigger: () => void;
} => {
  const [target, setTarget] = createSignal<HTMLElement>();
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  let observer: IntersectionObserver | null = null;

  const trigger = () => {
    if (loading()) return;
    setLoading(true);
    setFailed(false);
    void load().then(
      () => {
        setLoading(false);
        setRevision((previous) => previous + 1);
      },
      () => {
        setLoading(false);
        setFailed(true);
        observer?.disconnect();
      },
    );
  };

  createEffect(() => {
    const element = target();
    revision();
    if (!element) return;
    // A new sentinel belongs to a new list, so an earlier failure no longer applies.
    setFailed(false);
    const own = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) trigger();
      },
      { rootMargin: "300px" },
    );
    own.observe(element);
    observer = own;
    onCleanup(() => {
      own.disconnect();
    });
  });

  return { ref: setTarget, loading, failed, trigger };
};
