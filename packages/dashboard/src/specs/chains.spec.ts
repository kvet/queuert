import { describe, expect, it } from "vitest";

import {
  parseBody,
  createTestDashboard,
  createJob,
  createContinuation,
  startAttempt,
  startWorker,
  completeJob,
  addBlocker,
} from "./dashboard.spec-helper.ts";

describe("chain server functions", () => {
  describe("listChains", () => {
    it("returns an empty page for a type with no chains", async () => {
      const { call } = await createTestDashboard();
      const res = await call("listChains", { typeName: "test-type" });

      expect(res.status).toBe(200);
      expect(await parseBody(res)).toEqual({ items: [], nextCursor: null });
    });

    it("returns chains as serialized chain objects with Date fields", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "test-type", { key: "value" });

      const body = await parseBody(await call("listChains", { typeName: "test-type" }));

      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(root.id);
      expect(body.items[0].typeName).toBe("test-type");
      expect(body.items[0].createdAt).toBeInstanceOf(Date);
    });

    it("returns chain with continuation", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      await createContinuation(stateAdapter, "chain-step2", root.id, { step: 2 });

      const body = await parseBody(await call("listChains", { typeName: "chain-type" }));

      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(root.id);
      expect(body.items[0].status).toBe("running");
    });

    it("respects limit", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      for (let i = 0; i < 5; i++) {
        await createJob(stateAdapter, "test-type", null);
      }

      const body = await parseBody(await call("listChains", { typeName: "test-type", limit: 2 }));

      expect(body.items).toHaveLength(2);
      expect(body.nextCursor).not.toBeNull();
    });

    it("filters by independent=true, independent=false, or neither", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "test-type", null);
      const mainChain = await createJob(stateAdapter, "test-type", null);
      await addBlocker(stateAdapter, mainChain.id, blockerChain.chainId);

      const ids = async (independent?: boolean) =>
        (await parseBody(await call("listChains", { typeName: "test-type", independent }))).items
          .map((c: { id: string }) => c.id)
          .sort();

      expect(await ids()).toEqual([blockerChain.chainId, mainChain.chainId].sort());
      expect(await ids(true)).toEqual([mainChain.chainId]);
      expect(await ids(false)).toEqual([blockerChain.chainId]);
    });

    it("filters by chain status", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const running = await createJob(stateAdapter, "running-type", null);
      const done = await createJob(stateAdapter, "done-type", null);
      await startWorker(stateAdapter, "worker-1", ["done-type"]);
      await startAttempt(stateAdapter, "done-type");
      await completeJob(stateAdapter, done.id, { output: null });

      const completed = await parseBody(
        await call("listChains", { typeName: "done-type", status: "completed" }),
      );
      const inProgress = await parseBody(
        await call("listChains", { typeName: "running-type", status: "running" }),
      );

      expect(completed.items.map((c: { id: string }) => c.id)).toEqual([done.chainId]);
      expect(inProgress.items.map((c: { id: string }) => c.id)).toEqual([running.chainId]);
    });

    it("rejects an unknown status, or an orderBy the status does not sort by, with 400", async () => {
      const { call } = await createTestDashboard();

      const statusRes = await call("listChains", { typeName: "test-type", status: "bogus" });
      const orderByRes = await call("listChains", {
        typeName: "test-type",
        orderBy: "completedAt",
      });

      expect(statusRes.status).toBe(400);
      expect(orderByRes.status).toBe(400);
      expect((await parseBody(orderByRes)).error).toContain("data.orderBy");
    });
  });

  describe("getChainDetail", () => {
    it("returns chain detail with jobs", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      await createContinuation(stateAdapter, "chain-step2", root.id, { step: 2 });

      const body = await parseBody(await call("getChainDetail", { id: root.chainId }));

      expect(body.chain.id).toBe(root.id);
      expect(body.jobs).toHaveLength(2);
      expect(body.nextCursor).toBeNull();
      expect(body.currentJob.typeName).toBe("chain-step2");
    });

    it("returns the tail job as currentJob even when it is past the first page", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      const step2 = await createContinuation(stateAdapter, "chain-step2", root.id, { step: 2 });

      const body = await parseBody(await call("getChainDetail", { id: root.chainId, limit: 1 }));

      expect(body.jobs).toHaveLength(1);
      expect(body.nextCursor).not.toBeNull();
      expect(body.currentJob.id).toBe(step2.id);
    });

    it("returns a null currentJob for a completed chain", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "completed-type", null);
      await startWorker(stateAdapter, "worker-1", ["completed-type"]);
      await startAttempt(stateAdapter, "completed-type");
      await completeJob(stateAdapter, root.id, { output: null });

      const body = await parseBody(await call("getChainDetail", { id: root.chainId }));

      expect(body.chain.status).toBe("completed");
      expect(body.currentJob).toBeNull();
    });

    it("returns 404 for missing chain", async () => {
      const { call } = await createTestDashboard();
      const res = await call("getChainDetail", { id: "nonexistent" });

      expect(res.status).toBe(404);
      expect(await parseBody(res)).toEqual({ error: "Chain not found" });
    });
  });

  describe("listChainJobs", () => {
    it("paginates the chain job sequence with a cursor", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      await createContinuation(stateAdapter, "chain-step2", root.id, { step: 2 });

      const first = await parseBody(
        await call("listChainJobs", { chainId: root.chainId, limit: 1 }),
      );
      expect(first.jobs).toHaveLength(1);
      expect(first.jobs[0].id).toBe(root.id);
      expect(first.nextCursor).not.toBeNull();

      const second = await parseBody(
        await call("listChainJobs", { chainId: root.chainId, limit: 1, cursor: first.nextCursor }),
      );
      expect(second.jobs).toHaveLength(1);
      expect(second.jobs[0].id).not.toBe(root.id);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe("listBlockedJobs", () => {
    it("returns jobs blocked by chain", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blockedJob = await createJob(stateAdapter, "blocked-type", null);
      await addBlocker(stateAdapter, blockedJob.id, blockerChain.chainId);

      const body = await parseBody(
        await call("listBlockedJobs", { chainId: blockerChain.chainId }),
      );

      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(blockedJob.id);
      expect(body.nextCursor).toBeNull();
    });

    it("paginates blocked jobs with a cursor", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blocked1 = await createJob(stateAdapter, "blocked-type", null);
      const blocked2 = await createJob(stateAdapter, "blocked-type", null);
      await addBlocker(stateAdapter, blocked1.id, blockerChain.chainId);
      await addBlocker(stateAdapter, blocked2.id, blockerChain.chainId);

      const first = await parseBody(
        await call("listBlockedJobs", { chainId: blockerChain.chainId, limit: 1 }),
      );
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();

      const second = await parseBody(
        await call("listBlockedJobs", {
          chainId: blockerChain.chainId,
          limit: 1,
          cursor: first.nextCursor,
        }),
      );
      expect(second.items).toHaveLength(1);
      expect(second.items[0].id).not.toBe(first.items[0].id);
    });
  });

  describe("deleteChain", () => {
    it("accepts the delete and resolves the streamed deleted promise once it commits", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "test-type", null);

      const res = await call("deleteChain", { id: root.chainId });
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.deleted).toBeInstanceOf(Promise);
      expect(await body.deleted).toEqual({ outcome: "deleted", count: 1 });
      expect((await call("getChainDetail", { id: root.chainId })).status).toBe(404);
    });

    it("returns 404 for missing chain", async () => {
      const { call } = await createTestDashboard();
      const res = await call("deleteChain", { id: "nonexistent" });
      expect(res.status).toBe(404);
    });

    it("resolves to a blocked outcome when the chain is a blocker", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blockedJob = await createJob(stateAdapter, "blocked-type", null);
      await addBlocker(stateAdapter, blockedJob.id, blockerChain.chainId);

      const body = await parseBody(await call("deleteChain", { id: blockerChain.chainId }));

      expect(await body.deleted).toEqual({ outcome: "blocked" });
      expect((await call("getChainDetail", { id: blockerChain.chainId })).status).toBe(200);
    });
  });

  describe("getChainTypeNames", () => {
    it("returns distinct chain type names sorted alphabetically", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "beta-type", null);
      await createJob(stateAdapter, "alpha-type", null);
      await createJob(stateAdapter, "beta-type", null);

      expect(await parseBody(await call("getChainTypeNames"))).toEqual(["alpha-type", "beta-type"]);
    });
  });

  describe("countChainsByTypeName", () => {
    it("returns an empty array for no type names", async () => {
      const { call } = await createTestDashboard();
      expect(await parseBody(await call("countChainsByTypeName", { typeNames: [] }))).toEqual([]);
    });

    it("returns per-status counts for each requested type name", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "type-a", null);
      const done = await createJob(stateAdapter, "type-b", null);
      await startWorker(stateAdapter, "worker-1", ["type-b"]);
      await startAttempt(stateAdapter, "type-b");
      await completeJob(stateAdapter, done.id, { output: null });

      const body = await parseBody(
        await call("countChainsByTypeName", { typeNames: ["type-a", "type-b"] }),
      );

      expect(body).toHaveLength(2);
      expect(body[0].typeName).toBe("type-a");
      expect(body[0].running.count).toBe(1);
      expect(body[1].typeName).toBe("type-b");
      expect(body[1].completed.count).toBe(1);
    });
  });

  describe("getChains", () => {
    it("returns the chains matching the given ids and skips missing ones", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const a = await createJob(stateAdapter, "type-a", null);
      await createJob(stateAdapter, "type-b", null);
      const c = await createJob(stateAdapter, "type-c", null);

      const body = await parseBody(
        await call("getChains", { ids: [a.chainId, c.chainId, "nonexistent"] }),
      );

      expect(body.map((chain: { id: string }) => chain.id).sort()).toEqual(
        [a.chainId, c.chainId].sort(),
      );
      expect(await parseBody(await call("getChains", { ids: [] }))).toEqual([]);
    });
  });
});
