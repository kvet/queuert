import { createEffect, createSignal, on, onCleanup } from "solid-js";

/**
 * Backs a text input that commits on typing rather than on blur. The raw text lives in a local
 * signal so it can hold in-progress input (e.g. a trailing ", "), and `commit` receives the
 * trimmed value once typing pauses for `delayMs`. External changes to `source` (a Clear button,
 * back/forward navigation) overwrite the local text unless it already trims to the same value.
 */
export const createDebouncedInput = (
  source: () => string,
  commit: (value: string) => void,
  delayMs = 300,
): {
  value: () => string;
  onInput: (value: string) => void;
  cancel: () => void;
} => {
  const [value, setValue] = createSignal(source());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  createEffect(
    on(
      source,
      (next) => {
        if (next !== value().trim()) setValue(next);
      },
      { defer: true },
    ),
  );

  onCleanup(cancel);

  const onInput = (next: string) => {
    setValue(next);
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      commit(next.trim());
    }, delayMs);
  };

  return { value, onInput, cancel };
};
