import { WarningIcon } from "./icons.js";

export const ErrorMark = (props: { text: string }) => (
  <span class="inline-flex shrink-0 items-center gap-1 font-medium text-error-fg">
    <WarningIcon size={13} class="text-error-dot" />
    {props.text}
  </span>
);
