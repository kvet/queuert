import { IdChip, StatusPill } from "@queuert/ui/components";
import { For, Show, createMemo } from "solid-js";

import { type ChainEvent, groupFrames, reduceChains } from "./recorder.ts";

/**
 * The chains a lesson's run created, as they stood after its first `shown` steps (see
 * `groupFrames`). Rows for every job the run will create are laid out from the start and stay
 * hidden until their job exists, so the figure keeps its height while it plays.
 */
export const ChainView = (props: { events: ChainEvent[]; shown: number; finished?: boolean }) => {
  const visibleEvents = createMemo(() => groupFrames(props.events).slice(0, props.shown).flat());
  const current = createMemo(() => reduceChains(visibleEvents()));
  const final = createMemo(() => reduceChains(props.events));

  return (
    <div class="flex flex-col gap-4 font-sans" aria-live="polite" data-chain-view>
      <Show when={props.finished === true && final().length === 0}>
        <p class="m-0 text-sm text-fg-muted" data-chain-empty>
          No chain was committed
        </p>
      </Show>
      <For each={final()} keyed={(chain) => chain.id}>
        {(chain) => {
          const now = createMemo(() => current().find((candidate) => candidate.id === chain().id));
          return (
            <section class={["flex flex-col gap-2", { invisible: now() === undefined }]}>
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-[11px] tracking-wider text-fg-muted uppercase">
                  Chain
                </span>
                <span class="font-mono text-xs text-fg">{chain().typeName}</span>
                <IdChip id={chain().id} />
                <span class="flex-1" />
                <StatusPill status={now()?.status ?? "running"} />
              </div>
              <ul class="row-list m-0 flex list-none flex-col rounded-xs border border-border p-0">
                <For each={chain().jobs} keyed={(job) => job.id}>
                  {(job) => {
                    const state = createMemo(() =>
                      now()?.jobs.find((candidate) => candidate.id === job().id),
                    );
                    return (
                      <li
                        class={[
                          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0",
                          { invisible: state() === undefined },
                        ]}
                      >
                        <div class="flex min-w-0 flex-col gap-0.5">
                          <span class="font-mono text-xs font-semibold text-fg">
                            <Show when={job().id !== chain().jobs[0]?.id}>
                              <span class="text-fg-subtle" aria-hidden="true">
                                ↳{" "}
                              </span>
                            </Show>
                            {job().typeName}
                          </span>
                          <span class="truncate font-mono text-[11px] text-fg-subtle">
                            input {job().input}
                          </span>
                          <Show when={job().output}>
                            {(output) => (
                              <span
                                class={[
                                  "truncate font-mono text-[11px] text-fg-muted",
                                  { invisible: state()?.output === undefined },
                                ]}
                              >
                                output {output()}
                              </span>
                            )}
                          </Show>
                          <Show when={job().error}>
                            {(error) => (
                              <span
                                class={[
                                  "truncate font-mono text-[11px] text-error-fg",
                                  { invisible: state()?.error === undefined },
                                ]}
                              >
                                last error {state()?.error ?? error()}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="flex items-center gap-2">
                          <Show when={(state()?.attempts ?? 0) > 1 || state()?.error !== undefined}>
                            <span class="font-mono text-[11px] text-fg-subtle">
                              attempt {state()?.attempts}
                            </span>
                          </Show>
                          <StatusPill status={state()?.status ?? "pending"} />
                        </div>
                      </li>
                    );
                  }}
                </For>
              </ul>
              <Show when={chain().output}>
                {(output) => (
                  <span
                    class={[
                      "font-mono text-[11px] text-fg-muted",
                      { invisible: now()?.output === undefined },
                    ]}
                  >
                    chain output {output()}
                  </span>
                )}
              </Show>
            </section>
          );
        }}
      </For>
    </div>
  );
};
