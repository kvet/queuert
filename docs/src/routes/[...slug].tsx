import { ChevronRightIcon } from "@queuert/ui/components";
import { useParams } from "@solidjs/router";
import { defineFileRoute } from "@solidjs/router/fs";
import { httpStatus } from "@solidjs/web";
import { For, Loading, Show, createMemo, lazy } from "solid-js";

import { ApiPackageIndex } from "../components/api/ApiPackageIndex.tsx";
import { ArticleLayout, DocsShell } from "../components/DocsShell.tsx";
import { ArrowRightIcon } from "../components/icons.tsx";
import { Badge } from "../components/mdx/Badge.tsx";
import { mdxComponents } from "../components/mdx/components.ts";
import { NotFound } from "../components/NotFound.tsx";
import { PageMeta } from "../components/PageMeta.tsx";
import { Toc } from "../components/Toc.tsx";
import { Stepper } from "../components/tutorial/Stepper.tsx";
import { MarkAsRead } from "../components/tutorial/StepProgress.tsx";
import { TaskPanel, TaskProvider } from "../components/tutorial/TryIt.tsx";
import { learnStepSlug, learnSteps } from "../data/learn.ts";
import { formatDate } from "../docs/dates.ts";
import { siteHref } from "../docs/href.ts";
import {
  type DocHeading,
  type DocModule,
  type DocPage,
  apiEntryOf,
  kindLabels,
  findPage,
  loadPage,
  neighbors,
  pageHref,
  trail,
} from "../docs/pages.ts";
import { sectionForPath } from "../docs/sections.ts";

export const route = defineFileRoute("/*slug", {
  preload: ({ params }) => {
    const page = findPage(params.slug ?? "");
    if (page) void loadPage(page);
  },
});

const PagerLink = (props: { page: DocPage; direction: "previous" | "next" }) => (
  <a
    href={siteHref(pageHref(props.page))}
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
  </a>
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
              <a
                href={siteHref(pageHref(guide))}
                class="inline-flex items-center gap-1 rounded-xs border border-border px-2 py-1 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
              >
                {guide.title}
              </a>
            </li>
          )}
        </For>
      </ul>
    </section>
  </Show>
);

const contents = new Map<string, DocModule["default"]>();

const contentFor = (page: DocPage): DocModule["default"] => {
  let content = contents.get(page.file);
  if (!content) {
    content = lazy(async () => loadPage(page));
    contents.set(page.file, content);
  }
  return content;
};

const hasTask = (page: DocPage) => page.layout === "step";

const Pager = (props: { page: DocPage }) => {
  const pager = () => neighbors(props.page);
  return (
    <footer class="mt-12 flex flex-col gap-3 sm:flex-row">
      <Show when={pager().previous} fallback={<span class="flex-1" />}>
        {(previous) => <PagerLink page={previous()} direction="previous" />}
      </Show>
      <Show when={pager().next} fallback={<span class="flex-1" />}>
        {(next) => <PagerLink page={next()} direction="next" />}
      </Show>
    </footer>
  );
};

const Article = (props: { page: DocPage }) => {
  const pkg = () => apiEntryOf(props.page);
  const isPackageIndex = () => props.page.slug.endsWith("/readme") && pkg() !== undefined;
  const Content = contentFor(props.page);
  const isLanding = () => {
    const crumbs = trail(props.page);
    return crumbs.length === 1 && crumbs[0].toLowerCase() === props.page.title.toLowerCase();
  };

  return (
    <article>
      <PageMeta
        title={`${isPackageIndex() ? pkg()!.label : props.page.title} · Queuert`}
        description={isPackageIndex() ? pkg()!.summary : props.page.description}
        path={pageHref(props.page)}
      />
      <Show when={!hasTask(props.page) && !isLanding()}>
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
      </Show>
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
      <Show when={props.page.date}>
        {(date) => (
          <time class="mt-3 block text-xs text-fg-subtle" datetime={date()}>
            {formatDate(date())}
          </time>
        )}
      </Show>
      <div class="mt-8 border-t border-border pt-8" data-page-content>
        <Show
          when={isPackageIndex()}
          fallback={
            <div
              class={[
                "prose",
                { "api-reference": props.page.api !== null, essay: props.page.date !== null },
              ]}
            >
              <Content components={mdxComponents} />
            </div>
          }
        >
          <ApiPackageIndex pkg={pkg()!} />
        </Show>
      </div>
      <Show when={learnSteps.find((step) => learnStepSlug(step) === props.page.slug)}>
        {(step) => <MarkAsRead id={step().id} />}
      </Show>
      <UsedIn page={props.page} />
      <Pager page={props.page} />
    </article>
  );
};

const headingsOf = async (page: DocPage): Promise<DocHeading[]> => {
  const pkg = apiEntryOf(page);
  if (pkg && page.slug.endsWith("/readme")) {
    return pkg.kinds.map((kind) => ({
      depth: 2,
      text: kindLabels[kind.kind] ?? kind.kind,
      id: kind.kind.toLowerCase(),
    }));
  }
  return (await loadPage(page)).headings;
};

const ArticlePage = (props: { page: DocPage }) => {
  const headings = createMemo(async () => headingsOf(props.page));
  const exercise = createMemo(async () => (await loadPage(props.page)).exercise);
  const step = () => learnSteps.find((candidate) => learnStepSlug(candidate) === props.page.slug);

  return (
    <>
      <Show when={props.page.layout === "step" ? step() : undefined}>
        {(step) => <Stepper current={step().id} />}
      </Show>
      <TaskProvider exercise={exercise} step={hasTask(props.page)}>
        <ArticleLayout
          wide={props.page.layout === "wide"}
          panel={hasTask(props.page) ? <TaskPanel /> : undefined}
          aside={props.page.layout === "default" ? <Toc headings={headings()} /> : undefined}
        >
          <Article page={props.page} />
        </ArticleLayout>
      </TaskProvider>
    </>
  );
};

const MissingPage = () => {
  httpStatus(404);
  return <NotFound />;
};

const DocsRoute = () => {
  const params = useParams();
  const page = () => findPage(params.slug ?? "");

  return (
    <Show when={page()} fallback={<MissingPage />}>
      {(page) => (
        <DocsShell
          section={sectionForPath(pageHref(page()))?.id ?? "learn"}
          sidebar={page().layout !== "step"}
        >
          <Loading>
            <Show when={page()} keyed>
              {(current) => <ArticlePage page={current} />}
            </Show>
          </Loading>
        </DocsShell>
      )}
    </Show>
  );
};

export default DocsRoute;
