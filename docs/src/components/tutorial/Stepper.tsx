import { CheckIcon, ChevronRightIcon } from "@queuert/ui/components";
import { For } from "solid-js";

import { learnSteps } from "../../data/learn.ts";
import { siteHref } from "../../docs/href.ts";
import { createStepDone } from "./progress.ts";
import { stepperItems } from "./stepper.ts";

/** The Basics steps across the top of a `layout: "step"` page: a way back to Learn, then each step as a link. */
export const Stepper = (props: { current: string }) => {
  const isDone = createStepDone();
  const items = () => stepperItems(learnSteps, props.current, isDone);
  const open = () => items().find((item) => item.current);

  return (
    <nav aria-label="Basics steps" class="pt-6" data-stepper>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <a
          href={siteHref("/learn/")}
          class="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
        >
          <span aria-hidden="true">←</span> Learn
        </a>
        <ChevronRightIcon size={12} />
        <ol class="flex flex-wrap items-center gap-x-2 gap-y-2">
          <For each={items()}>
            {(item) => (
              <li class="flex items-center gap-2">
                <a
                  href={siteHref(`/${item.slug}/`)}
                  aria-current={item.current ? "step" : undefined}
                  class="group inline-flex items-center gap-2 rounded-xs text-sm text-fg-muted hover:text-fg aria-[current=step]:font-semibold aria-[current=step]:text-fg"
                >
                  <span
                    class="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs data-done:border-accent-fg data-done:bg-accent-fg data-done:text-bg group-aria-[current=step]:border-accent-fg group-aria-[current=step]:text-accent-fg group-aria-[current=step]:data-done:text-bg"
                    data-done={item.done ? "" : undefined}
                  >
                    {item.done ? <CheckIcon size={12} /> : item.number}
                  </span>
                  <span class="sr-only xl:not-sr-only">{item.title}</span>
                </a>
                <span
                  aria-hidden="true"
                  class="hidden h-px w-4 bg-border last:hidden sm:block xl:w-6"
                />
              </li>
            )}
          </For>
        </ol>
      </div>
      <p class="mt-2 text-sm font-semibold text-fg xl:hidden">
        Step {open()?.number} of {learnSteps.length}: {open()?.title}
      </p>
    </nav>
  );
};
