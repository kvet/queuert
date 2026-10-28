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
import { A, useLocation } from "@solidjs/router";
import corePackage from "queuert/package.json";
import { For, Show, createEffect, createSignal, on } from "solid-js";
import { Portal } from "solid-js/web";

import { sectionForPath, siteSections } from "../docs/sections.ts";
import { theme } from "../theme.ts";
import { GitHubIcon } from "./icons.tsx";
import { openSearch } from "./Search.tsx";
import { SectionNav } from "./Sidebar.tsx";

export const TopBar = () => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const activeSection = () =>
    sectionForPath(location.pathname.slice(import.meta.env.BASE_URL.length - 1));
  const [drawerSection, setDrawerSection] = createSignal(activeSection()?.id ?? "docs");

  createEffect(
    on(
      () => location.pathname,
      () => {
        setMenuOpen(false);
        setDrawerSection(activeSection()?.id ?? "docs");
      },
      { defer: true },
    ),
  );

  return (
    <TopBarFrame
      below={
        <Show when={menuOpen()}>
          <Portal>
            <div class="fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto border-t border-border bg-bg px-4 pt-3 pb-10 lg:hidden">
              <div class="mb-5 flex flex-wrap gap-1 border-b border-border pb-3" role="tablist">
                <For each={siteSections}>
                  {(section) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={drawerSection() === section.id}
                      class="rounded-xs px-2.5 py-1 text-sm text-fg-muted aria-selected:bg-surface-2 aria-selected:font-medium aria-selected:text-fg"
                      onClick={() => setDrawerSection(section.id)}
                    >
                      {section.label}
                    </button>
                  )}
                </For>
              </div>
              <SectionNav section={drawerSection()} />
            </div>
          </Portal>
        </Show>
      }
    >
      <button
        type="button"
        class={`${iconButton} -ml-1 lg:hidden`}
        aria-label="Menu"
        aria-expanded={menuOpen()}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Show when={menuOpen()} fallback={<MenuIcon />}>
          <CloseIcon />
        </Show>
      </button>
      <A href="/" class="flex items-center gap-2 pr-1 font-mono font-semibold" end>
        <LogoIcon size={20} class="text-brand" />
        <span>Queuert</span>
      </A>
      <A
        href="/changelog/"
        class="font-mono hidden rounded-xs border border-border px-1.5 py-px text-[11px] text-fg-muted hover:border-border-strong hover:text-fg sm:inline-block"
        title="Latest release notes"
      >
        v{corePackage.version}
      </A>
      <nav class="ml-4 hidden items-center gap-0.5 lg:flex" aria-label="Sections">
        <For each={siteSections}>
          {(section) => (
            <TopBarNavLink href={section.href} active={activeSection()?.id === section.id} link={A}>
              {section.label}
            </TopBarNavLink>
          )}
        </For>
      </nav>
      <span class="flex-1" />
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
