import { GitHubIcon } from "./icons.tsx";
import { Code } from "./mdx/Code.tsx";

const scrollAfterLines = 30;

const repositoryBlobUrl = "https://github.com/kvet/queuert/blob/main/";

/**
 * A file (or a `// #region <name>` of it) from `examples/<example>/` or `packages/<package>/`,
 * read and highlighted at build time by the tsx-pages plugin. Pages write
 * `<ExampleCode example="…" file="…" region="…" />` (or `package="redis"` for library source);
 * the plugin fills in `lang`, `code` and `html`.
 * Files longer than 30 lines scroll inside their box, so per-driver tabs stay a readable height.
 */
export const ExampleCode = (props: {
  /** A directory of `examples/`. Exactly one of `example` and `package` is set. */
  example?: string;
  /** A directory of `packages/`, for library source such as SQL or scripts. */
  package?: string;
  file: string;
  region?: string;
  title?: string;
  lang?: string;
  code?: string;
  html?: string;
}) => {
  if (props.code === undefined || props.html === undefined || props.lang === undefined) {
    throw new Error(`<ExampleCode file="${props.file}"> was not compiled by the tsx-pages plugin`);
  }
  const path = () =>
    props.example === undefined
      ? `packages/${props.package}/${props.file}`
      : `examples/${props.example}/${props.file}`;
  return (
    <Code
      lang={props.lang}
      title={props.title ?? props.file}
      code={props.code}
      html={props.html}
      scroll={props.code.split("\n").length > scrollAfterLines}
      actions={
        <a
          href={`${repositoryBlobUrl}${path()}`}
          target="_blank"
          rel="noopener"
          class="unstyled inline-flex items-center gap-1.5 text-xs text-fg-subtle no-underline hover:text-fg"
          title={`Open ${path()} on GitHub`}
        >
          <GitHubIcon size={12} />
          <span class="max-sm:hidden">{props.example ?? `@queuert/${props.package}`}</span>
        </a>
      }
    />
  );
};
