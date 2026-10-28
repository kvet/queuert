import { Box } from "@queuert/ui/components";
import { Meta, Title } from "@solidjs/meta";
import { For, Show } from "solid-js";
import changelog from "virtual:changelog";

import { ExternalLinkIcon, TagIcon } from "../components/icons.tsx";
import { Badge } from "../components/mdx/Badge.tsx";
import { Toc } from "../components/Toc.tsx";

const anchor = (tag: string) =>
  tag
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const ChangelogRoute = () => {
  const releases = changelog.releases;
  return (
    <div class="mx-auto flex max-w-300 gap-12 px-4 pt-8 pb-24 sm:px-6">
      <Title>Changelog · Queuert</Title>
      <Meta name="description" content="Release notes for every Queuert version." />
      <main class="min-w-0 flex-1">
        <p class="text-xs text-fg-subtle">Changelog</p>
        <h1 class="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">Release notes</h1>
        <p class="mt-3 max-w-2xl text-[15px] leading-7 text-fg-muted">
          Every release of the Queuert packages, newest first, straight from{" "}
          <a
            href="https://github.com/kvet/queuert/releases"
            class="text-accent-fg underline decoration-accent-fg/35 underline-offset-3 hover:decoration-current"
          >
            GitHub releases
          </a>
          .
        </p>
        <Box
          tone="caution"
          title="Before 1.0"
          class="mt-8"
          bodyClass="px-4 pt-3 pb-3 text-[13px] leading-6 text-fg-muted"
        >
          Queuert is pre-1.0, so a minor version can break the API or the database schema. Breaking
          releases carry a <Badge text="Breaking" variant="danger" /> badge, list every breaking
          change first, and spell out the migration steps — read those before upgrading across a
          minor version.
        </Box>
        <Show when={changelog.unavailable}>
          <p class="mt-10 rounded-xs border border-dashed border-border-strong px-4 py-6 text-center text-fg-muted">
            Release notes couldn't be loaded while building this page. See them on{" "}
            <a href="https://github.com/kvet/queuert/releases" class="text-accent-fg underline">
              GitHub
            </a>
            .
          </p>
        </Show>
        <ol class="mt-12">
          <For each={releases}>
            {(release, index) => (
              <li class="relative grid gap-x-8 pb-14 md:grid-cols-[9rem_minmax(0,1fr)]">
                <div class="mb-3 md:sticky md:top-22 md:mb-0 md:self-start">
                  <time class="text-xs text-fg-subtle" dateTime={release.date}>
                    {formatDate(release.date)}
                  </time>
                </div>
                <section class="min-w-0 border-l border-border pl-6 md:pl-8">
                  <span
                    class={`absolute mt-1.5 -ml-7.25 size-2.25 rounded-xs border md:-ml-9.25 ${
                      index() === 0 ? "border-brand bg-brand" : "border-border-strong bg-bg"
                    }`}
                    aria-hidden="true"
                  />
                  <h2
                    id={anchor(release.tag)}
                    class="flex scroll-mt-20 flex-wrap items-center gap-2.5"
                  >
                    <a
                      href={`#${anchor(release.tag)}`}
                      class="flex items-center gap-2 text-lg font-semibold hover:text-accent-fg"
                    >
                      <TagIcon size={15} class="text-fg-subtle" />
                      {release.name}
                    </a>
                    <Show when={index() === 0}>
                      <Badge text="Latest" variant="tip" />
                    </Show>
                    <Show when={release.breaking}>
                      <Badge text="Breaking" variant="danger" />
                    </Show>
                    <a
                      href={release.url}
                      target="_blank"
                      rel="noopener"
                      class="ml-auto inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg"
                    >
                      GitHub
                      <ExternalLinkIcon size={12} />
                    </a>
                  </h2>
                  <div class="prose release-notes mt-4" innerHTML={release.html} />
                </section>
              </li>
            )}
          </For>
        </ol>
      </main>
      <aside class="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-48 shrink-0 self-start overflow-y-auto pt-2 xl:block">
        <Toc
          headings={releases.map((release) => ({
            depth: 2,
            text: release.name,
            id: anchor(release.tag),
          }))}
        />
      </aside>
    </div>
  );
};

export default ChangelogRoute;
