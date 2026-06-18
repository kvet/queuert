import { createEffect, createSignal, onCleanup } from "solid-js";

/**
 * Drives cursor-based pagination from an IntersectionObserver sentinel: when the sentinel
 * scrolls into view, `load` is invoked to fetch the next page. Attach `ref` to the
 * bottom-of-list element (which can stay clickable as a fallback), read `loading` for an
 * in-flight fetch, read `failed` to offer a manual retry, and call `trigger` from a click.
 *
 * The observer is only re-armed after a successful load. A rejected load instead sets
 * `failed` and leaves the observer un-rearmed, so a failing fetch stops the auto-loop rather
 * than retrying it in a tight storm against the API; the fallback button then acts as a
 * manual retry, which re-arms again once it succeeds.
 */
export const createAutoLoadMore = (
  load: () => Promise<void>,
): {
  ref: (el: HTMLElement) => void;
  loading: () => boolean;
  failed: () => boolean;
  trigger: () => void;
} => {
  const [target, setTarget] = createSignal<HTMLElement>();
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [revision, setRevision] = createSignal(0);

  const trigger = () => {
    if (loading()) return;
    setLoading(true);
    setFailed(false);
    void load().then(
      () => {
        setLoading(false);
        setRevision((r) => r + 1);
      },
      () => {
        setLoading(false);
        setFailed(true);
      },
    );
  };

  createEffect(() => {
    const el = target();
    revision();
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) trigger();
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  return { ref: setTarget, loading, failed, trigger };
};
