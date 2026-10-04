import { A, useNavigate } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";

import { canGoBack, previousLocation } from "../state/navigation.js";
import { ArrowLeftIcon, ChevronRightIcon } from "../ui/icons.js";

const isPlainClick = (event: MouseEvent) =>
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);

const sameList = (href: string, location: string): boolean => {
  const target = new URL(href, "http://x");
  const previous = new URL(location, "http://x");
  if (target.pathname !== previous.pathname) return false;
  for (const [key, value] of target.searchParams) {
    if (previous.searchParams.get(key) !== value) return false;
  }
  return true;
};

/**
 * A plain click pops history so the previous view keeps its URL-held filters. Without in-app
 * history (deep link, reload, new tab) it is a real link to `fallback`, which also keeps
 * right-click / ⌘-click working.
 */
const BackLink = (props: { fallback: string }) => {
  const navigate = useNavigate();
  return (
    <A
      href={props.fallback}
      class="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
      onClick={(event) => {
        if (!isPlainClick(event) || !canGoBack()) return;
        event.preventDefault();
        navigate(-1);
      }}
    >
      <ArrowLeftIcon size={14} />
      Back
    </A>
  );
};

/**
 * A breadcrumb link. When it points at the list the user just came from, a plain click goes back
 * through history so the list keeps its current filters, sort and scroll.
 */
const Crumb = (props: { href: string; children: JSX.Element }) => {
  const navigate = useNavigate();
  return (
    <A
      href={props.href}
      class="truncate text-fg-muted hover:text-fg hover:underline"
      onClick={(event) => {
        const previous = previousLocation();
        if (!isPlainClick(event) || !previous || !sameList(props.href, previous)) return;
        event.preventDefault();
        navigate(-1);
      }}
    >
      {props.children}
    </A>
  );
};

export const PageHeader = (props: {
  fallback: string;
  crumbs: { label: string; href?: string; title?: string }[];
}) => {
  return (
    <nav class="mb-4 flex min-w-0 items-center gap-3 text-sm" aria-label="Breadcrumb">
      <BackLink fallback={props.fallback} />
      <ol class="flex min-w-0 items-center gap-1.5">
        <For each={props.crumbs}>
          {(crumb, index) => (
            <li class="flex min-w-0 items-center gap-1.5">
              <Show when={index() > 0}>
                <ChevronRightIcon size={12} class="shrink-0 text-fg-subtle" />
              </Show>
              <Show
                when={crumb.href}
                fallback={
                  <span class="truncate font-medium" title={crumb.title} aria-current="page">
                    {crumb.label}
                  </span>
                }
              >
                {(href) => <Crumb href={href()}>{crumb.label}</Crumb>}
              </Show>
            </li>
          )}
        </For>
      </ol>
    </nav>
  );
};
