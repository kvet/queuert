import { JOB_STATUSES } from "@queuert/ui/lib";
import { useSearchParams } from "@solidjs/router";
import { Show, createMemo } from "solid-js";

import { PAGE_SIZE, serverFns } from "../api.ts";
import { JobRow, type JobSortKey } from "../rows/JobRow.tsx";
import { createLoader } from "../state/createLoader.ts";
import { createPagedList } from "../state/createPagedList.ts";
import { EmptyState, buttonClass } from "../ui/kit.tsx";
import { FilterBar, SortControls, StatusFilter } from "./filters.tsx";
import { ListHeader, PagedListBody, TypeGate } from "./listParts.tsx";
import { toStatusCounts } from "./typeData.ts";
import { jobKind } from "./Types.tsx";

const orderByOptionsFor = (status: string): readonly { value: JobSortKey; label: string }[] => {
  if (status === "blocked" || status === "pending")
    return [
      { value: "scheduledAt", label: "Scheduled" },
      { value: "createdAt", label: "Created" },
    ];
  if (status === "running")
    return [
      { value: "attemptAt", label: "Started" },
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
  const status = () => JOB_STATUSES.find((value) => value === searchParams.status) ?? "";
  const orderBy = () => (searchParams.orderBy ?? "") as string;
  const orderDirection = (): "asc" | "desc" =>
    searchParams.orderDirection === "asc" ? "asc" : "desc";

  const orderByOptions = createMemo(() => orderByOptionsFor(status()));
  const effectiveOrderBy = createMemo(() => {
    const options = orderByOptions();
    return options.find((option) => option.value === orderBy())?.value ?? options[0].value;
  });

  const typeNames = createLoader(
    () => true,
    async (_, signal) => serverFns.getJobTypeNames({ signal }),
  );
  const counts = createLoader(
    () => props.typeName,
    async (typeName, signal) =>
      (await serverFns.countJobsByTypeName({ data: { typeNames: [typeName] }, signal }))[0],
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
    async (params, cursor, signal) =>
      serverFns.listJobs({ data: { ...params, cursor, limit: PAGE_SIZE }, signal }),
  );

  return (
    <div>
      <ListHeader typeName={props.typeName} typeNames={typeNames.data()} />
      <FilterBar>
        <StatusFilter
          path="/jobs"
          statuses={JOB_STATUSES}
          selected={status()}
          counts={statusCounts()}
        />
        <SortControls
          options={orderByOptions()}
          orderBy={effectiveOrderBy()}
          orderDirection={orderDirection()}
        />
      </FilterBar>

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
