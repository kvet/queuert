import { For, Show } from "solid-js";

import { ArticleLayout, DocsShell } from "../../components/DocsShell.tsx";
import { ArrowRightIcon, PackageIcon } from "../../components/icons.tsx";
import { PageMeta } from "../../components/PageMeta.tsx";
import { siteHref } from "../../docs/href.ts";
import { type ApiEntry, apiPackageTree, kindLabels, pageHref } from "../../docs/pages.ts";

const KindCounts = (props: { entry: ApiEntry }) => (
  <div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
    <For each={props.entry.kinds}>
      {(kind) => (
        <span>
          {kind.pages.length}{" "}
          {(kind.pages.length === 1
            ? kind.kind
            : (kindLabels[kind.kind] ?? kind.kind)
          ).toLowerCase()}
        </span>
      )}
    </For>
  </div>
);

const ApiOverview = () => (
  <DocsShell section="api">
    <ArticleLayout wide>
      <PageMeta
        title="API Reference · Queuert"
        description="Generated reference for every exported symbol of the Queuert packages."
        path="/api/"
      />
      <p class="text-xs text-fg-subtle">API</p>
      <h1 class="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">API Reference</h1>
      <p class="mt-3 max-w-2xl text-[15px] leading-7 text-fg-muted">
        Every exported function, class and type, generated from the TSDoc in the source. Start with{" "}
        <a
          href={siteHref("/api/core/functions/createclient/")}
          class="text-accent-fg underline decoration-accent-fg/35 underline-offset-3 hover:decoration-current"
        >
          createClient
        </a>{" "}
        and{" "}
        <a
          href={siteHref("/api/core/functions/createworkerrunner/")}
          class="text-accent-fg underline decoration-accent-fg/35 underline-offset-3 hover:decoration-current"
        >
          createWorkerRunner
        </a>
        , then pick the adapters for your stack.
      </p>
      <div class="mt-10 grid gap-4 md:grid-cols-2">
        <For each={apiPackageTree}>
          {(pkg) => (
            <div class="flex flex-col rounded-xs border border-border bg-surface/50">
              <For each={pkg.entries}>
                {(entry) => (
                  <Show
                    when={entry.subpath}
                    fallback={
                      <a
                        href={siteHref(entry.index ? pageHref(entry.index) : "/api/")}
                        class="group flex flex-1 flex-col gap-3 p-5 hover:bg-surface"
                      >
                        <div class="flex items-center gap-2.5">
                          <span class="grid size-8 place-items-center rounded-xs bg-surface-2 text-brand">
                            <PackageIcon size={16} />
                          </span>
                          <span class="flex-1 font-semibold group-hover:text-accent-fg">
                            {pkg.name}
                          </span>
                          <ArrowRightIcon
                            size={14}
                            class="text-fg-subtle transition-transform group-hover:translate-x-0.5"
                          />
                        </div>
                        <p class="text-[13px] leading-6 text-fg-muted">{entry.summary}</p>
                        <KindCounts entry={entry} />
                      </a>
                    }
                  >
                    {(subpath) => (
                      <a
                        href={siteHref(entry.index ? pageHref(entry.index) : "/api/")}
                        class="group flex flex-col gap-1.5 border-t border-border px-5 py-3 hover:bg-surface"
                      >
                        <div class="flex items-center gap-2.5">
                          <span class="flex-1 font-mono text-[13px] group-hover:text-accent-fg">
                            {pkg.name}/{subpath()}
                          </span>
                          <ArrowRightIcon
                            size={14}
                            class="text-fg-subtle transition-transform group-hover:translate-x-0.5"
                          />
                        </div>
                        <p class="text-[13px] leading-6 text-fg-muted">{entry.summary}</p>
                        <KindCounts entry={entry} />
                      </a>
                    )}
                  </Show>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </ArticleLayout>
  </DocsShell>
);

export default ApiOverview;
