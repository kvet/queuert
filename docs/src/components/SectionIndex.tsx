import { For } from "solid-js";

import { siteHref } from "../docs/href.ts";
import { pageHref, sectionGroups } from "../docs/pages.ts";
import { type SiteSection, sectionById } from "../docs/sections.ts";

const groupId = (label: string) => label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

export const SectionIndex = (props: { section: SiteSection["id"] }) => {
  const groups = () =>
    sectionGroups(sectionById(props.section)).filter((group) => group.label !== "");
  return (
    <div class="gap-x-10 md:columns-2">
      <For each={groups()}>
        {(group) => (
          <section class="mb-8 break-inside-avoid">
            <h2 id={groupId(group.label)} class="mt-0! mb-3!">
              {group.label}
            </h2>
            <div class="flex flex-col gap-3">
              <For each={group.pages}>
                {(page) => (
                  <div>
                    <a
                      href={siteHref(pageHref(page))}
                      class="unstyled font-semibold text-fg hover:text-accent-fg"
                    >
                      {page.title}
                    </a>
                    <p class="mt-0.5! mb-0! text-[13px] leading-5 text-fg-muted">
                      {page.description}
                    </p>
                  </div>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
};
