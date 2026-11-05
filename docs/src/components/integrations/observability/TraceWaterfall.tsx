import { Box, Chip, type ChipTone } from "@queuert/ui/components";
import { For, type JSX, Show, onMount } from "solid-js";

import { revealOnView } from "../../reveal.ts";

/**
 * One row of a {@link TraceWaterfall}. `start`/`end` are milliseconds from the start of the trace;
 * a row without `end` (or with `end === start`) is drawn as an instant marker.
 */
export type TraceSpan = {
  id: string;
  parentId?: string;
  name: string;
  kind?: string;
  start: number;
  end?: number;
  error?: boolean;
  status?: string;
  links?: string[];
  attributes?: string[];
};

const formatDuration = (milliseconds: number) => {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${Number((milliseconds / 1000).toFixed(1))} s`;
  if (milliseconds < 3_600_000) return `${Number((milliseconds / 60_000).toFixed(1))} min`;
  return `${Number((milliseconds / 3_600_000).toFixed(1))} h`;
};

const depthOf = (spans: TraceSpan[], span: TraceSpan): number => {
  const parent = spans.find((candidate) => candidate.id === span.parentId);
  return parent === undefined ? 0 : depthOf(spans, parent) + 1;
};

/**
 * A flat trace waterfall in the dashboard's row language: one row per span, indented by parent,
 * with a timeline bar, the span kind, and chips for links and attributes.
 */
export const TraceWaterfall = (props: {
  title: JSX.Element;
  /** Small line inside the body, above the axis, e.g. the chain the trace belongs to. */
  subtitle?: JSX.Element;
  label: string;
  spans: TraceSpan[];
  caption?: JSX.Element;
}) => {
  const total = () => Math.max(...props.spans.map((span) => span.end ?? span.start), 1);
  // The timeline uses 85% of the track so the duration label after the longest bar always fits.
  const percent = (value: number) => (value / total()) * 85;
  // On first view the spans draw in start order, the way the trace happened.
  const delay = (value: number) => `${Math.round((value / total()) * 900)}ms`;
  let figure: HTMLElement | undefined = undefined;
  onMount(() => {
    revealOnView(figure);
  });

  return (
    <figure ref={figure} class="my-8 pt-2" aria-label={props.label}>
      <Box title={props.title} bodyClass="pt-3">
        <Show when={props.subtitle}>
          <p class="m-0 px-4 pb-2 font-mono text-xs text-fg-muted">{props.subtitle}</p>
        </Show>
        <div class="hidden border-y border-border px-4 py-1.5 text-xs text-fg-subtle tabular-nums sm:grid sm:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] sm:gap-x-4">
          <span class="font-mono font-semibold tracking-wider uppercase">span</span>
          <span class="relative">
            <span class="absolute left-0">0</span>
            <span class="absolute left-[42.5%] -translate-x-1/2">
              {formatDuration(total() / 2)}
            </span>
            <span class="absolute left-[85%] -translate-x-1/2">{formatDuration(total())}</span>
          </span>
        </div>
        <ul class="row-list divide-y divide-border">
          <For each={props.spans}>
            {(span) => {
              const depth = depthOf(props.spans, span);
              const duration = (span.end ?? span.start) - span.start;
              const startPercent = percent(span.start);
              const endPercent = percent(span.end ?? span.start);
              const extras: { text: string; tone: ChipTone }[] = [
                ...(span.links ?? []).map((link) => ({
                  text: `link → ${link}`,
                  tone: "accent" as const,
                })),
                ...(span.attributes ?? []).map((attribute) => ({
                  text: attribute,
                  tone: "default" as const,
                })),
              ];
              return (
                <li class="grid gap-x-4 gap-y-1 px-4 py-1.5 sm:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] sm:items-center">
                  <div
                    class="flex min-w-0 items-start gap-x-2 text-[13px] leading-6"
                    style={{ "padding-left": `${depth * 0.75}rem` }}
                  >
                    <Show when={depth > 0}>
                      <span
                        class="mt-1 h-3 w-2 shrink-0 rounded-bl-xs border-b border-l border-border-strong"
                        aria-hidden="true"
                      />
                    </Show>
                    <Show when={span.kind}>
                      {(kind) => (
                        <span class="mt-1 shrink-0 rounded-xs border border-border px-1 font-mono text-[11px] leading-4 text-fg-subtle">
                          {kind()}
                        </span>
                      )}
                    </Show>{" "}
                    <span
                      class={`min-w-0 font-mono wrap-break-word ${span.error ? "text-error-fg" : "text-fg"}`}
                    >
                      {span.name}
                      <Show when={span.status ?? (span.error ? "ERROR" : undefined)}>
                        {(status) => (
                          <>
                            {" "}
                            <span
                              class={`text-xs whitespace-nowrap ${span.error ? "" : "text-fg-subtle"}`}
                            >
                              {status()}
                            </span>
                          </>
                        )}
                      </Show>
                    </span>
                  </div>{" "}
                  <div class="relative h-5" aria-hidden="true">
                    <span class="absolute inset-x-0 top-1/2 h-px bg-border" />
                    <Show
                      when={duration > 0}
                      fallback={
                        <span
                          class="reveal-fade absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-xs bg-fg-muted"
                          style={{
                            left: `calc(${startPercent}% - 1px)`,
                            "--reveal-delay": delay(span.start),
                          }}
                        />
                      }
                    >
                      <span
                        class={`reveal-bar absolute top-1/2 h-2 -translate-y-1/2 rounded-xs ${
                          span.error ? "bg-error-dot" : "bg-fg-subtle"
                        }`}
                        style={{
                          left: `${startPercent}%`,
                          width: `max(3px, ${endPercent - startPercent}%)`,
                          "--reveal-delay": delay(span.start),
                        }}
                      />
                      <span
                        class="reveal-fade absolute top-1/2 -translate-y-1/2 bg-bg px-1 text-xs whitespace-nowrap text-fg-muted tabular-nums"
                        style={{
                          left: `calc(${endPercent}% + 0.125rem)`,
                          "--reveal-delay": `calc(${delay(span.start)} + 400ms)`,
                        }}
                      >
                        {formatDuration(duration)}
                      </span>
                    </Show>
                  </div>
                  <Show when={extras.length > 0}>
                    <div
                      class="flex flex-wrap gap-1 pb-0.5 sm:col-span-2"
                      style={{ "padding-left": `${depth * 0.75 + (depth > 0 ? 1 : 0)}rem` }}
                    >
                      <For each={extras}>
                        {(extra) => (
                          <>
                            {" "}
                            <Chip mono tone={extra.tone} class="py-0! [overflow-wrap:anywhere]">
                              {extra.text}
                            </Chip>
                          </>
                        )}
                      </For>
                    </div>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={props.caption}>
          <figcaption class="border-t border-dashed border-border px-4 pt-3 pb-4 text-[13px] leading-6 text-fg-muted">
            {props.caption}
          </figcaption>
        </Show>
      </Box>
    </figure>
  );
};
