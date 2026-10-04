import { type Accessor, createSignal } from "solid-js";

const TICK_MS = 15_000;

const [nowSignal, setNow] = createSignal(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

const start = () => {
  clearInterval(timer);
  timer = setInterval(() => setNow(Date.now()), TICK_MS);
};

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInterval(timer);
    timer = undefined;
  } else {
    setNow(Date.now());
    start();
  }
});

if (!document.hidden) start();

/**
 * One shared wall clock (epoch ms) for every relative time and progress track. Ticks every 15s
 * and pauses while the tab is hidden, so relative labels stay live without per-component timers.
 */
export const now: Accessor<number> = nowSignal;

/** Advances the clock immediately, e.g. right after fresh data arrives. */
export const tickNow = (): void => {
  setNow(Date.now());
};
