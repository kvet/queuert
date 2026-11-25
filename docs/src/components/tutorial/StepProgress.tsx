import { CheckIcon } from "@queuert/ui/components";
import { For } from "solid-js";

import { type LearnStep, learnStepSlug } from "../../data/learn.ts";
import { siteHref } from "../../docs/href.ts";
import { createStepDone, markStepDone, unmarkStepDone } from "./progress.ts";

const Tick = (props: { done: boolean }) => (
  <span
    aria-hidden="true"
    class="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-bg data-done:border-accent-fg data-done:bg-accent-fg"
    data-done={props.done ? "" : undefined}
  >
    {props.done ? <CheckIcon size={12} /> : null}
  </span>
);

/** The ordered Basics steps with a tick for each one passed or marked read in this browser. */
export const StepProgress = (props: { steps: LearnStep[] }) => {
  const isDone = createStepDone();

  return (
    <ol class="not-prose my-6 flex list-none flex-col gap-2 p-0">
      <For each={props.steps}>
        {(step, index) => (
          <li>
            <a
              href={siteHref(`/${learnStepSlug(step)}/`)}
              class="unstyled group flex items-start gap-3 rounded-xs border no-underline border-border px-4 py-3 hover:border-border-strong hover:bg-surface"
            >
              <Tick done={isDone(step.id)} />
              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="text-[15px] font-semibold text-fg group-hover:text-accent-fg">
                  {index() + 1}. {step.title}
                </span>
                <span class="text-[13px] text-fg-muted">{step.summary}</span>
              </span>
              <span class="shrink-0 font-mono text-xs text-fg-subtle">{step.minutes} min</span>
            </a>
          </li>
        )}
      </For>
    </ol>
  );
};

/** A small control near the end of a Basics step that ticks it on the Learn page without the exercise. */
export const MarkAsRead = (props: { id: string }) => {
  const isDone = createStepDone();

  return (
    <button
      type="button"
      aria-pressed={isDone(props.id) ? "true" : "false"}
      class="mt-10 inline-flex items-center gap-2 rounded-xs border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-border-strong hover:text-fg aria-pressed:border-accent-fg aria-pressed:text-fg"
      onClick={() => {
        if (isDone(props.id)) unmarkStepDone(props.id);
        else markStepDone(props.id);
      }}
    >
      <Tick done={isDone(props.id)} />
      {isDone(props.id) ? "Marked as read" : "Mark as read"}
    </button>
  );
};
