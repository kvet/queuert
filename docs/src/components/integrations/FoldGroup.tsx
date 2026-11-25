import type { JSX } from "@solidjs/web";

export const FoldGroup = (props: { children: JSX.Element }) => (
  <div class="my-6 [&>[data-details]]:my-0 [&>[data-details]]:rounded-none [&>[data-details]:not(:first-child)]:border-t-0">
    {props.children}
  </div>
);
