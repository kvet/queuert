import { useSearchParams } from "@solidjs/router";
import { For, Match, Switch, createMemo } from "solid-js";

import { PAGE_SIZE, countByChainTypeNames, listChainTypeNames, listChains } from "../api.js";
import { ChainRow } from "../rows/ChainRow.js";
import { createLoader } from "../state/createLoader.js";
import { createPagedList } from "../state/createPagedList.js";
import { useRefresh } from "../state/refresh.js";
import { EmptyState, buttonClass } from "../ui/kit.js";
import { CHAIN_STATUSES } from "../ui/status.js";
import { ListHeader, PagedListBody, SortControls, StatusTabs, TypeGate } from "./listParts.js";
import { toStatusCounts } from "./typeData.js";
import { chainKind } from "./Types.js";

const roles = [
  { value: undefined, label: "All" },
  { value: "true", label: "Independent" },
  { value: "false", label: "Used as blocker" },
] as const;

const ChainListForType = (props: { typeName: string }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = () => (searchParams.status ?? "") as string;
  const independentParam = () => searchParams.independent as string | undefined;
  const independent = () => {
    const value = independentParam();
    return value === "true" || value === "false" ? value === "true" : undefined;
  };
  const orderBy = () => (searchParams.orderBy ?? "") as string;
  const orderDirection = () => (searchParams.orderDirection ?? "desc") as string;

  const orderByOptions = createMemo(
    (): readonly { value: "createdAt" | "completedAt"; label: string }[] =>
      status() === "completed"
        ? [
            { value: "completedAt", label: "Completed" },
            { value: "createdAt", label: "Created" },
          ]
        : [{ value: "createdAt", label: "Created" }],
  );
  const effectiveOrderBy = createMemo(() => {
    const options = orderByOptions();
    return options.find((option) => option.value === orderBy())?.value ?? options[0].value;
  });

  const typeNames = createLoader(
    () => true,
    async (_, signal) => listChainTypeNames({ signal }),
  );
  const counts = createLoader(
    () => props.typeName,
    async (typeName, signal) => (await countByChainTypeNames([typeName], { signal }))[0],
  );
  const statusCounts = () => {
    const typeCounts = counts.data();
    return typeCounts ? toStatusCounts(CHAIN_STATUSES, typeCounts) : undefined;
  };

  const list = createPagedList(
    () => ({
      typeName: props.typeName,
      status: status() || undefined,
      independent: independent(),
      orderBy: effectiveOrderBy(),
      orderDirection: orderDirection(),
    }),
    async (params, cursor, signal) => listChains({ ...params, cursor, limit: PAGE_SIZE, signal }),
  );

  useRefresh(async () => {
    await Promise.all([typeNames.refetch(), counts.refetch(), list.refresh()]);
  });

  const roleClass = (selected: boolean) =>
    `px-2.5 py-1 text-sm ${selected ? "bg-fg text-bg font-medium" : "text-fg-muted hover:text-fg"} rounded-xs`;

  return (
    <div>
      <ListHeader typeName={props.typeName} typeNames={typeNames.data()} />
      <StatusTabs
        base="/chains"
        statuses={CHAIN_STATUSES}
        selected={status()}
        counts={statusCounts()}
      />
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex rounded-xs bg-surface-2 p-0.5" role="group" aria-label="Chain role">
          <For each={roles}>
            {(role) => (
              <button
                type="button"
                class={roleClass(independentParam() === role.value)}
                aria-pressed={independentParam() === role.value}
                onClick={() => {
                  setSearchParams({ independent: role.value });
                }}
              >
                {role.label}
              </button>
            )}
          </For>
        </div>
        <SortControls
          options={orderByOptions()}
          orderBy={effectiveOrderBy()}
          orderDirection={orderDirection()}
        />
      </div>

      <PagedListBody
        thing="chains"
        list={list}
        empty={
          <Switch>
            <Match when={status() && independent() !== undefined}>
              <EmptyState title={`No chains of ${props.typeName} match these filters`}>
                <button
                  type="button"
                  class={buttonClass.secondary}
                  onClick={() => {
                    setSearchParams({
                      status: undefined,
                      independent: undefined,
                      orderBy: undefined,
                    });
                  }}
                >
                  Clear filters
                </button>
              </EmptyState>
            </Match>
            <Match when={status()}>
              <EmptyState title={`No ${status()} chains of ${props.typeName}`}>
                <button
                  type="button"
                  class={buttonClass.secondary}
                  onClick={() => {
                    setSearchParams({ status: undefined, orderBy: undefined });
                  }}
                >
                  Show all statuses
                </button>
              </EmptyState>
            </Match>
            <Match when={independent() !== undefined}>
              <EmptyState title={`No chains of ${props.typeName} match these filters`}>
                <button
                  type="button"
                  class={buttonClass.secondary}
                  onClick={() => {
                    setSearchParams({ independent: undefined });
                  }}
                >
                  Clear filters
                </button>
              </EmptyState>
            </Match>
            <Match when={true}>
              <EmptyState title={`No chains of ${props.typeName} yet`} />
            </Match>
          </Switch>
        }
      >
        {(chain) => <ChainRow chain={chain} sortKey={effectiveOrderBy()} />}
      </PagedListBody>
    </div>
  );
};

export const ChainList = () => (
  <TypeGate title="Chains" kind={chainKind}>
    {(typeName) => <ChainListForType typeName={typeName} />}
  </TypeGate>
);
