import { useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch } from "solid-js";

import { listJobTypeNames, listWorkers } from "../api.js";
import { WorkerRow } from "../rows/WorkerRow.js";
import { createLoader } from "../state/createLoader.js";
import { EmptyState, ErrorState, SkeletonRows, buttonClass } from "../ui/kit.js";
import { Select } from "../ui/Select.js";
import { FilterBar } from "./filters.js";

export const WorkerList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const typeName = () => (searchParams.typeName ?? "") as string;

  const typeNames = createLoader(
    () => true,
    async (_, signal) => listJobTypeNames({ signal }),
  );
  const workers = createLoader(typeName, async (name, signal) =>
    listWorkers({ typeName: name || undefined, signal }),
  );

  return (
    <div>
      <div class="mb-5">
        <h1 class="text-base font-semibold">
          Workers{" "}
          <span class="text-sm font-normal text-fg-muted tabular-nums">
            {workers.data()?.length ?? ""}
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

      <Switch>
        <Match when={workers.error()}>
          <ErrorState thing="workers" error={workers.error()} onRetry={workers.retry} />
        </Match>
        <Match when={workers.loading() || !workers.data()}>
          <div class="rounded-xs border border-border">
            <SkeletonRows />
          </div>
        </Match>
        <Match when={workers.data()?.length === 0}>
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
        </Match>
        <Match when={workers.data()}>
          {(items) => (
            <ul class="divide-y divide-border overflow-hidden rounded-xs border border-border">
              <For each={items()}>{(worker) => <WorkerRow worker={worker} />}</For>
            </ul>
          )}
        </Match>
      </Switch>
    </div>
  );
};
