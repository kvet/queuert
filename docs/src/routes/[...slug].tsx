import { ChevronRightIcon } from "@queuert/ui/components";
import { Meta, Title } from "@solidjs/meta";
import { A, type RouteDefinition, useParams } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import { type Component, For, Show, Suspense, lazy } from "solid-js";
import { Dynamic } from "solid-js/web";

import { ApiPackageIndex } from "../components/api/ApiPackageIndex.tsx";
import { ArticleLayout, DocsShell } from "../components/DocsShell.tsx";
import { ArrowRightIcon } from "../components/icons.tsx";
import { Badge } from "../components/mdx/Badge.tsx";
import { mdxComponents } from "../components/mdx/components.ts";
import { NotFound } from "../components/NotFound.tsx";
import { Toc } from "../components/Toc.tsx";
import {
  type DocModule,
  type DocPage,
  apiPackageOf,
  kindLabels,
  findPage,
  loadPage,
  neighbors,
  pageHref,
  trail,
} from "../docs/pages.ts";
import { sectionForPath } from "../docs/sections.ts";

export const route = {
  preload: ({ params }) => {
    const page = findPage(params.slug ?? "");
    if (page) void loadPage(page);
  },
} satisfies RouteDefinition;

const PagerLink = (props: { page: DocPage; direction: "previous" | "next" }) => (
  <A
    href={pageHref(props.page)}
    class={`group flex flex-1 flex-col gap-1 rounded-xs border border-border px-4 py-3 hover:border-border-strong hover:bg-surface ${
      props.direction === "next" ? "items-end text-right" : ""
    }`}
  >
    <span class="text-[11px] font-mono tracking-wider text-fg-subtle uppercase">
      {props.direction === "next" ? "Next" : "Previous"}
    </span>
    <span class="inline-flex items-center gap-1.5 text-sm font-medium group-hover:text-accent-fg">
      {props.page.title}
      <Show when={props.direction === "next"}>
        <ArrowRightIcon size={14} />
      </Show>
    </span>
  </A>
);

const UsedIn = (props: { page: DocPage }) => (
  <Show when={(props.page.api?.usedIn.length ?? 0) > 0}>
    <section class="mt-12 border-t border-border pt-6">
      <h2 class="text-[11px] font-semibold font-mono tracking-wider text-fg-subtle uppercase">
        Used in guides
      </h2>
      <ul class="mt-3 flex flex-wrap gap-2">
        <For
          each={props.page
            .api!.usedIn.map((slug) => findPage(slug))
            .filter((page) => page !== undefined)}
        >
          {(guide) => (
            <li>
              <A
                href={pageHref(guide)}
                class="inline-flex items-center gap-1 rounded-xs border border-border px-2 py-1 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
              >
                {guide.title}
              </A>
            </li>
          )}
        </For>
      </ul>
    </section>
  </Show>
);

const Article = (props: { page: DocPage; module: DocModule }) => {
  const pager = () => neighbors(props.page);
  const pkg = () => apiPackageOf(props.page);
  const isPackageIndex = () => props.page.slug.endsWith("/readme") && pkg() !== undefined;
  const Content = props.module.default;

  return (
    <article>
      <Title>{`${isPackageIndex() ? pkg()!.label : props.page.title} · Queuert`}</Title>
      <Show when={props.page.description}>
        {(description) => <Meta name="description" content={description()} />}
      </Show>
      <nav class="mb-4 flex items-center gap-1.5 text-xs text-fg-subtle" aria-label="Breadcrumb">
        <For each={trail(props.page)}>
          {(crumb, index) => (
            <>
              <Show when={index() > 0}>
                <ChevronRightIcon size={11} />
              </Show>
              <span>{crumb}</span>
            </>
          )}
        </For>
      </nav>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 class="min-w-0 text-xl font-semibold tracking-tight wrap-anywhere sm:text-2xl">
          {isPackageIndex() ? pkg()!.label : props.page.title}
        </h1>
        <Show when={props.page.api && !isPackageIndex()}>
          <Badge text={props.page.api!.kind ?? ""} variant="default" />
        </Show>
        <Show when={props.page.api?.experimental}>
          <Badge text="Experimental" variant="caution" />
        </Show>
      </div>
      <Show
        when={isPackageIndex() ? pkg()!.summary : props.page.api ? null : props.page.description}
      >
        {(description) => <p class="mt-3 text-[15px] leading-7 text-fg-muted">{description()}</p>}
      </Show>
      <div class="mt-8 border-t border-border pt-8" data-page-content>
        <Show
          when={isPackageIndex()}
          fallback={
            <div class="prose" classList={{ "api-reference": props.page.api !== null }}>
              <Content components={mdxComponents} />
            </div>
          }
        >
          <ApiPackageIndex pkg={pkg()!} />
        </Show>
      </div>
      <UsedIn page={props.page} />
      <footer class="mt-16 flex flex-col gap-3 sm:flex-row">
        <Show when={pager().previous} fallback={<span class="flex-1" />}>
          {(previous) => <PagerLink page={previous()} direction="previous" />}
        </Show>
        <Show when={pager().next} fallback={<span class="flex-1" />}>
          {(next) => <PagerLink page={next()} direction="next" />}
        </Show>
      </footer>
    </article>
  );
};

const articles = new Map<string, Component>();

const articleFor = (page: DocPage): Component => {
  let article = articles.get(page.file);
  if (!article) {
    article = lazy(async () => {
      const module = await loadPage(page);
      const pkg = apiPackageOf(page);
      const headings =
        pkg && page.slug.endsWith("/readme")
          ? pkg.kinds.map((kind) => ({
              depth: 2,
              text: kindLabels[kind.kind] ?? kind.kind,
              id: kind.kind.toLowerCase(),
            }))
          : module.headings;
      return {
        default: () => (
          <ArticleLayout
            wide={page.layout === "wide"}
            aside={page.layout === "wide" ? undefined : <Toc headings={headings} />}
          >
            <Article page={page} module={module} />
          </ArticleLayout>
        ),
      };
    });
    articles.set(page.file, article);
  }
  return article;
};

const DocsRoute = () => {
  const params = useParams();
  const page = () => findPage(params.slug ?? "");

  return (
    <Show
      when={page()}
      fallback={
        <>
          <HttpStatusCode code={404} />
          <NotFound />
        </>
      }
    >
      {(page) => (
        <DocsShell section={sectionForPath(pageHref(page()))?.id ?? "docs"}>
          <Suspense>
            <Dynamic component={articleFor(page())} />
          </Suspense>
        </DocsShell>
      )}
    </Show>
  );
};

export default DocsRoute;
