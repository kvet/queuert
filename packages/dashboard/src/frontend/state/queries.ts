import { QueryClient, infiniteQueryOptions, queryOptions } from "@tanstack/solid-query";
import type { Page } from "queuert";

import { PAGE_SIZE, isNotFound, serverFns } from "../api.ts";
import { loadChainTypes, loadJobTypes } from "../pages/typeData.ts";

export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: false, refetchOnWindowFocus: true },
  },
});

export const chainTypeNamesQuery = () =>
  queryOptions({
    queryKey: ["chains", "typeNames"],
    queryFn: async ({ signal }) => serverFns.getChainTypeNames({ signal }),
  });

export const jobTypeNamesQuery = () =>
  queryOptions({
    queryKey: ["jobs", "typeNames"],
    queryFn: async ({ signal }) => serverFns.getJobTypeNames({ signal }),
  });

export const chainTypesQuery = () =>
  queryOptions({
    queryKey: ["chains", "types"],
    queryFn: async ({ signal }) => loadChainTypes(signal),
  });

export const jobTypesQuery = () =>
  queryOptions({
    queryKey: ["jobs", "types"],
    queryFn: async ({ signal }) => loadJobTypes(signal),
  });

export const workerCountsQuery = () =>
  queryOptions({
    queryKey: ["workers", "counts"],
    queryFn: async ({ signal }) => serverFns.countWorkers({ signal }),
  });

export const chainCountsQuery = (typeName: string) =>
  queryOptions({
    queryKey: ["chains", "counts", typeName],
    queryFn: async ({ signal }) =>
      (await serverFns.countChainsByTypeName({ data: { typeNames: [typeName] }, signal }))[0],
  });

export const jobCountsQuery = (typeName: string) =>
  queryOptions({
    queryKey: ["jobs", "counts", typeName],
    queryFn: async ({ signal }) =>
      (await serverFns.countJobsByTypeName({ data: { typeNames: [typeName] }, signal }))[0],
  });

type ListParams<TList> = TList extends (options: { data: infer TData }) => unknown
  ? Omit<TData, "cursor" | "limit">
  : never;

const listQuery = <TParams, TItem>(
  queryKey: unknown[],
  params: TParams,
  list: (options: {
    data: TParams & { cursor: string | undefined; limit: number };
    signal: AbortSignal;
  }) => Promise<Page<TItem>>,
) =>
  infiniteQueryOptions({
    queryKey: [...queryKey, params],
    queryFn: async ({ pageParam, signal }) =>
      list({ data: { ...params, cursor: pageParam, limit: PAGE_SIZE }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const chainListQuery = (params: ListParams<typeof serverFns.listChains>) =>
  listQuery(["chains", "listChains"], params, serverFns.listChains);

export const jobListQuery = (params: ListParams<typeof serverFns.listJobs>) =>
  listQuery(["jobs", "listJobs"], params, serverFns.listJobs);

export const workerListQuery = (params: ListParams<typeof serverFns.listWorkers>) =>
  listQuery(["workers", "listWorkers"], params, serverFns.listWorkers);

export const workerJobsQuery = (params: ListParams<typeof serverFns.listWorkerJobs>) =>
  listQuery(["jobs", "listWorkerJobs"], params, serverFns.listWorkerJobs);

export const blockedJobsQuery = (params: ListParams<typeof serverFns.listBlockedJobs>) =>
  listQuery(["jobs", "listBlockedJobs"], params, serverFns.listBlockedJobs);

export const jobDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["jobs", "detail", id],
    queryFn: async ({ signal }) => serverFns.getJobDetail({ data: { id }, signal }),
  });

export const chainDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["chains", "detail", id],
    queryFn: async ({ signal }) =>
      serverFns.getChainDetail({ data: { id, limit: PAGE_SIZE }, signal }),
  });

export const workerQuery = (id: string) =>
  queryOptions({
    queryKey: ["workers", "detail", id],
    queryFn: async ({ signal }) => serverFns.getWorker({ data: { id }, signal }),
  });

export const optionalWorkerQuery = (id: string) =>
  queryOptions({
    queryKey: ["workers", "detail", id, "optional"],
    queryFn: async ({ signal }) =>
      serverFns.getWorker({ data: { id }, signal }).catch((error: unknown) => {
        if (isNotFound(error)) return null;
        throw error;
      }),
  });

export const findQuery = (ids: string[]) =>
  queryOptions({
    queryKey: ["find", ids],
    queryFn: async ({ signal }) => {
      const [chains, jobs, workers] = await Promise.all([
        serverFns.getChains({ data: { ids }, signal }),
        serverFns.getJobs({ data: { ids }, signal }),
        serverFns.getWorkers({ data: { ids }, signal }),
      ]);
      return { chains, jobs, workers };
    },
  });

export const chainJobsQuery = (chainId: string) =>
  infiniteQueryOptions({
    queryKey: ["chains", "detail", chainId, "jobs"],
    queryFn: async ({ client, pageParam, signal }) => {
      const page =
        pageParam === undefined
          ? await client.query(chainDetailQuery(chainId))
          : await serverFns.listChainJobs({
              data: { chainId, cursor: pageParam, limit: PAGE_SIZE },
              signal,
            });
      return { items: page.jobs, jobBlockers: page.jobBlockers, nextCursor: page.nextCursor };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
