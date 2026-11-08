import { CHAIN_STATUSES } from "@queuert/ui/lib";
import { useSearchParams } from "@solidjs/router";
import { Match, Switch, createMemo } from "solid-js";

import { PAGE_SIZE, serverFns } from "../api.ts";
import { ChainRow } from "../rows/ChainRow.tsx";
import { createLoader } from "../state/createLoader.ts";
import { createPagedList } from "../state/createPagedList.ts";
import { EmptyState, buttonClass } from "../ui/kit.tsx";
import { Select } from "../ui/Select.tsx";
import { FilterBar, SortControls, StatusFilter } from "./filters.tsx";
import { ListHeader, PagedListBody, TypeGate } from "./listParts.tsx";
import { toStatusCounts } from "./typeData.ts";
import { chainKind } from "./Types.tsx";

const roles = [
  { value: "", label: "All" },
  { value: "true", label: "Independent" },
  { value: "false", label: "Used as blocker" },
] as const;

const ChainListForType = (props: { typeName: string }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = () => CHAIN_STATUSES.find((value) => value === searchParams.status) ?? "";
  const independentParam = () => searchParams.independent as string | undefined;
  const independent = () => {
    const value = independentParam();
    return value === "true" || value === "false" ? value === "true" : undefined;
  };
  const orderBy = () => (searchParams.orderBy ?? "") as string;
  const orderDirection = (): "asc" | "desc" =>
    searchParams.orderDirection === "asc" ? "asc" : "desc";

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
    async (_, signal) => serverFns.getChainTypeNames({ signal }),
  );
  const counts = createLoader(
    () => props.typeName,
    async (typeName, signal) =>
      (await serverFns.countChainsByTypeName({ data: { typeNames: [typeName] }, signal }))[0],
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
    async (params, cursor, signal) =>
      serverFns.listChains({ data: { ...params, cursor, limit: PAGE_SIZE }, signal }),
  );

  return (
    <div>
      <ListHeader typeName={props.typeName} typeNames={typeNames.data()} />
      <FilterBar>
        <StatusFilter
          path="/chains"
          statuses={CHAIN_STATUSES}
          selected={status()}
          counts={statusCounts()}
        />
        <div class="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <div class="flex shrink-0 items-center gap-2">
            <span class="text-sm text-fg-muted" aria-hidden="true">
              Role
            </span>
            <Select
              label="Chain role"
              value={independentParam() ?? ""}
              options={roles}
              onChange={(value) => {
                setSearchParams({ independent: value || undefined });
              }}
            />
          </div>
          <SortControls
            options={orderByOptions()}
            orderBy={effectiveOrderBy()}
            orderDirection={orderDirection()}
          />
        </div>
      </FilterBar>

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
