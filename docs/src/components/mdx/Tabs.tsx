import { For, type JSX, children, createSignal, createUniqueId } from "solid-js";
import { createStore } from "solid-js/store";

type TabItemProps = { label: string; children: JSX.Element };

const [syncedTabs, setSyncedTabs] = createStore<Record<string, string>>({});

const isTabItem = (item: unknown): item is TabItemProps =>
  typeof item === "object" && item !== null && "label" in item;

export const TabItem = (props: TabItemProps) => props as unknown as JSX.Element;

export const Tabs = (props: { syncKey?: string; children: JSX.Element }) => {
  const resolved = children(() => props.children);
  const items = () => (resolved.toArray() as unknown[]).filter(isTabItem);
  const [local, setLocal] = createSignal<string>();
  const id = createUniqueId();

  const selected = () => {
    const labels = items().map((item) => item.label);
    const synced = props.syncKey === undefined ? undefined : syncedTabs[props.syncKey];
    if (synced !== undefined && labels.includes(synced)) return synced;
    return local() ?? labels[0];
  };

  const select = (label: string) => {
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
            </button>
          )}
        </For>
      </div>
      <For each={items()}>
        {(item, index) => (
          <div
            role="tabpanel"
            data-tab-label={item.label}
            id={`${id}-panel-${index()}`}
            aria-labelledby={`${id}-tab-${index()}`}
            hidden={selected() !== item.label}
            class="pt-3 [&>*:first-child]:mt-0 [&>*+*]:mt-3"
          >
            {item.children}
          </div>
        )}
      </For>
    </div>
  );
};
