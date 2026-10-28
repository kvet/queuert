import { GitHubIcon } from "../icons.tsx";

export const SourceLink = (props: { href: string; label: string }) => (
  <p class="mt-3!" data-source-link>
    <a
      href={props.href}
      target="_blank"
      rel="noopener"
      class="unstyled inline-flex items-center gap-1.5 text-xs text-fg-subtle no-underline hover:text-fg"
    >
      <GitHubIcon size={12} />
      {props.label.replace(/^packages\//, "")}
    </a>
  </p>
);
