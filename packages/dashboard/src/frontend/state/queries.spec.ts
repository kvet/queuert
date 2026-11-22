import { QueryClient } from "@tanstack/solid-query";
import {
  type InProcessStateAdapter,
  createClient,
  createInProcessStateAdapter,
  defineJobTypes,
} from "queuert";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDashboard } from "../../api/dashboard.ts";
import { PAGE_SIZE, isNotFound } from "../api.ts";
import {
  chainDetailQuery,
  chainJobsQuery,
  chainListQuery,
  chainTypeNamesQuery,
  optionalWorkerQuery,
  workerQuery,
} from "./queries.ts";

const createChains = async (stateAdapter: InProcessStateAdapter<"async">, count: number) =>
  stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: Array.from({ length: count }, () => ({
        id: stateAdapter.config.generateJobId(),
        typeName: "test-type",
        input: null,
      })),
    }),
  );

const serveDashboard = () => {
  const stateAdapter = createInProcessStateAdapter({ mode: "async" });
  const dashboard = createDashboard({
    client: createClient({ stateAdapter, jobTypes: defineJobTypes() }),
  });
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    requests.push(input);
    return dashboard.fetch(new Request(new URL(input, "http://test/"), init));
  });
  return { stateAdapter, requests };
};

const listParams = {
  typeName: "test-type",
  status: undefined,
  blocking: undefined,
  orderBy: "createdAt",
  orderDirection: "desc",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboard queries", () => {
  it("pages a list by cursor until the server reports no next page", async () => {
    const { stateAdapter } = serveDashboard();
    await createChains(stateAdapter, PAGE_SIZE + 1);
    const queryClient = new QueryClient();

    const data = await queryClient.infiniteQuery({ ...chainListQuery(listParams), pages: 3 });

    expect(data.pages.map((page) => page.items.length)).toEqual([PAGE_SIZE, 1]);
    expect(new Set(data.pages.flatMap((page) => page.items.map((chain) => chain.id))).size).toBe(
      PAGE_SIZE + 1,
    );
    expect(data.pageParams).toEqual([undefined, data.pages[0].nextCursor]);
  });

  it("keys a list by its filters, so each filter combination is cached apart", () => {
    expect(chainListQuery(listParams).queryKey).toEqual(["chains", "listChains", listParams]);
    expect(chainListQuery({ ...listParams, status: "completed" }).queryKey).not.toEqual(
      chainListQuery(listParams).queryKey,
    );
  });

  it("serves a fresh read from the cache shared between pages", async () => {
    const { stateAdapter, requests } = serveDashboard();
    await createChains(stateAdapter, 1);
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });

    const first = await queryClient.query(chainTypeNamesQuery());
    const second = await queryClient.query(chainTypeNamesQuery());

    expect(first).toEqual(["test-type"]);
    expect(second).toBe(first);
    expect(requests).toHaveLength(1);
  });

  it("takes the first page of a chain's jobs from the chain detail in the same cache", async () => {
    const { stateAdapter, requests } = serveDashboard();
    await createChains(stateAdapter, 1);
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
    const list = await queryClient.infiniteQuery(chainListQuery(listParams));
    const chainId = list.pages[0].items[0].id;
    requests.length = 0;

    const detail = await queryClient.query(chainDetailQuery(chainId));
    const jobs = await queryClient.infiniteQuery(chainJobsQuery(chainId));

    expect(jobs.pages[0].items).toEqual(detail.jobs);
    expect(jobs.pages[0].nextCursor).toBe(detail.nextCursor);
    expect(requests).toHaveLength(1);
  });

  it("resolves a missing worker to null for optional reads and rejects otherwise", async () => {
    serveDashboard();
    const queryClient = new QueryClient();

    const optional = await queryClient.query(optionalWorkerQuery("missing"));
    const required = await queryClient
      .query(workerQuery("missing"))
      .catch((error: unknown) => error);

    expect(optional).toBeNull();
    expect(isNotFound(required)).toBe(true);
  });
});
