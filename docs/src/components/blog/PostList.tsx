import { For } from "solid-js";

import { formatDate } from "../../docs/dates.ts";
import { siteHref } from "../../docs/href.ts";
import { pageHref, sectionGroups } from "../../docs/pages.ts";
import { sectionById } from "../../docs/sections.ts";

const posts = () =>
  sectionGroups(sectionById("blog")).find((group) => group.label === "Posts")?.pages ?? [];

export const PostList = () => (
  <ol class="post-list mt-8 flex flex-col border-t border-border">
    <For each={posts()}>
      {(post) => (
        <li class="grid gap-x-8 gap-y-1 border-b border-border py-6 md:grid-cols-[8rem_minmax(0,1fr)]">
          <time class="pt-0.5 text-xs text-fg-subtle" datetime={post.date ?? undefined}>
            {post.date ? formatDate(post.date) : ""}
          </time>
          <div class="min-w-0">
            <a
              href={siteHref(pageHref(post))}
              class="unstyled text-base font-semibold tracking-tight hover:text-accent-fg"
            >
              {post.title}
            </a>
            <p class="mt-1.5 text-[15px] leading-7 text-fg-muted">{post.description}</p>
          </div>
        </li>
      )}
    </For>
  </ol>
);
