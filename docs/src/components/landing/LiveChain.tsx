import { Box, StatusPill } from "@queuert/ui/components";
import { For, createSignal, onCleanup, onMount } from "solid-js";

import {
  chainJobs,
  chainPhases,
  chainStatusAt,
  lastChainPhase,
  logWindowAt,
} from "./liveChainScenario.ts";

const stepMilliseconds = 1600;
const holdMilliseconds = 6000;
const logLines = 3;

const createLoop = () => {
  const [step, setStep] = createSignal(lastChainPhase);
  let element: HTMLElement | undefined;

  onMount(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    setStep(0);
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!visible || document.hidden) {
        return;
      }
      timer = setTimeout(
        () => {
          setStep(step() >= lastChainPhase ? 0 : step() + 1);
          schedule();
        },
        step() >= lastChainPhase ? holdMilliseconds : stepMilliseconds,
      );
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      schedule();
    });
    if (element) {
      observer.observe(element);
    }
    document.addEventListener("visibilitychange", schedule);
    onCleanup(() => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
      clearTimeout(timer);
    });
  });

  return {
    step,
    ref: (target: HTMLElement) => {
      element = target;
    },
  };
};

export const LiveChain = () => {
  const loop = createLoop();
  const statuses = () => chainPhases[loop.step()].statuses;
  const newestLine = () => Math.min(loop.step(), logLines - 1);
  return (
    <div ref={loop.ref}>
      <Box
        title="Chain · provision-account"
        actions={<StatusPill status={chainStatusAt(loop.step())} />}
        class="bg-bg"
        bodyClass="px-4 pt-4 pb-3"
      >
        <ol
          class="flex flex-col gap-2.5"
          aria-label="Jobs of the provision-account chain: provision-account, then send-welcome-email, then sync-to-crm"
        >
          <For each={chainJobs}>
            {(job, index) => {
              const status = () => statuses()[index()];
              return (
                <li
                  class={`flex items-center gap-3 transition-opacity duration-500 ${
                    status() === undefined ? "opacity-0" : "opacity-100"
                  }`}
                  aria-hidden={status() === undefined ? "true" : undefined}
                >
                  <span class="font-mono grid size-6 shrink-0 place-items-center rounded-xs bg-surface-2 text-xs font-semibold">
                    {index() + 1}
                  </span>
                  <span class="font-mono min-w-0 flex-1 truncate">{job.typeName}</span>
                  <span class="font-mono hidden text-xs text-fg-subtle tabular-nums sm:inline">
                    {status() === "completed" ? job.elapsed : job.id}
                  </span>
                  <StatusPill status={status() ?? "pending"} />
                </li>
              );
            }}
          </For>
        </ol>
        <div class="font-mono mt-4 border-t border-dashed border-border pt-3 text-[13px] leading-6 text-fg-subtle">
          <For each={logWindowAt(loop.step(), logLines)}>
            {(line, index) => (
              <p class={`h-6 truncate ${index() === newestLine() ? "text-fg-muted" : ""}`}>
                {line === undefined ? (
                  ""
                ) : (
                  <>
                    <span class="text-brand">›</span> {line}
                  </>
                )}
              </p>
            )}
          </For>
        </div>
      </Box>
    </div>
  );
};
