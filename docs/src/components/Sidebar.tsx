import { ChevronRightIcon } from "@queuert/ui/components";
import { A, useLocation } from "@solidjs/router";
import { For, Match, Show, Switch } from "solid-js";

import { apiTree, kindLabels, pageHref, sectionGroups } from "../docs/pages.ts";
import { type SiteSection, sectionById } from "../docs/sections.ts";
import { ExternalLinkIcon } from "./icons.tsx";

const linkClass =
  "block rounded-xs px-2.5 py-1 text-[13px] leading-5 text-fg-muted hover:bg-surface-2 hover:text-fg aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-fg";

const groupLabel =
  "mb-1.5 px-2.5 text-[11px] font-semibold font-mono tracking-wider text-fg-subtle uppercase";

const useCurrent = () => {
  const location = useLocation();
  const path = () => location.pathname.replace(/\/?$/, "/");
  return {
    path,
    is: (href: string) => path().endsWith(href),
  };
};

const GroupedNav = (props: { section: SiteSection }) => {
  const current = useCurrent();
  return (
    <div class="flex flex-col gap-6">
      <For each={sectionGroups(props.section)}>
        {(group) => (
          <div>
            <Show
              when={sectionGroups(props.section).length > 1 || group.label !== props.section.label}
            >
              <h2 class={groupLabel}>{group.label}</h2>
            </Show>
            <ul class="flex flex-col gap-px">
              <For each={group.pages}>
                {(page) => (
                  <li>
                    <A
                      href={pageHref(page)}
                      class={linkClass}
                      aria-current={current.is(pageHref(page)) ? "page" : undefined}
                    >
                      {page.title}
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </div>
  );
};

const ApiNav = () => {
  const current = useCurrent();
  const isActivePackage = (slug: string) => current.path().includes(`/api/${slug}/`);
  return (
    <div class="flex flex-col gap-1">
      <A
        href="/api/"
        class={linkClass}
        aria-current={current.path().endsWith("/api/") ? "page" : undefined}
        end
      >
        Overview
      </A>
      <h2 class={`${groupLabel} mt-4`}>Packages</h2>
      <For each={apiTree}>
        {(pkg) => (
          <details class="group/pkg" open={isActivePackage(pkg.slug)}>
            <summary class="flex cursor-pointer list-none items-center gap-1.5 rounded-xs px-2.5 py-1 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon
                size={12}
                class="shrink-0 text-fg-subtle transition-transform group-open/pkg:rotate-90"
              />
              <span
                class={`flex-1 truncate ${isActivePackage(pkg.slug) ? "font-medium text-fg" : ""}`}
              >
                {pkg.label}
              </span>
              <span class="text-[11px] text-fg-subtle">{pkg.size}</span>
            </summary>
            <div class="mt-1 mb-3 ml-4.25 border-l border-border pl-2">
              <Show when={pkg.index}>
                {(index) => (
                  <A
                    href={pageHref(index())}
                    class={linkClass}
                    aria-current={current.is(pageHref(index())) ? "page" : undefined}
                  >
                    Overview
                  </A>
                )}
              </Show>
              <For each={pkg.kinds}>
                {(kind) => (
                  <div class="mt-2">
                    <h3 class="px-2.5 py-0.5 text-[11px] font-mono tracking-wider text-fg-subtle uppercase">
                      {kindLabels[kind.kind] ?? kind.kind}
                    </h3>
                    <ul>
                      <For each={kind.pages}>
                        {(page) => (
                          <li>
                            <A
                              href={pageHref(page)}
                              class={`${linkClass} truncate py-0.5!`}
                              aria-current={current.is(pageHref(page)) ? "page" : undefined}
                              title={page.title}
                            >
                              {page.title}
                            </A>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                )}
              </For>
            </div>
          </details>
        )}
      </For>
    </div>
  );
};

const ChangelogNav = () => {
  const current = useCurrent();
  return (
    <ul class="flex flex-col gap-px">
      <li>
        <A
          href="/changelog/"
          class={linkClass}
          aria-current={current.is("/changelog/") ? "page" : undefined}
        >
          All releases
        </A>
      </li>
      <li>
        <a
          href="https://github.com/kvet/queuert/releases"
          target="_blank"
          rel="noopener"
          class={`${linkClass} flex items-center gap-1.5`}
        >
          GitHub releases
          <ExternalLinkIcon size={12} class="text-fg-subtle" />
        </a>
      </li>
    </ul>
  );
};

export const SectionNav = (props: { section: SiteSection["id"] }) => (
  <nav aria-label={sectionById(props.section).label}>
    <Switch fallback={<GroupedNav section={sectionById(props.section)} />}>
      <Match when={props.section === "api"}>
        <ApiNav />
      </Match>
      <Match when={props.section === "changelog"}>
        <ChangelogNav />
      </Match>
    </Switch>
  </nav>
);
