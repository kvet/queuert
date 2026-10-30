import {
  CloseIcon,
  DocsIcon,
  LogoIcon,
  MenuIcon,
  SearchIcon,
  ThemeToggle,
  TopBarFrame,
  TopBarNavLink,
  iconButtonClass as iconButton,
} from "@queuert/ui/components";
import { A, useLocation } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";

import { toLocalPath } from "../base.js";
import { theme } from "../state/theme.js";
import { openFind } from "./FindDialog.js";

const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.userAgent);

const DOCS_URL = "https://kvet.github.io/queuert/";

const navItems = [
  { href: "/", label: "Overview", match: (path: string) => path === "/" },
  { href: "/chains/types", label: "Chains", match: (path: string) => path.startsWith("/chains") },
  { href: "/jobs/types", label: "Jobs", match: (path: string) => path.startsWith("/jobs") },
  { href: "/workers", label: "Workers", match: (path: string) => path.startsWith("/workers") },
];

export const TopBar = () => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const localPath = () => toLocalPath(location.pathname);
  const shortcut = () => (isMac() ? "⌘K" : "Ctrl K");

  return (
    <TopBarFrame
      below={
        <Show when={menuOpen()}>
          <nav
            class="flex flex-col gap-1 border-t border-border px-4 py-2 sm:hidden"
            aria-label="Main"
          >
            <For each={navItems}>
              {(item) => (
                <A
                  href={item.href}
                  class="rounded-xs px-2.5 py-1.5 text-sm text-fg-muted hover:bg-surface-2 data-active:bg-surface-2 data-active:font-medium data-active:text-fg"
                  data-active={item.match(localPath()) ? "" : undefined}
                  aria-current={item.match(localPath()) ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </A>
              )}
            </For>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener"
              class="rounded-xs px-2.5 py-1.5 text-sm text-fg-muted hover:bg-surface-2"
            >
              Documentation
            </a>
          </nav>
        </Show>
      }
    >
      <button
        type="button"
        class={`${iconButton} -ml-1 sm:hidden`}
        aria-label="Menu"
        aria-expanded={menuOpen()}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Show when={menuOpen()} fallback={<MenuIcon />}>
          <CloseIcon />
        </Show>
      </button>
      <A href="/" class="flex items-center gap-2 pr-1 font-mono font-semibold">
        <LogoIcon size={20} class="text-brand" />
        <span>Queuert</span>
      </A>
      <span
        class="hidden rounded-xs border border-border px-1.5 py-px font-mono text-[11px] text-fg-muted sm:inline-block"
        title="@queuert/dashboard version"
      >
        v{__DASHBOARD_VERSION__}
      </span>
      <nav class="ml-4 hidden items-center gap-0.5 sm:flex" aria-label="Main">
        <For each={navItems}>
          {(item) => (
            <TopBarNavLink href={item.href} active={item.match(localPath())} link={A}>
              {item.label}
            </TopBarNavLink>
          )}
        </For>
      </nav>
      <span class="flex-1" />
      <button
        type="button"
        class="hidden h-8 w-64 items-center gap-2 rounded-xs border border-border bg-surface px-2.5 text-left text-sm text-fg-subtle hover:border-border-strong hover:text-fg-muted lg:flex"
        onClick={openFind}
      >
        <SearchIcon size={14} />
        <span class="flex-1 truncate">Find by ID or type…</span>
        <kbd class="rounded-xs border border-border px-1 text-[11px] text-fg-subtle">
          {shortcut()}
        </kbd>
      </button>
      <button
        type="button"
        class={`${iconButton} lg:hidden`}
        aria-label="Find by ID or type"
        onClick={openFind}
      >
        <SearchIcon />
      </button>
      <ThemeToggle theme={theme} />
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noopener"
        class="hidden size-8 items-center justify-center rounded-xs text-fg-muted hover:bg-surface-2 hover:text-fg sm:inline-flex"
        title="Documentation"
        aria-label="Documentation (opens in a new tab)"
      >
        <DocsIcon />
      </a>
    </TopBarFrame>
  );
};
