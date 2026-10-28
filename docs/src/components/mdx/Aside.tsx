import { Box } from "@queuert/ui/components";
import { type JSX } from "solid-js";

const defaultTitles = { note: "Note", tip: "Tip", caution: "Caution", danger: "Danger" } as const;

export const Aside = (props: {
  type?: keyof typeof defaultTitles;
  title?: string;
  children: JSX.Element;
}) => (
  <Box
    class="my-6"
    data-aside={props.type ?? "note"}
    tone={props.type ?? "note"}
    title={props.title ?? defaultTitles[props.type ?? "note"]}
    bodyClass="px-4 pt-3 pb-3 [&>*+*]:mt-3"
  >
    {props.children}
  </Box>
);
