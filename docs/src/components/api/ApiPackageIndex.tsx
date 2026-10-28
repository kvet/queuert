import { A } from "@solidjs/router";
import { For, Show } from "solid-js";

import { type ApiPackage, kindLabels, pageHref } from "../../docs/pages.ts";
import { CopyButton } from "../CopyButton.tsx";
import { Badge } from "../mdx/Badge.tsx";

export const packageName = (pkg: ApiPackage): string =>
  pkg.label
    .split("/")
    .slice(0, pkg.label.startsWith("@") ? 2 : 1)
    .join("/");

export const ApiPackageIndex = (props: { pkg: ApiPackage }) => (
  <div>
    <div class="flex items-center gap-2 rounded-xs border border-border bg-surface px-3 py-2 text-[13px]">
      <span class="text-fg-subtle">$</span>
      <span class="flex-1">npm install {packageName(props.pkg)}</span>
      <CopyButton text={`npm install ${packageName(props.pkg)}`} label="Copy install command" />
    </div>
    <For each={props.pkg.kinds}>
      {(kind) => (
        <section class="mt-10">
          <h2
            id={kind.kind.toLowerCase()}
            class="flex items-baseline gap-2 text-base font-semibold"
          >
            {kindLabels[kind.kind] ?? kind.kind}
            <span class="text-xs font-normal text-fg-subtle">{kind.pages.length}</span>
          </h2>
          <ul class="mt-3 divide-y divide-border rounded-xs border border-border">
            <For each={kind.pages}>
              {(page) => (
                <li>
                  <A
                    href={pageHref(page)}
                    class="group flex flex-col gap-0.5 px-4 py-2.5 hover:bg-surface sm:flex-row sm:items-baseline sm:gap-4"
                  >
                    <span class="flex shrink-0 items-center gap-2 font-medium text-fg group-hover:text-accent-fg sm:w-64">
                      <span class="truncate">{page.title}</span>
                      <Show when={page.api?.experimental}>
                        <Badge text="Experimental" variant="caution" />
                      </Show>
                    </span>
                    <span class="line-clamp-2 text-[13px] leading-5 text-fg-muted">
                      {page.description ?? ""}
                    </span>
                  </A>
                </li>
              )}
            </For>
          </ul>
        </section>
      )}
    </For>
  </div>
);
