import type { JSX } from "@solidjs/web";
import { createSignal, onCleanup } from "solid-js";

import { ChainView } from "../tutorial/ChainView.tsx";
import { groupFrames } from "../tutorial/recorder.ts";
import { firstChainEvents } from "./firstChainEvents.ts";

const frameMilliseconds = 700;
const frameCount = groupFrames(firstChainEvents).length;

const prefersReducedMotion = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export const FirstChain = (props: { children: JSX.Element }) => {
  const [shown, setShown] = createSignal(frameCount);
  const [playing, setPlaying] = createSignal(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    setPlaying(false);
  };

  const run = () => {
    stop();
    if (prefersReducedMotion()) {
      setShown(frameCount);
      return;
    }
    setShown(0);
    setPlaying(true);
    timer = setInterval(() => {
      const next = shown() + 1;
      setShown(next);
      if (next >= frameCount) stop();
    }, frameMilliseconds);
  };

  onCleanup(stop);

  return (
    <div class="flex min-w-0 flex-col gap-3">
      <div class="[&_[data-code-lang]]:my-0 [&_[data-code-lang]]:bg-bg [&_pre]:max-h-none! [&_pre]:text-[12px] [&_pre]:leading-[1.55]">
        {props.children}
      </div>
      <div class="rounded-xs border border-border bg-bg">
        <div class="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <span class="font-mono text-xs text-fg-muted">Chain events</span>
          <button
            type="button"
            disabled={playing()}
            onClick={run}
            class="inline-flex h-7 items-center rounded-xs bg-fg px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {playing() ? "Running…" : "Run"}
          </button>
        </div>
        <div class="p-3">
          <ChainView events={firstChainEvents} shown={shown()} finished={!playing()} />
        </div>
      </div>
    </div>
  );
};
