import { Box } from "@queuert/ui/components";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

import { type DocHeading } from "../docs/pages.ts";

export const Toc = (props: { headings: DocHeading[] }) => {
  const [active, setActive] = createSignal<string>();

  onMount(() => {
    const elements = props.headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element) => element !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-56px 0px -70% 0px" },
    );
    for (const element of elements) observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  return (
    <Show when={props.headings.length > 0}>
      <Box title="On this page" bodyClass="px-3 pt-3 pb-3">
        <ul class="flex flex-col gap-1 text-xs">
          <For each={props.headings}>
            {(heading) => (
              <li class={heading.depth === 3 ? "pl-3" : ""}>
                <a
                  href={`#${heading.id}`}
                  class="block truncate py-0.5 text-fg-muted hover:text-fg aria-current:font-medium aria-current:text-fg"
                  aria-current={active() === heading.id ? "true" : undefined}
                  title={heading.text}
                >
                  <span class="text-fg-subtle" aria-hidden="true">
                    {active() === heading.id ? "▸ " : "  "}
                  </span>
                  {heading.text}
                </a>
              </li>
            )}
          </For>
        </ul>
      </Box>
    </Show>
  );
};
