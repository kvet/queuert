import { MutationObserver } from "@tanstack/solid-query";
import { createClient, createInProcessStateAdapter, defineJobTypes } from "queuert";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDashboard } from "../../api/dashboard.ts";
import { deleteChainMutation, rescheduleJobMutation } from "./mutations.ts";
import {
  blockedJobsQuery,
  chainDetailQuery,
  chainJobsQuery,
  chainTypeNamesQuery,
  jobDetailQuery,
  queryClient,
} from "./queries.ts";

const serveChains = async () => {
  const stateAdapter = createInProcessStateAdapter({ mode: "async" });
  const client = createClient({
    stateAdapter,
    jobTypes: defineJobTypes<{
      blocker: { entry: true; input: null; output: null };
      blocked: { entry: true; input: null; output: null; blockers: [{ typeName: "blocker" }] };
    }>(),
  });
  const dashboard = createDashboard({ client });
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) =>
    dashboard.fetch(new Request(new URL(input, "http://test/"), init)),
  );
  const blocker = await stateAdapter.withTransaction(
    async (txCtx): ReturnType<typeof client.createChain<"blocker">> =>
      client.createChain({
        ...txCtx,
        typeName: "blocker",
        input: null,
        schedule: { afterMs: 60_000 },
      }),
  );
  const blocked = await stateAdapter.withTransaction(
    async (txCtx): ReturnType<typeof client.createChain<"blocked">> =>
      client.createChain({ ...txCtx, typeName: "blocked", input: null, blockers: [blocker] }),
  );
  return { blocker, blocked };
};

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("dashboard mutations", () => {
  it("writes a rescheduled job into every cached view of it and refreshes the rest", async () => {
    const { blocker } = await serveChains();
    await queryClient.query(jobDetailQuery(blocker.id));
    await queryClient.query(chainDetailQuery(blocker.id));
    await queryClient.infiniteQuery(chainJobsQuery(blocker.id));
    await queryClient.query(chainTypeNamesQuery());

    const job = await new MutationObserver(queryClient, rescheduleJobMutation()).mutate(blocker.id);

    expect(job.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(queryClient.getQueryData(jobDetailQuery(blocker.id).queryKey)?.job).toEqual(job);
    expect(queryClient.getQueryData(chainDetailQuery(blocker.id).queryKey)?.jobs[0]).toEqual(job);
    expect(queryClient.getQueryState(chainTypeNamesQuery().queryKey)?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryData(chainJobsQuery(blocker.id).queryKey)?.pages[0].items[0],
    ).toEqual(job);
    expect(queryClient.getQueryState(jobDetailQuery(blocker.id).queryKey)?.isInvalidated).toBe(
      false,
    );
    expect(queryClient.getQueryState(chainJobsQuery(blocker.id).queryKey)?.isInvalidated).toBe(
      false,
    );
  });

  it("forgets a deleted chain and treats an already missing chain as deleted", async () => {
    const { blocked } = await serveChains();
    await queryClient.query(chainDetailQuery(blocked.id));

    const outcome = await new MutationObserver(queryClient, deleteChainMutation()).mutate(
      blocked.id,
    );
    const again = await new MutationObserver(queryClient, deleteChainMutation()).mutate(blocked.id);

    expect(outcome).toBe("deleted");
    expect(again).toBe("deleted");
    expect(queryClient.getQueryData(chainDetailQuery(blocked.id).queryKey)).toBeUndefined();
  });

  it("keeps a chain that other jobs still depend on", async () => {
    const { blocker } = await serveChains();
    await queryClient.query(chainDetailQuery(blocker.id));
    await queryClient.infiniteQuery(blockedJobsQuery({ chainId: blocker.id }));

    const outcome = await new MutationObserver(queryClient, deleteChainMutation()).mutate(
      blocker.id,
    );

    expect(outcome).toBe("blocked");
    expect(queryClient.getQueryData(chainDetailQuery(blocker.id).queryKey)).toBeDefined();
    expect(
      queryClient.getQueryState(blockedJobsQuery({ chainId: blocker.id }).queryKey)?.isInvalidated,
    ).toBe(true);
  });
});
