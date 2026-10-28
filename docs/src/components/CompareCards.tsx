import { Box, CheckIcon } from "@queuert/ui/components";
import { A } from "@solidjs/router";
import { For, Show } from "solid-js";

import {
  type CompareMark,
  type CompareToolId,
  compareFootnotes,
  comparedQueuertVersion,
  compareRows,
  compareTools,
} from "../data/comparison.ts";

const markLabels = {
  yes: "built in",
  partial: "opt-in or extra code",
  no: "not provided",
} as const satisfies Record<CompareMark, string>;

const Mark = (props: { mark?: CompareMark }) => (
  <span class="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
    <Show when={props.mark === "yes"}>
      <CheckIcon size={14} class="text-fg" />
    </Show>
    <Show when={props.mark === "partial"}>
      <span class="size-2 rounded-full border-[1.5px] border-status-pending-dot" />
    </Show>
    <Show when={props.mark === "no"}>
      <span class="h-[1.5px] w-2.5 bg-fg-subtle" />
    </Show>
  </span>
);

export const CompareCards = (props: { tools?: CompareToolId[] }) => {
  const tools = () =>
    props.tools === undefined
      ? compareTools
      : compareTools.filter((tool) => props.tools?.includes(tool.id));
  const footnotes = () => {
    const used = new Set(
      tools().flatMap((tool) => compareRows.flatMap((row) => tool.cells[row.id]?.footnote ?? [])),
    );
    return compareFootnotes.filter((footnote) => used.has(footnote.id));
  };
  const footnoteNumber = (id: number) =>
    footnotes().findIndex((footnote) => footnote.id === id) + 1;
  const rowSpan = compareRows.length + 1;

  return (
    <div class="my-8">
      <p class="m-0 mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        <For each={Object.entries(markLabels) as [CompareMark, string][]}>
          {([mark, label]) => (
            <span class="inline-flex items-center gap-1.5">
              <Mark mark={mark} /> {label}
            </span>
          )}
        </For>
      </p>
      <p class="m-0 mb-2 text-xs text-fg-subtle sm:hidden">
        {tools().length} tools · scroll sideways to see them all →
      </p>
      <div
        class="-mx-4 grid snap-x snap-mandatory scroll-px-4 auto-cols-[minmax(var(--compare-column),1fr)] grid-flow-col gap-x-3 overflow-x-auto px-4 pt-2 pb-3 sm:mx-0 sm:grid-flow-row sm:grid-cols-[repeat(auto-fit,minmax(var(--compare-column),1fr))] sm:overflow-x-visible sm:px-0"
        style={{
          "--compare-column": tools().length > 2 ? "13rem" : "15rem",
          "grid-template-rows": `repeat(${rowSpan}, auto)`,
        }}
      >
        <For each={tools()}>
          {(tool) => (
            <div
              class="grid snap-start grid-rows-subgrid sm:pb-5"
              style={{ "grid-row": `span ${rowSpan}` }}
            >
              <Box
                title={tool.name}
                class={`row-span-full grid grid-rows-subgrid ${
                  tool.id === "queuert" ? "border-border-strong" : ""
                }`}
                bodyClass="row-span-full grid grid-rows-subgrid"
              >
                <div class="px-4 pt-2 pb-2 text-xs text-fg-subtle">
                  <Show
                    when={props.tools === undefined ? tool.href : undefined}
                    fallback={
                      <>
                        {tool.category} · {tool.version ?? `v${comparedQueuertVersion}`}
                      </>
                    }
                  >
                    {(href) => (
                      <>
                        {tool.category} · {tool.version} ·{" "}
                        <A href={href()} class="unstyled text-accent-fg hover:underline">
                          Queuert vs {tool.name} →
                        </A>
                      </>
                    )}
                  </Show>
                </div>
                <ul class="row-list contents">
                  <For each={compareRows}>
                    {(row) => {
                      const cell = tool.cells[row.id];
                      return (
                        <li class="border-t border-border px-4 py-2">
                          <div class="text-[11px] font-mono tracking-wide text-fg-subtle uppercase">
                            {row.label}
                          </div>
                          <div class="mt-0.5 flex items-start gap-2 text-xs leading-5 text-fg">
                            <Show when={cell?.mark}>
                              <span class="flex h-5 items-center">
                                <Mark mark={cell?.mark} />
                              </span>
                            </Show>
                            <span class="min-w-0">
                              <Show when={cell?.mark}>
                                {(mark) => <span class="sr-only">{markLabels[mark()]}: </span>}
                              </Show>
                              {cell?.text ?? "Not compared"}
                              <Show when={cell?.footnote}>
                                {(footnote) => (
                                  <>
                                    {" "}
                                    <a
                                      href={`#compare-note-${footnoteNumber(footnote())}`}
                                      class="unstyled align-super text-[10px] text-accent-fg"
                                      aria-label={`Note ${footnoteNumber(footnote())}`}
                                    >
                                      {footnoteNumber(footnote())}
                                    </a>
                                  </>
                                )}
                              </Show>
                            </span>
                          </div>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Box>
            </div>
          )}
        </For>
      </div>
      <Show when={footnotes().length > 0}>
        <ol class="row-list mt-4 flex list-none flex-col gap-1 p-0 text-xs text-fg-muted">
          <For each={footnotes()}>
            {(footnote, index) => (
              <li id={`compare-note-${index() + 1}`} class="m-0 flex gap-2 scroll-mt-20">
                <span class="w-4 shrink-0 text-right text-fg-subtle">{index() + 1}</span>{" "}
                <span>
                  {footnote.text}{" "}
                  <a href={footnote.href} class="text-accent-fg">
                    Source
                  </a>
                </span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  );
};
