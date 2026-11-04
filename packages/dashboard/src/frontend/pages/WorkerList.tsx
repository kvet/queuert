import { useSearchParams } from "@solidjs/router";
import { Show } from "solid-js";

import { PAGE_SIZE, getJobTypeNames, listWorkers } from "../api.js";
import { WorkerRow } from "../rows/WorkerRow.js";
import { createLoader } from "../state/createLoader.js";
import { createPagedList } from "../state/createPagedList.js";
import { EmptyState, buttonClass } from "../ui/kit.js";
import { Select } from "../ui/Select.js";
import { FilterBar } from "./filters.js";
import { PagedListBody } from "./listParts.js";

export const WorkerList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const typeName = () => (searchParams.typeName ?? "") as string;

  const typeNames = createLoader(
    () => true,
    async (_, signal) => getJobTypeNames({ signal }),
  );
  const workers = createPagedList(
    () => ({ typeName: typeName() || undefined }),
    async (params, cursor, signal) => listWorkers({ ...params, cursor, limit: PAGE_SIZE, signal }),
  );

  return (
    <div>
      <div class="mb-5">
        <h1 class="text-base font-semibold">
          Workers{" "}
          <span class="text-sm font-normal text-fg-muted tabular-nums">
            {workers.loading() ? "" : `${workers.items().length}${workers.cursor() ? "+" : ""}`}
          </span>
        </h1>
      </div>
      <FilterBar>
        <Select
          label="Job type"
          value={typeName()}
          options={[
            { value: "", label: "All job types" },
            ...(typeNames.data() ?? []).map((name) => ({ value: name, label: name })),
          ]}
          onChange={(value) => {
            setSearchParams({ typeName: value || undefined });
          }}
        />
      </FilterBar>

      <PagedListBody
        thing="workers"
        list={workers}
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
