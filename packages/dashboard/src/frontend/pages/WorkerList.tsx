import { useSearchParams } from "@solidjs/router";
import { useInfiniteQuery, useQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";

import { formatCount } from "../domain/counts.ts";
import { loadedItems } from "../domain/pages.ts";
import { WorkerRow } from "../rows/WorkerRow.tsx";
import { jobTypeNamesQuery, workerListQuery } from "../state/queries.ts";
import { EmptyState, buttonClass } from "../ui/kit.tsx";
import { Select } from "../ui/Select.tsx";
import { FilterBar } from "./filters.tsx";
import { PagedListBody } from "./listParts.tsx";

export const WorkerList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const typeName = () => (searchParams.typeName ?? "") as string;

  const typeNames = useQuery(() => jobTypeNamesQuery());
  const workers = useInfiniteQuery(() => workerListQuery({ typeName: typeName() || undefined }));
  const workerCount = () =>
    workers.isSuccess
      ? formatCount({ count: loadedItems(workers.data.pages).length, hasMore: workers.hasNextPage })
      : "";

  return (
    <div>
      <div class="mb-5">
        <h1 class="text-base font-semibold">
          Workers{" "}
          <span class="text-sm font-normal text-fg-muted tabular-nums">{workerCount()}</span>
        </h1>
      </div>
      <FilterBar>
        <Select
          label="Job type"
          value={typeName()}
          options={[
            { value: "", label: "All job types" },
            ...(typeNames.isSuccess ? typeNames.data : []).map((name) => ({
              value: name,
              label: name,
            })),
          ]}
          onChange={(value) => {
            setSearchParams({ typeName: value || undefined });
          }}
        />
      </FilterBar>

      <PagedListBody
        thing="workers"
        query={workers}
        empty={
          <Show when={typeName()} fallback={<EmptyState title="No workers" />}>
            <EmptyState title={`No workers process ${typeName()}`}>
              <button
                type="button"
                class={buttonClass.secondary}
                onClick={() => {
                  setSearchParams({ typeName: undefined });
                }}
              >
                Show all workers
              </button>
            </EmptyState>
          </Show>
        }
      >
        {(worker) => <WorkerRow worker={worker} />}
      </PagedListBody>
    </div>
  );
};
