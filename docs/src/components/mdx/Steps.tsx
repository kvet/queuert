import { type JSX } from "solid-js";

export const Steps = (props: { children: JSX.Element }) => (
  <div class="steps my-6">{props.children}</div>
);
