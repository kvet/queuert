import { Tabs as TabsPrimitive } from "@kobalte/core/tabs";
import type { JSX } from "@solidjs/web";
import { For, children, createSignal, createStore, snapshot } from "solid-js";

import { createHydrated } from "../hydrated.ts";

type TabItemProps = { label: string; badge?: string; children: JSX.Element };

const [syncedTabs, setSyncedTabs] = createStore<Record<string, string>>({});

const syncedTabsStorageKey = "queuert-docs:tabs";

/** Selects `label` in every `Tabs` with this `syncKey` and remembers it in this browser. */
export const selectSyncedTab = (syncKey: string, label: string) => {
  setSyncedTabs((tabs) => {
    tabs[syncKey] = label;
  });
  try {
    localStorage.setItem(
      syncedTabsStorageKey,
      JSON.stringify({ ...snapshot(syncedTabs), [syncKey]: label }),
    );
  } catch {}
};

/** Restores the reader's remembered tabs; runs after hydration so the prerendered tab matches. */
export const restoreSyncedTabs = () => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(syncedTabsStorageKey) ?? "{}");
    if (typeof stored !== "object" || stored === null) return;
    setSyncedTabs((tabs) => {
      for (const [syncKey, label] of Object.entries(stored)) {
        if (typeof label === "string") tabs[syncKey] = label;
      }
    });
  } catch {}
};

export const createSyncedTabs = (): ((syncKey: string) => string | undefined) => {
  const hydrated = createHydrated();
  return (syncKey) => (hydrated() ? syncedTabs[syncKey] : undefined);
};

const isTabItem = (item: unknown): item is TabItemProps =>
  typeof item === "object" && item !== null && "label" in item;

export const TabItem = (props: TabItemProps) => props as unknown as JSX.Element;

/** `syncKey` keeps every Tabs with the same key on the selected label, across pages and visits. */
export const Tabs = (props: { syncKey?: string; children: JSX.Element }) => {
  const resolved = children(() => props.children);
  const items = () => (resolved.toArray() as unknown[]).filter(isTabItem);
  const [local, setLocal] = createSignal<string>();
  const [switched, setSwitched] = createSignal(false);
  const syncedTab = createSyncedTabs();

  const selected = () => {
    const labels = items().map((item) => item.label);
    const synced = props.syncKey === undefined ? undefined : syncedTab(props.syncKey);
    if (synced !== undefined && labels.includes(synced)) return synced;
    return local() ?? labels[0];
  };

  const select = (label: string) => {
    setSwitched(true);
    setLocal(label);
    if (props.syncKey !== undefined) selectSyncedTab(props.syncKey, label);
  };

  return (
    <TabsPrimitive class="my-5" value={selected()} onChange={select}>
      <TabsPrimitive.List class="flex flex-wrap gap-1 border-b border-border pb-2">
        <For each={items()}>
          {(item) => (
            <TabsPrimitive.Trigger
              value={item.label}
              class="rounded-xs px-2 py-0.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg data-selected:bg-fg data-selected:text-bg"
            >
              {item.label}
              {item.badge === undefined ? null : (
                <span class="ml-1.5 font-mono text-[10px] tracking-wider uppercase opacity-70">
                  {item.badge}
                </span>
              )}
            </TabsPrimitive.Trigger>
          )}
        </For>
      </TabsPrimitive.List>
      <For each={items()}>
        {(item) => (
          <TabsPrimitive.Content
            value={item.label}
            forceMount
            data-tab-label={item.label}
            hidden={selected() !== item.label}
            class={[
              "min-w-0 pt-3 [&>*:first-child]:mt-0 [&>*+*]:mt-3",
              { "animate-fade-in": switched() && selected() === item.label },
            ]}
          >
            {item.children}
          </TabsPrimitive.Content>
        )}
      </For>
    </TabsPrimitive>
  );
};
