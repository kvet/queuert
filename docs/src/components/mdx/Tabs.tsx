import { For, type JSX, children, createSignal, createUniqueId } from "solid-js";
import { createStore } from "solid-js/store";

type TabItemProps = { label: string; badge?: string; children: JSX.Element };

const [syncedTabs, setSyncedTabs] = createStore<Record<string, string>>({});

/** Selects `label` in every `Tabs` with this `syncKey`, e.g. from a card that jumps to a tab. */
export const selectSyncedTab = (syncKey: string, label: string) => {
  setSyncedTabs(syncKey, label);
};

/** The label the reader picked for `syncKey`, or `undefined` before they pick one. */
export const syncedTab = (syncKey: string): string | undefined => syncedTabs[syncKey];

const isTabItem = (item: unknown): item is TabItemProps =>
  typeof item === "object" && item !== null && "label" in item;

export const TabItem = (props: TabItemProps) => props as unknown as JSX.Element;

/** `syncKey` keeps every Tabs with the same key on the selected label. */
export const Tabs = (props: { syncKey?: string; children: JSX.Element }) => {
  const resolved = children(() => props.children);
  const items = () => (resolved.toArray() as unknown[]).filter(isTabItem);
  const [local, setLocal] = createSignal<string>();
  // Panels fade in only after the reader switches tabs, never on the first render.
  const [switched, setSwitched] = createSignal(false);
  const id = createUniqueId();

  const selected = () => {
    const labels = items().map((item) => item.label);
    const synced = props.syncKey === undefined ? undefined : syncedTabs[props.syncKey];
    if (synced !== undefined && labels.includes(synced)) return synced;
    return local() ?? labels[0];
  };

  const select = (label: string) => {
    setSwitched(true);
    setLocal(label);
    if (props.syncKey !== undefined) setSyncedTabs(props.syncKey, label);
  };

  return (
    <div class="my-5">
      <div role="tablist" class="flex flex-wrap gap-1 border-b border-border pb-2">
        <For each={items()}>
          {(item, index) => (
            <button
              type="button"
              role="tab"
              id={`${id}-tab-${index()}`}
              aria-controls={`${id}-panel-${index()}`}
              aria-selected={selected() === item.label}
              class="rounded-xs px-2 py-0.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg aria-selected:bg-fg aria-selected:text-bg"
              onClick={() => {
                select(item.label);
              }}
            >
              {item.label}
              {item.badge === undefined ? null : (
                <span class="ml-1.5 font-mono text-[10px] tracking-wider uppercase opacity-70">
                  {item.badge}
                </span>
              )}
            </button>
          )}
        </For>
      </div>
      <div>
        <For each={items()}>
          {(item, index) => (
            <div
              role="tabpanel"
              data-tab-label={item.label}
              id={`${id}-panel-${index()}`}
              aria-labelledby={`${id}-tab-${index()}`}
              hidden={selected() !== item.label}
              class={`min-w-0 pt-3 [&>*:first-child]:mt-0 [&>*+*]:mt-3 ${
                switched() && selected() === item.label ? "animate-fade-in" : ""
              }`}
            >
              {item.children}
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
