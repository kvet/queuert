import { JOB_STATUSES } from "@queuert/ui/lib";
import { useSearchParams } from "@solidjs/router";
import { useInfiniteQuery, useQuery } from "@tanstack/solid-query";
import { Show, createMemo } from "solid-js";

import { JobRow, type JobSortKey } from "../rows/JobRow.tsx";
import { jobCountsQuery, jobListQuery, jobTypeNamesQuery } from "../state/queries.ts";
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

  const typeNames = useQuery(() => jobTypeNamesQuery());
  const counts = useQuery(() => jobCountsQuery(props.typeName));
  const statusCounts = () =>
    counts.isSuccess ? toStatusCounts(JOB_STATUSES, counts.data) : undefined;

  const list = useInfiniteQuery(() =>
    jobListQuery({
      typeName: props.typeName,
      status: status() || undefined,
      orderBy: effectiveOrderBy(),
      orderDirection: orderDirection(),
    }),
  );

  return (
    <div>
      <ListHeader
        typeName={props.typeName}
        typeNames={typeNames.isSuccess ? typeNames.data : undefined}
      />
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
        query={list}
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
