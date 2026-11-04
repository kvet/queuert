import { A } from "@solidjs/router";
import { For, Show, createSignal, onMount } from "solid-js";

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
  <svg
    viewBox="0 0 12 12"
    class="mr-1 inline-block size-3 shrink-0 align-[-0.125rem]"
    fill="none"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <Show when={props.mark === "yes"}>
      <path d="M2.5 6.25 5 8.75 9.5 3.5" class="stroke-accent" />
    </Show>
    <Show when={props.mark === "partial"}>
      <circle cx="6" cy="6" r="3" class="stroke-status-pending-dot" />
    </Show>
    <Show when={props.mark === "no"}>
      <path d="M3.25 3.25 8.75 8.75M8.75 3.25 3.25 8.75" class="stroke-error-dot" />
    </Show>
  </svg>
);

const toolTint = (id: CompareToolId) => (id === "queuert" ? "bg-surface" : "bg-bg");

const labelCell =
  "sticky left-0 z-10 border-border bg-bg px-2.5 py-1.5 font-mono text-[11px] leading-4 tracking-wide text-fg-muted uppercase";

const neighborIds = compareTools.flatMap((tool) => (tool.id === "queuert" ? [] : [tool.id]));

const parsePicked = (value: string | null): CompareToolId[] | undefined => {
  if (value === null) return undefined;
  const names = new Set(value.split(","));
  const picked = neighborIds.filter((id) => names.has(id));
  return picked.length === 0 ? undefined : picked;
};

const pickedSearch = (picked: CompareToolId[]) => {
  const url = new URL(window.location.href);
  if (picked.length === neighborIds.length) url.searchParams.delete("with");
  else url.searchParams.set("with", picked.join(","));
  return `${url.pathname}${url.search}${url.hash}`;
};

const toggleClass =
  "inline-flex items-center rounded-xs border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg aria-pressed:border-border-strong aria-pressed:bg-surface-2 aria-pressed:text-fg";

export const CompareMatrix = (props: { tools?: CompareToolId[]; selectable?: boolean }) => {
  const [picked, setPicked] = createSignal<CompareToolId[]>(neighborIds);
  onMount(() => {
    if (props.selectable !== true) return;
    const fromUrl = parsePicked(new URL(window.location.href).searchParams.get("with"));
    if (fromUrl !== undefined) setPicked(fromUrl);
  });
  const pick = (selection: CompareToolId[]) => {
    const next = selection.length === 0 ? neighborIds : selection;
    setPicked(next);
    window.history.replaceState(window.history.state, "", pickedSearch(next));
  };
  const toggle = (id: CompareToolId) => {
    pick(
      picked().length === neighborIds.length
        ? [id]
        : picked().includes(id)
          ? picked().filter((pickedId) => pickedId !== id)
          : neighborIds.filter((neighborId) => neighborId === id || picked().includes(neighborId)),
    );
  };
  const tools = () =>
    props.tools === undefined
      ? compareTools.filter((tool) => tool.id === "queuert" || picked().includes(tool.id))
      : compareTools.filter((tool) => props.tools?.includes(tool.id));
  const footnotes = () => {
    const used = new Set(
      tools().flatMap((tool) => compareRows.flatMap((row) => tool.cells[row.id]?.footnote ?? [])),
    );
    return compareFootnotes.filter((footnote) => used.has(footnote.id));
  };
  const footnoteNumber = (id: number) =>
    footnotes().findIndex((footnote) => footnote.id === id) + 1;
  const wide = () => tools().length > 2;

  return (
    <div class="my-8">
      <Show when={props.selectable}>
        <div
          role="group"
          aria-label="Tools to compare with Queuert"
          class="mb-4 flex flex-wrap items-center gap-1.5"
        >
          <span class="mr-1 text-xs text-fg-muted">Compare Queuert with</span>
          <For each={compareTools.filter((tool) => tool.id !== "queuert")}>
            {(tool) => (
              <button
                type="button"
                class={toggleClass}
                aria-pressed={picked().length < neighborIds.length && picked().includes(tool.id)}
                onClick={() => {
                  toggle(tool.id);
                }}
              >
                {tool.name}
              </button>
            )}
          </For>
          <Show when={picked().length < neighborIds.length}>
            <button
              type="button"
              class="ml-1 text-xs text-accent-fg hover:underline"
              onClick={() => {
                pick(neighborIds);
              }}
            >
              Show all
            </button>
          </Show>
        </div>
      </Show>
      <p class="m-0 mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        <For each={Object.entries(markLabels) as [CompareMark, string][]}>
          {([mark, label]) => (
            <span class="inline-flex items-center">
              <Mark mark={mark} />
              {label}
            </span>
          )}
        </For>
        <Show when={wide()}>
          <span class="text-fg-subtle min-[1440px]:hidden">
            Scroll sideways to see every tool →
          </span>
        </Show>
      </p>
      <div class="relative w-0 min-w-full overflow-x-auto rounded-xs border border-border scrollbar-thin">
        <div
          role="table"
          aria-label="Feature comparison"
          class="grid text-[13px] leading-[1.125rem]"
          style={{
            "grid-template-columns": `minmax(6rem, 9rem) repeat(${tools().length}, minmax(${wide() ? "8.5rem" : "7rem"}, 1fr))`,
          }}
        >
          <div role="row" class="contents">
            <div role="columnheader" class={`${labelCell} border-b`}>
              <span class="sr-only">Feature</span>
            </div>
            <For each={tools()}>
              {(tool) => (
                <div
                  role="columnheader"
                  class={`${toolTint(tool.id)} border-b border-l border-border px-2.5 py-2`}
                >
                  <div class="flex items-baseline gap-1.5">
                    <span class="font-mono text-xs font-semibold tracking-wider text-fg uppercase">
                      {tool.name}
                    </span>
                    <Show when={props.tools === undefined ? tool.href : undefined}>
                      {(href) => (
                        <A
                          href={href()}
                          class="unstyled text-xs text-accent-fg hover:underline"
                          aria-label={`Queuert vs ${tool.name}`}
                        >
                          →
                        </A>
                      )}
                    </Show>
                  </div>
                  <div class="mt-0.5 text-[11px] leading-4 text-fg-subtle">
                    {tool.category} · {tool.version ?? `v${comparedQueuertVersion}`}
                  </div>
                </div>
              )}
            </For>
          </div>
          <For each={compareRows}>
            {(row, rowIndex) => (
              <div role="row" class="contents">
                <div role="rowheader" class={`${labelCell} ${rowIndex() > 0 ? "border-t" : ""}`}>
                  {row.label}
                </div>
                <For each={tools()}>
                  {(tool) => {
                    const cell = tool.cells[row.id];
                    return (
                      <div
                        role="cell"
                        class={`${toolTint(tool.id)} border-l border-border px-2.5 py-1.5 break-words text-fg ${
                          rowIndex() > 0 ? "border-t" : ""
                        }`}
                      >
                        <Show when={cell?.mark}>
                          {(mark) => (
                            <>
                              <Mark mark={mark()} />
                              <span class="sr-only">{markLabels[mark()]}: </span>
                            </>
                          )}
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
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
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
