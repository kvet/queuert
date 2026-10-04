import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

import { basePath } from "../base.js";
import { tickNow } from "./clock.js";
import { readStored, storageKey, writeStored } from "./storage.js";

export const AUTO_REFRESH_OPTIONS = [0, 15, 30, 60] as const;
export type AutoRefreshSeconds = (typeof AUTO_REFRESH_OPTIONS)[number];

const key = storageKey(basePath, "refresh");

const readAuto = (): AutoRefreshSeconds => {
  const stored = Number(readStored(key));
  return (AUTO_REFRESH_OPTIONS as readonly number[]).includes(stored)
    ? (stored as AutoRefreshSeconds)
    : 0;
};

const [handlers, setHandlers] = createSignal<(() => Promise<void>)[]>([]);
const handler = () => handlers().at(-1);
const [lastLoadedAt, setLastLoadedAt] = createSignal<number | null>(null);
const [refreshing, setRefreshing] = createSignal(false);
const [refreshError, setRefreshError] = createSignal<string | null>(null);
const [autoSeconds, setAutoSecondsSignal] = createSignal<AutoRefreshSeconds>(readAuto());

/** Time of the current page's last successful load or refresh, for the "8s ago" label. */
export const lastLoaded: Accessor<number | null> = lastLoadedAt;
export const isRefreshing: Accessor<boolean> = refreshing;
export const lastRefreshError: Accessor<string | null> = refreshError;
export const autoRefresh: Accessor<AutoRefreshSeconds> = autoSeconds;
export const canRefresh = (): boolean => handler() !== undefined;

export const setAutoRefresh = (seconds: AutoRefreshSeconds): void => {
  setAutoSecondsSignal(seconds);
  writeStored(key, String(seconds));
};

export const markLoaded = (): void => {
  setLastLoadedAt(Date.now());
  tickNow();
};

/** Refreshes the current page in place; a refresh already in flight is not started twice. */
export const refreshNow = async (): Promise<void> => {
  const run = handler();
  if (!run || refreshing()) return;
  setRefreshing(true);
  try {
    await run();
    // A page left mid-refresh doesn't get to report on the page that replaced it.
    if (handler() !== run) return;
    setRefreshError(null);
    markLoaded();
  } catch (error) {
    if (handler() !== run) return;
    setRefreshError(error instanceof Error ? error.message : String(error));
  } finally {
    setRefreshing(false);
  }
};

/**
 * Registers the current view's in-place refresh until it unmounts. The most recent registration
 * wins, so a view nested inside a page (e.g. the type picker on a list page) takes over while it
 * is mounted and hands back to the page when it goes away.
 */
export const useRefresh = (run: () => Promise<void>): void => {
  setLastLoadedAt(null);
  setRefreshError(null);
  setHandlers((list) => [...list, run]);
  onCleanup(() => {
    setHandlers((list) => list.filter((entry) => entry !== run));
  });
};

/** Drives auto-refresh; mounted once by the shell. Skips ticks while the tab is hidden. */
export const createAutoRefresh = (): void => {
  createEffect(() => {
    const seconds = autoSeconds();
    if (seconds === 0) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refreshNow();
    }, seconds * 1000);
    onCleanup(() => {
      clearInterval(timer);
    });
  });
};
