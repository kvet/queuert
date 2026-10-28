import { type JSX, Show, onCleanup, onMount } from "solid-js";

import "./diagram.css";

type Tone = "neutral" | "purple" | "blue" | "green" | "amber" | "red";

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
  tone?: Tone;
  variant?: "outline" | "solid" | "ghost";
  sub?: string;
  children: JSX.Element;
}) => (
  <div
    class="q-d-node"
    data-tone={props.tone ?? "neutral"}
    data-variant={props.variant ?? "outline"}
  >
    <span class="q-d-node__title">{props.children}</span>
    <Show when={props.sub}>
      <span class="q-d-node__sub">{props.sub}</span>
    </Show>
  </div>
);

export const Arrow = (props: {
  label?: string;
  sub?: string;
  tone?: Tone;
  dashed?: boolean;
  reverse?: boolean;
  direction?: "auto" | "down";
  head?: "arrow" | "none";
}) => (
  <div
    class="q-d-arrow"
    data-tone={props.tone}
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
  tone?: Tone;
  dashed?: boolean;
  children: JSX.Element;
}) => (
  <div class="q-d-group" data-tone={props.tone} data-dashed={flag(props.dashed)}>
    <span class="q-d-group__title">{props.title}</span>
    {props.children}
  </div>
);

export const Loop = (props: { label: string; tone?: Tone; children: JSX.Element }) => (
  <div class="q-d-loop" data-tone={props.tone ?? "amber"}>
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
