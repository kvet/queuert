import { createClient, defineJobTypes, createInProcessStateAdapter } from "queuert";
import { describe, expect, it } from "vitest";

import { createDashboard } from "../api/dashboard.ts";
import { parseBody, rpcRequest, createTestDashboard, createJob } from "./dashboard.spec-helper.ts";

describe("createDashboard mounting", () => {
  describe("sub-path mounting", () => {
    it("serves the RPC endpoint under basePath", async () => {
      const { call, stateAdapter } = await createTestDashboard("/internal/queuert");
      const job = await createJob(stateAdapter, "test-type", { key: "value" });

      expect((await call("listChains", { typeName: "test-type" })).status).toBe(200);
      expect((await call("getChainDetail", { id: job.chainId })).status).toBe(200);
      expect((await call("getJobDetail", { id: job.id })).status).toBe(200);
    });

    it("returns 404 for requests outside basePath", async () => {
      const dashboard = createDashboard({
        client: createClient({
          stateAdapter: createInProcessStateAdapter({ mode: "async" }),
          jobTypes: defineJobTypes(),
        }),
        basePath: "/internal/queuert",
      });
      const res = await dashboard.fetch(rpcRequest("http://test/api/rpc", "getChainTypeNames"));
      expect(res.status).toBe(404);
    });

    it("returns 404 for paths that share a prefix with basePath", async () => {
      const dashboard = createDashboard({
        client: createClient({
          stateAdapter: createInProcessStateAdapter({ mode: "async" }),
          jobTypes: defineJobTypes(),
        }),
        basePath: "/app",
      });
      const res = await dashboard.fetch(
        rpcRequest("http://test/application/api/rpc", "getChainTypeNames"),
      );
      expect(res.status).toBe(404);
    });
  });
});

describe.each(["sync", "async"] as const)("createDashboard over a %s state adapter", (mode) => {
  it("reads, reschedules and deletes chains", async () => {
    const stateAdapter = createInProcessStateAdapter({ mode });
    const client = createClient({
      stateAdapter,
      jobTypes: defineJobTypes<{
        blocker: { entry: true; input: null; output: null };
        blocked: { entry: true; input: null; output: null; blockers: [{ typeName: "blocker" }] };
      }>(),
    });
    const dashboard = createDashboard({ client });
    const call = async (fn: string, data?: unknown) =>
      dashboard.fetch(rpcRequest("http://test/api/rpc", fn, data));
    const blocker = await stateAdapter.withTransaction(
      (txCtx): ReturnType<typeof client.createChain<"blocker">> =>
        client.createChain({
          ...txCtx,
          typeName: "blocker",
          input: null,
          schedule: { afterMs: 60_000 },
        }),
    );
    const blocked = await stateAdapter.withTransaction(
      (txCtx): ReturnType<typeof client.createChain<"blocked">> =>
        client.createChain({ ...txCtx, typeName: "blocked", input: null, blockers: [blocker] }),
    );

    const chains = await parseBody(await call("getChains", { ids: [blocker.id] }));
    expect(chains.map((chain: { id: string }) => chain.id)).toEqual([blocker.id]);

    expect((await call("rescheduleJob", { id: blocker.id })).status).toBe(200);
    expect((await client.getJob({ id: blocker.id }))!.scheduledAt.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );

    const refused = await parseBody(await call("deleteChain", { id: blocker.id }));
    expect(await refused.deleted).toEqual({ outcome: "blocked" });

    const deleted = await parseBody(await call("deleteChain", { id: blocked.id }));
    expect(await deleted.deleted).toEqual({ outcome: "deleted", count: 1 });
    expect(await client.getChain({ id: blocked.id })).toBeUndefined();
  });
});
