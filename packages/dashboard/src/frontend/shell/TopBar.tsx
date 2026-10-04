import { A, useLocation } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";

import { toLocalPath } from "../base.js";
import { formatRelative } from "../domain/time.js";
import { now } from "../state/clock.js";
import {
  AUTO_REFRESH_OPTIONS,
  type AutoRefreshSeconds,
  autoRefresh,
  canRefresh,
  isRefreshing,
  lastLoaded,
  lastRefreshError,
  refreshNow,
  setAutoRefresh,
} from "../state/refresh.js";
import { type ThemePreference, setThemePreference, themePreference } from "../state/theme.js";
import {
  CloseIcon,
  DocsIcon,
  LogoIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  RefreshIcon,
  SearchIcon,
  SunIcon,
  WarningIcon,
} from "../ui/icons.js";
import { openFind } from "./FindDialog.js";

const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.userAgent);

const DOCS_URL = "https://kvet.github.io/queuert/";

const navItems = [
  { href: "/", label: "Overview", match: (path: string) => path === "/" },
  { href: "/chains/types", label: "Chains", match: (path: string) => path.startsWith("/chains") },
  { href: "/jobs/types", label: "Jobs", match: (path: string) => path.startsWith("/jobs") },
];

const RefreshControl = () => {
  const label = () => {
    const loaded = lastLoaded();
    return loaded === null ? "Refresh" : formatRelative(new Date(loaded), now());
  };

  return (
    <div class="flex h-8 items-stretch overflow-hidden rounded-xs border border-border-strong bg-surface text-sm">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        disabled={!canRefresh()}
        title={lastRefreshError() ? `Last refresh failed: ${lastRefreshError()}` : "Refresh now"}
        aria-label={`Refresh now${lastLoaded() === null ? "" : `, last loaded ${label()}`}`}
        onClick={() => void refreshNow()}
      >
        <RefreshIcon size={14} class={isRefreshing() ? "animate-spin" : ""} />
        <Show when={lastRefreshError()}>
          <WarningIcon size={13} class="text-error-dot" />
        </Show>
        <span class="hidden tabular-nums sm:inline">{label()}</span>
      </button>
      <label class="relative flex items-center border-l border-border-strong">
        <span class="sr-only">Auto-refresh</span>
        <select
          class="h-full appearance-none bg-transparent pr-2 pl-2 text-fg-muted hover:bg-surface-2 hover:text-fg"
          value={String(autoRefresh())}
          onChange={(event) => {
            setAutoRefresh(Number(event.currentTarget.value) as AutoRefreshSeconds);
          }}
        >
          <For each={AUTO_REFRESH_OPTIONS}>
            {(seconds) => (
              <option value={String(seconds)}>
                {seconds === 0 ? "Auto: Off" : `Auto: ${seconds}s`}
              </option>
            )}
          </For>
        </select>
      </label>
    </div>
  );
};

const themeOrder: ThemePreference[] = ["system", "light", "dark"];
const themeLabels: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const ThemeToggle = () => {
  const next = () => themeOrder[(themeOrder.indexOf(themePreference()) + 1) % themeOrder.length];
  return (
    <button
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
      title={`Theme: ${themeLabels[themePreference()]} (switch to ${themeLabels[next()]})`}
      aria-label={`Theme: ${themeLabels[themePreference()]}. Switch to ${themeLabels[next()]}`}
      onClick={() => {
        setThemePreference(next());
      }}
    >
      <Show when={themePreference() !== "system"} fallback={<MonitorIcon />}>
        <Show when={themePreference() === "dark"} fallback={<SunIcon />}>
          <MoonIcon />
        </Show>
      </Show>
    </button>
  );
};

export const TopBar = () => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const localPath = () => toLocalPath(location.pathname);
  const shortcut = () => (isMac() ? "⌘K" : "Ctrl K");

  const navLinks = (onNavigate?: () => void) => (
    <For each={navItems}>
      {(item) => (
        <A
          href={item.href}
          class="rounded-xs px-2.5 py-1.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg data-[active]:bg-surface-2 data-[active]:font-medium data-[active]:text-fg"
          data-active={item.match(localPath()) ? "" : undefined}
          aria-current={item.match(localPath()) ? "page" : undefined}
          onClick={() => onNavigate?.()}
        >
          {item.label}
        </A>
      )}
    </For>
  );

  return (
    <header class="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-xs text-fg-muted hover:bg-surface-2 sm:hidden"
          aria-label="Menu"
          aria-expanded={menuOpen()}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Show when={menuOpen()} fallback={<MenuIcon />}>
            <CloseIcon />
          </Show>
        </button>
        <A href="/" class="flex items-center gap-2 font-semibold">
          <LogoIcon size={18} class="text-brand" />
          <span>Queuert</span>
        </A>
        <nav class="ml-2 hidden items-center gap-1 sm:flex" aria-label="Main">
          {navLinks()}
        </nav>
        <span class="flex-1" />
        <button
          type="button"
          class="hidden h-8 w-64 items-center gap-2 rounded-xs border border-border-strong bg-surface px-2.5 text-left text-sm text-fg-subtle hover:border-fg-subtle lg:flex"
          onClick={openFind}
        >
          <SearchIcon size={14} />
          <span class="flex-1 truncate">Find chains or jobs by ID…</span>
          <kbd class="rounded-xs border border-border px-1 text-[11px]">{shortcut()}</kbd>
        </button>
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-xs text-fg-muted hover:bg-surface-2 hover:text-fg lg:hidden"
          aria-label="Find chains or jobs by ID"
          onClick={openFind}
        >
          <SearchIcon />
        </button>
        <RefreshControl />
        <ThemeToggle />
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
      </div>
      <Show when={menuOpen()}>
        <nav
          class="flex flex-col gap-1 border-t border-border px-4 py-2 sm:hidden"
          aria-label="Main"
        >
          {navLinks(() => setMenuOpen(false))}
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
    </header>
  );
};
