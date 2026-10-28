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

export const now: Accessor<number> = nowSignal;
