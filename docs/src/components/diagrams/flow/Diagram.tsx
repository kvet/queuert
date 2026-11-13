import { StatusPill } from "@queuert/ui/components";
import type { AnyStatus } from "@queuert/ui/lib";
import {
  type JSX,
  For,
  Show,
  children,
  createContext,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";

import "./diagram.css";

const flag = (value: boolean | undefined) => (value ? "" : undefined);

export const Diagram = (props: {
  label: string;
  caption?: string;
  stack?: "auto" | "none";
  children: JSX.Element;
}) => {
  let body!: HTMLDivElement;
  let naturalWidth = 0;

  onMount(() => {
    if ((props.stack ?? "auto") !== "auto") return;
    const update = () => {
      const row = body.firstElementChild;
      if (!(row instanceof HTMLElement)) return;
      if (!body.hasAttribute("data-stacked")) naturalWidth = row.offsetWidth;
      body.toggleAttribute("data-stacked", naturalWidth > body.clientWidth);
    };
    const observer = new ResizeObserver(update);
    update();
    observer.observe(body);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  return (
    <figure class="q-d" aria-label={props.label}>
      <div
        ref={(element) => {
          body = element;
        }}
        class="q-d__body"
        data-stack={props.stack ?? "auto"}
      >
        {props.children}
      </div>
      <Show when={props.caption}>
        <figcaption class="q-d__caption">{props.caption}</figcaption>
      </Show>
    </figure>
  );
};

export const Flow = (props: {
  direction?: "row" | "column";
  align?: "center" | "stretch";
  children: JSX.Element;
}) => (
  <div
    class="q-d-flow"
    data-direction={props.direction ?? "row"}
    data-align={props.align ?? "center"}
  >
    {props.children}
  </div>
);

export const Node = (props: {
  variant?: "outline" | "ghost";
  status?: AnyStatus;
  sub?: JSX.Element;
  children: JSX.Element;
}) => {
  const sub = children(() => props.sub);
  return (
    <div class="q-d-node" data-variant={props.variant ?? "outline"}>
      <span class="q-d-node__title">{props.children}</span>
      <Show when={props.status}>
        {(status) => (
          <span class="q-d-node__status">
            <StatusPill status={status()} />
          </span>
        )}
      </Show>
      <Show when={sub()}>
        <span class="q-d-node__sub">{sub()}</span>
      </Show>
    </div>
  );
};

export const Transition = (props: { from: AnyStatus; via?: AnyStatus; to: AnyStatus }) => (
  <span class="q-d-transition">
    <StatusPill status={props.from} />
    <Show when={props.via}>
      {(via) => (
        <>
          <span aria-label="to">→</span>
          <StatusPill status={via()} />
        </>
      )}
    </Show>
    <span aria-label="to">→</span>
    <StatusPill status={props.to} />
  </span>
);

export const Arrow = (props: {
  label?: string;
  sub?: string;
  failure?: boolean;
  dashed?: boolean;
  reverse?: boolean;
  direction?: "auto" | "down";
  head?: "arrow" | "none";
}) => (
  <div
    class="q-d-arrow"
    data-failure={flag(props.failure)}
    data-dashed={flag(props.dashed)}
    data-reverse={flag(props.reverse)}
    data-direction={props.direction ?? "auto"}
    data-head={props.head ?? "arrow"}
  >
    <span class="q-d-arrow__label">{props.label}</span>
    <span class="q-d-arrow__line" aria-hidden="true" />
    <span class="q-d-arrow__sub">{props.sub}</span>
  </div>
);

export const Group = (props: {
  title: string;
  dashed?: boolean;
  align?: "center" | "start";
  children: JSX.Element;
}) => (
  <div class="q-d-group" data-dashed={flag(props.dashed)} data-align={props.align ?? "center"}>
    <span class="q-d-group__title">{props.title}</span>
    {props.children}
  </div>
);

export const Loop = (props: { label: string; children: JSX.Element }) => (
  <div class="q-d-loop">
    {props.children}
    <div class="q-d-loop__back">
      <span class="q-d-loop__bracket" aria-hidden="true" />
      <span>{props.label}</span>
    </div>
  </div>
);

export const Rows = (props: {
  columns?: string;
  spine?: boolean | "start" | "end";
  gap?: "normal" | "none";
  children: JSX.Element;
}) => (
  <div
    class="q-d-rows"
    data-spine={props.spine === true ? "start" : props.spine === false ? undefined : props.spine}
    data-gap={props.gap ?? "normal"}
    style={{ "--r-cols": props.columns ?? "minmax(3.5rem, auto) auto" }}
  >
    {props.children}
  </div>
);

const TimelineLanes = createContext<string[]>([]);

export const Timeline = (props: { lanes: string[]; children: JSX.Element }) => (
  <TimelineLanes.Provider value={props.lanes}>
    <div class="q-d-timeline" style={{ "--tl-lanes": props.lanes.length }}>
      <For each={props.lanes}>{(lane) => <span class="q-d-timeline__lane">{lane}</span>}</For>
      {props.children}
    </div>
  </TimelineLanes.Provider>
);

export const Step = (props: {
  lane: string;
  variant?: "outline" | "ghost";
  status?: AnyStatus;
  failure?: boolean;
  sub?: JSX.Element;
  children: JSX.Element;
}) => {
  const lanes = useContext(TimelineLanes);
  return (
    <div class="q-d-timeline__row">
      <For each={lanes}>
        {(lane) => (
          <div class="q-d-timeline__cell">
            <Show when={lane === props.lane}>
              <div class="q-d-timeline__step" data-failure={flag(props.failure)}>
                <Node variant={props.variant} status={props.status} sub={props.sub}>
                  {props.children}
                </Node>
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
};

export const Mark = (props: { failure?: boolean; children: JSX.Element }) => (
  <div class="q-d-timeline__mark" data-failure={flag(props.failure)}>
    <span>{props.children}</span>
  </div>
);
