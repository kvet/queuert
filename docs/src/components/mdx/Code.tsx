import { Box } from "@queuert/ui/components";
import { type JSX, Show } from "solid-js";

import { CopyButton } from "../CopyButton.tsx";

const langLabels: Record<string, string> = {
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  javascript: "JavaScript",
  bash: "Terminal",
  sh: "Terminal",
  shell: "Terminal",
  sql: "SQL",
  json: "JSON",
  yaml: "YAML",
  diff: "Diff",
  lua: "Lua",
  text: "Text",
};

export const Code = (
  props: {
    lang: string;
    title?: JSX.Element;
    signature?: string;
    actions?: JSX.Element;
    /** Caps the box at about 30 lines and scrolls the rest inside it. */
    scroll?: boolean;
  } & ({ children: string } | { code: string; html: string }),
) => {
  const code = () => ("code" in props ? props.code : props.children);
  return (
    <Box
      class="my-5"
      bodyClass={
        props.signature
          ? `code-html code-signature ${code().includes("\n") ? "" : "code-signature-line"}`
          : `code-html ${props.scroll ? "code-scroll" : ""}`
      }
      title={
        props.title ?? (props.signature ? "Signature" : (langLabels[props.lang] ?? props.lang))
      }
      actions={
        <>
          {props.actions}
          <CopyButton text={code()} label="Copy code" />
        </>
      }
      data-code-lang={props.lang}
    >
      <Show
        when={"html" in props ? props.html : undefined}
        fallback={
          <pre>
            <code>{code()}</code>
          </pre>
        }
      >
        {(html) => <div innerHTML={html()} />}
      </Show>
    </Box>
  );
};
