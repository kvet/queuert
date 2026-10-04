import { useSearchParams } from "@solidjs/router";
import { Show, createMemo } from "solid-js";

import { PAGE_SIZE, countByJobTypeNames, listJobTypeNames, listJobs } from "../api.js";
import { JobRow, type JobSortKey } from "../rows/JobRow.js";
import { createLoader } from "../state/createLoader.js";
import { createPagedList } from "../state/createPagedList.js";
import { useRefresh } from "../state/refresh.js";
import { EmptyState, buttonClass } from "../ui/kit.js";
import { JOB_STATUSES } from "../ui/status.js";
import { ListHeader, PagedListBody, SortControls, StatusTabs, TypeGate } from "./listParts.js";
import { toStatusCounts } from "./typeData.js";
import { jobKind } from "./Types.js";

const orderByOptionsFor = (status: string): readonly { value: JobSortKey; label: string }[] => {
  if (status === "blocked" || status === "pending")
    return [
      { value: "scheduledAt", label: "Scheduled" },
      { value: "createdAt", label: "Created" },
    ];
  if (status === "running")
    return [
      { value: "attemptAt", label: "Started" },
      { value: "attemptUntil", label: "Deadline" },
      { value: "createdAt", label: "Created" },
    ];
  if (status === "completed")
    return [
      { value: "completedAt", label: "Completed" },
      { value: "createdAt", label: "Created" },
    ];
  return [{ value: "createdAt", label: "Created" }];
};

const JobListForType = (props: { typeName: string }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = () => (searchParams.status ?? "") as string;
  const orderBy = () => (searchParams.orderBy ?? "") as string;
  const orderDirection = () => (searchParams.orderDirection ?? "desc") as string;

  const orderByOptions = createMemo(() => orderByOptionsFor(status()));
  const effectiveOrderBy = createMemo(() => {
    const options = orderByOptions();
    return options.find((option) => option.value === orderBy())?.value ?? options[0].value;
  });

  const typeNames = createLoader(
    () => true,
    async (_, signal) => listJobTypeNames({ signal }),
  );
  const counts = createLoader(
    () => props.typeName,
    async (typeName, signal) => (await countByJobTypeNames([typeName], { signal }))[0],
  );
  const statusCounts = () => {
    const typeCounts = counts.data();
    return typeCounts ? toStatusCounts(JOB_STATUSES, typeCounts) : undefined;
  };

  const list = createPagedList(
    () => ({
      typeName: props.typeName,
      status: status() || undefined,
      orderBy: effectiveOrderBy(),
      orderDirection: orderDirection(),
    }),
    async (params, cursor, signal) => listJobs({ ...params, cursor, limit: PAGE_SIZE, signal }),
  );

  useRefresh(async () => {
    await Promise.all([typeNames.refetch(), counts.refetch(), list.refresh()]);
  });

  return (
    <div>
      <ListHeader typeName={props.typeName} typeNames={typeNames.data()} />
      <StatusTabs
        base="/jobs"
        statuses={JOB_STATUSES}
        selected={status()}
        counts={statusCounts()}
      />
      <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
        <SortControls
          options={orderByOptions()}
          orderBy={effectiveOrderBy()}
          orderDirection={orderDirection()}
        />
      </div>

      <PagedListBody
        thing="jobs"
        list={list}
        empty={
          <Show
            when={status()}
            fallback={<EmptyState title={`No jobs of ${props.typeName} yet`} />}
          >
            <EmptyState title={`No ${status()} jobs of ${props.typeName}`}>
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
          </Show>
        }
      >
        {(job) => <JobRow job={job} sortKey={effectiveOrderBy()} />}
      </PagedListBody>
    </div>
  );
};

export const JobList = () => (
  <TypeGate title="Jobs" kind={jobKind}>
    {(typeName) => <JobListForType typeName={typeName} />}
  </TypeGate>
);
