import { type JSX, Show, children } from "solid-js";

import { type SiteSection } from "../docs/sections.ts";
import { SectionNav } from "./Sidebar.tsx";

export const DocsShell = (props: { section: SiteSection["id"]; children: JSX.Element }) => (
  <div class="mx-auto flex max-w-360 gap-8 px-4 sm:px-6 xl:gap-12">
    <aside class="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto overscroll-contain py-8 pr-2 scrollbar-thin lg:block">
      <SectionNav section={props.section} />
    </aside>
    {props.children}
  </div>
);

export const ArticleLayout = (props: {
  aside?: JSX.Element;
  wide?: boolean;
  children: JSX.Element;
}) => {
  const aside = children(() => props.aside);
  return (
    <main class="flex min-w-0 flex-1 gap-10 pt-8">
      <div class={`min-w-0 flex-1 animate-fade-in pb-24 ${props.wide ? "" : "max-w-192"}`}>
        {props.children}
      </div>
      <Show when={aside()}>
        <aside class="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-56 shrink-0 self-start overflow-y-auto pt-2 xl:block">
          {aside()}
        </aside>
      </Show>
    </main>
  );
};
