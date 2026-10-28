import { Box } from "@queuert/ui/components";
import { type JSX } from "solid-js";

export const FileTree = (props: { children: JSX.Element }) => (
  <Box class="file-tree my-6" title="Files" bodyClass="px-4 py-3">
    {props.children}
  </Box>
);
