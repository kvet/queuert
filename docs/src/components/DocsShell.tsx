import type { JSX } from "@solidjs/web";
import { Show, children } from "solid-js";

import type { SiteSection } from "../docs/sections.ts";
import { SectionNav } from "./Sidebar.tsx";

export const DocsShell = (props: {
  section: SiteSection["id"];
  sidebar?: boolean;
  children: JSX.Element;
}) => (
  <div
    class={`mx-auto flex max-w-360 px-4 sm:px-6 ${props.sidebar === false ? "flex-col" : "gap-8 xl:gap-12"}`}
  >
    <Show when={props.sidebar !== false}>
      <aside class="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto overscroll-contain py-8 pr-2 scrollbar-thin lg:block">
        <SectionNav section={props.section} />
      </aside>
    </Show>
    {props.children}
  </div>
);

export const ArticleLayout = (props: {
  aside?: JSX.Element;
  wide?: boolean;
  panel?: JSX.Element;
  footer?: JSX.Element;
  children: JSX.Element;
}) => {
  const aside = children(() => props.aside);
  return (
    <div class="min-w-0 flex-1">
      <main
        class={`flex min-w-0 gap-10 pt-8 ${props.panel === undefined ? "" : "flex-col lg:flex-row"}`}
      >
        <div
          class={`min-w-0 flex-1 animate-fade-in ${props.footer === undefined ? "pb-24" : ""} ${props.wide ? "" : "max-w-192"}`}
        >
          {props.children}
        </div>
        {props.panel}
        <Show when={aside()}>
          <aside class="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-56 shrink-0 self-start overflow-y-auto pt-2 xl:block">
            {aside()}
          </aside>
        </Show>
      </main>
      {props.footer}
    </div>
  );
};
