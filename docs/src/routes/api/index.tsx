import { Meta, Title } from "@solidjs/meta";
import { A } from "@solidjs/router";
import { For, Show } from "solid-js";

import { packageName } from "../../components/api/ApiPackageIndex.tsx";
import { ArticleLayout, DocsShell } from "../../components/DocsShell.tsx";
import { ArrowRightIcon, PackageIcon } from "../../components/icons.tsx";
import { apiTree, kindLabels, pageHref } from "../../docs/pages.ts";

const ApiOverview = () => (
  <DocsShell section="api">
    <ArticleLayout wide>
      <Title>API Reference · Queuert</Title>
      <Meta
        name="description"
        content="Generated reference for every exported symbol of the Queuert packages."
      />
      <p class="text-xs text-fg-subtle">API</p>
      <h1 class="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">API Reference</h1>
      <p class="mt-3 max-w-2xl text-[15px] leading-7 text-fg-muted">
        Every exported function, class and type, generated from the TSDoc in the source. Start with{" "}
        <A
          href="/api/core/functions/createclient/"
          class="text-accent-fg underline decoration-accent-fg/35 underline-offset-3 hover:decoration-current"
        >
          createClient
        </A>{" "}
        and{" "}
        <A
          href="/api/core/functions/createinprocessworker/"
          class="text-accent-fg underline decoration-accent-fg/35 underline-offset-3 hover:decoration-current"
        >
          createInProcessWorker
        </A>
        , then pick the adapters for your stack.
      </p>
      <div class="mt-10 grid gap-4 md:grid-cols-2">
        <For each={apiTree}>
          {(pkg) => (
            <A
              href={pkg.index ? pageHref(pkg.index) : "/api/"}
              class="group flex flex-col gap-3 rounded-xs border border-border bg-surface/50 p-5 hover:border-border-strong hover:bg-surface"
            >
              <div class="flex items-center gap-2.5">
                <span class="grid size-8 place-items-center rounded-xs bg-surface-2 text-brand">
                  <PackageIcon size={16} />
                </span>
                <span class="flex-1 font-semibold group-hover:text-accent-fg">{pkg.label}</span>
                <ArrowRightIcon
                  size={14}
                  class="text-fg-subtle transition-transform group-hover:translate-x-0.5"
                />
              </div>
              <p class="text-[13px] leading-6 text-fg-muted">{pkg.summary}</p>
              <div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                <For each={pkg.kinds}>
                  {(kind) => (
                    <span>
                      {kind.pages.length} {(kindLabels[kind.kind] ?? kind.kind).toLowerCase()}
                    </span>
                  )}
                </For>
                <Show when={pkg.label !== packageName(pkg)}>
                  <span>· ships in {packageName(pkg)}</span>
                </Show>
              </div>
            </A>
          )}
        </For>
      </div>
    </ArticleLayout>
  </DocsShell>
);

export default ApiOverview;
