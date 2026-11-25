import { Tabs } from "@kobalte/core/tabs";
import {
  CloseIcon,
  iconButtonClass as iconButton,
  LogoIcon,
  MenuIcon,
  SearchIcon,
  ThemeToggle,
  TopBarFrame,
  TopBarNavLink,
} from "@queuert/ui/components";
import { useLocation } from "@solidjs/router";
import { Portal } from "@solidjs/web";
import corePackage from "queuert/package.json";
import { For, Show, createEffect, createSignal } from "solid-js";

import { siteHref } from "../docs/href.ts";
import { blogSection, drawerSections, sectionForPath, topBarSections } from "../docs/sections.ts";
import { theme } from "../theme.ts";
import { GitHubIcon } from "./icons.tsx";
import { openSearch } from "./Search.tsx";
import { SectionNav } from "./Sidebar.tsx";

export const TopBar = () => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const activeSection = () =>
    sectionForPath(location.pathname.slice(import.meta.env.BASE_URL.length - 1));
  const [drawerSection, setDrawerSection] = createSignal(() => activeSection()?.id ?? "learn");

  createEffect(
    () => location.pathname,
    () => {
      setMenuOpen(false);
    },
    { defer: true },
  );

  return (
    <TopBarFrame
      below={
        <Show when={menuOpen()}>
          <Portal>
            <div class="fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto border-t border-border bg-bg px-4 pt-3 pb-10 lg:hidden">
              <Tabs value={drawerSection()} onChange={setDrawerSection}>
                <Tabs.List
                  class="mb-5 flex flex-wrap gap-1 border-b border-border pb-3"
                  aria-label="Sections"
                >
                  <For each={drawerSections}>
                    {(section) => (
                      <Tabs.Trigger
                        value={section.id}
                        class="rounded-xs px-2.5 py-1 text-sm text-fg-muted data-selected:bg-surface-2 data-selected:font-medium data-selected:text-fg"
                      >
                        {section.label}
                      </Tabs.Trigger>
                    )}
                  </For>
                </Tabs.List>
                <For each={drawerSections}>
                  {(section) => (
                    <Tabs.Content value={section.id}>
                      <SectionNav section={section.id} />
                    </Tabs.Content>
                  )}
                </For>
              </Tabs>
            </div>
          </Portal>
        </Show>
      }
    >
      <button
        type="button"
        class={`${iconButton} -ml-1 lg:hidden`}
        aria-label="Menu"
        aria-expanded={menuOpen() ? "true" : "false"}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Show when={menuOpen()} fallback={<MenuIcon />}>
          <CloseIcon />
        </Show>
      </button>
      <a href={siteHref("/")} class="flex items-center gap-2 pr-1 font-mono font-semibold">
        <LogoIcon size={20} class="text-brand" />
        <span>Queuert</span>
      </a>
      <a
        href={siteHref("/changelog/")}
        class="font-mono inline-block rounded-xs border border-border px-1.5 py-px text-[11px] text-fg-muted hover:border-border-strong hover:text-fg"
        title="Latest release notes"
      >
        v{corePackage.version}
      </a>
      <nav class="ml-4 hidden items-center gap-0.5 lg:flex" aria-label="Sections">
        <For each={topBarSections}>
          {(section) => (
            <TopBarNavLink
              href={siteHref(section.href)}
              active={activeSection()?.id === section.id}
            >
              {section.label}
            </TopBarNavLink>
          )}
        </For>
      </nav>
      <span class="flex-1" />
      <nav class="hidden items-center lg:flex" aria-label="Blog">
        <TopBarNavLink
          href={siteHref(blogSection.href)}
          active={activeSection()?.id === blogSection.id}
        >
          {blogSection.label}
        </TopBarNavLink>
      </nav>
      <button
        type="button"
        class="hidden h-8 w-56 items-center gap-2 rounded-xs border border-border bg-surface px-2.5 text-left text-sm text-fg-subtle hover:border-border-strong hover:text-fg-muted sm:flex lg:w-64"
        onClick={openSearch}
      >
        <SearchIcon size={14} />
        <span class="flex-1">Search docs</span>
        <kbd class="rounded-xs border border-border px-1 text-[11px] text-fg-subtle">⌘K</kbd>
      </button>
      <button
        type="button"
        class={`${iconButton} sm:hidden`}
        aria-label="Search"
        onClick={openSearch}
      >
        <SearchIcon />
      </button>
      <ThemeToggle theme={theme} />
      <a
        href="https://github.com/kvet/queuert"
        target="_blank"
        rel="noopener"
        class={iconButton}
        aria-label="GitHub (opens in a new tab)"
        title="GitHub"
      >
        <GitHubIcon />
      </a>
    </TopBarFrame>
  );
};
