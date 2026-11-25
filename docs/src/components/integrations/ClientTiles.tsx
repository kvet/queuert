import { For, Show } from "solid-js";

import { installCommand, packageManagers } from "../../data/installation.tsx";
import { commandHtml } from "../commandHtml.ts";
import { Code } from "../mdx/Code.tsx";
import { createSyncedTabs, selectSyncedTab } from "../mdx/Tabs.tsx";

export type ClientTile = {
  name: string;
  /** The label of this client's tab in the page's synced Tabs. */
  tab: string;
  packages: string;
  badge?: string;
};

/**
 * Compact picker of the clients (drivers, ORMs) a backend supports. Clicking a tile selects its
 * tab in every synced Tabs on the page and jumps to `anchor`; the picked tile stays marked.
 */
export const ClientTiles = (props: {
  syncKey: string;
  anchor: string;
  /** The adapter package; the terminal below the tiles adds the picked driver's packages to it. */
  adapterPackage: string;
  groups: { label: string; items: ClientTile[] }[];
}) => {
  const syncedTab = createSyncedTabs();
  const items = () => props.groups.flatMap((group) => group.items);
  const selected = () =>
    items().find((item) => item.tab === syncedTab(props.syncKey)) ?? items()[0];
  const command = () => {
    const manager =
      packageManagers.find((option) => option.label === syncedTab("pkg")) ?? packageManagers[0];
    const driverPackages = selected().packages.includes(" ")
      ? selected().packages.split(" · ")
      : [selected().packages];
    return installCommand(manager.install, [
      props.adapterPackage,
      ...driverPackages.filter((name) => !name.startsWith("built into")),
    ]);
  };
  return (
    <div class="my-6 flex flex-col gap-4">
      <For each={props.groups}>
        {(group) => (
          <div>
            <div class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
              {group.label}
            </div>
            <ul class="row-list m-0 grid list-none grid-cols-2 gap-2 p-0 lg:grid-cols-4">
              <For each={group.items}>
                {(item) => (
                  <li class="m-0 min-w-0">
                    <a
                      href={`#${props.anchor}`}
                      class="unstyled flex h-full flex-col gap-0.5 rounded-xs border border-border px-3 py-2 no-underline transition-colors hover:border-border-strong hover:bg-surface-2/50 aria-current:border-accent-fg aria-current:bg-surface-2 aria-current:shadow-[inset_0_0_0_1px_var(--color-accent-fg)]"
                      aria-current={selected() === item ? "true" : undefined}
                      onClick={() => {
                        selectSyncedTab(props.syncKey, item.tab);
                      }}
                    >
                      <span class="flex items-center justify-between gap-2">
                        <span class="truncate text-[13px] font-semibold text-fg">{item.name}</span>
                        <Show when={item.badge}>
                          {(badge) => (
                            <span class="shrink-0 font-mono text-[10px] tracking-wider text-fg-subtle uppercase">
                              {badge()}
                            </span>
                          )}
                        </Show>
                      </span>
                      <span class="font-mono text-[11px] wrap-break-word text-fg-subtle">
                        {item.packages}
                      </span>
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
      <Code lang="bash" code={command()} html={commandHtml(command())} />
    </div>
  );
};
