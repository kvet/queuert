import { createClient, defineJobTypes } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
import { describe, expect, it } from "vitest";
import { createDashboard } from "../api/dashboard.js";

const createTestDashboard = async () => {
  const stateAdapter = createInProcessStateAdapter();
  const client = await createClient({ stateAdapter, registry: defineJobTypes() });
  const dashboard = createDashboard({ client });
  const request = async (path: string) => dashboard.fetch(new Request(`http://test${path}`));
  return { request, stateAdapter };
};

const createJob = async (
  stateAdapter: ReturnType<typeof createInProcessStateAdapter>,
  typeName: string,
  input: unknown,
) => {
  const { job } = await stateAdapter.runInTransaction(async (txContext) =>
    stateAdapter.createJob({
      txContext,
      typeName,
      chainId: undefined,
      chainIndex: 0,
      chainTypeName: typeName,
      input,
    }),
  );
  return job;
};

const createContinuation = async (
  stateAdapter: ReturnType<typeof createInProcessStateAdapter>,
  typeName: string,
  chainId: string,
  chainTypeName: string,
  chainIndex: number,
  input: unknown,
) => {
  const { job } = await stateAdapter.runInTransaction(async (txContext) =>
    stateAdapter.createJob({
      txContext,
      typeName,
      chainId,
      chainTypeName,
      chainIndex,
      input,
    }),
  );
  return job;
};

describe("Dashboard API", () => {
  describe("GET /api/chains", () => {
    it("returns empty list when no chains exist", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/chains");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toEqual([]);
      expect(body.nextCursor).toBeNull();
    });

    it("returns chains as [rootJob, lastJob] pairs", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "test-type", { key: "value" });

      const res = await request("/api/chains");
      const body = await res.json();

      expect(body.items).toHaveLength(1);
      expect(body.items[0][0].id).toBe(root.id);
      expect(body.items[0][0].typeName).toBe("test-type");
      expect(body.items[0][1]).toBeNull();
    });

    it("returns chain with continuation", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      const cont = await createContinuation(
        stateAdapter,
        "chain-step2",
        root.chainId,
        "chain-type",
        1,
        { step: 2 },
      );

      const res = await request("/api/chains");
      const body = await res.json();

      expect(body.items).toHaveLength(1);
      expect(body.items[0][0].id).toBe(root.id);
      expect(body.items[0][1]).not.toBeNull();
      expect(body.items[0][1].id).toBe(cont.id);
    });

    it("serializes dates as ISO strings", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "test", null);

      const res = await request("/api/chains");
      const body = await res.json();

      expect(typeof body.items[0][0].createdAt).toBe("string");
      expect(body.items[0][0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("respects limit param", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      for (let i = 0; i < 5; i++) {
        await createJob(stateAdapter, `type-${i}`, null);
      }

      const res = await request("/api/chains?limit=2");
      const body = await res.json();

      expect(body.items).toHaveLength(2);
      expect(body.nextCursor).not.toBeNull();
    });
  });

  describe("GET /api/chains/:chainId", () => {
    it("returns chain detail with jobs", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      await createContinuation(stateAdapter, "chain-step2", root.chainId, "chain-type", 1, {
        step: 2,
      });

      const res = await request(`/api/chains/${root.chainId}`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.rootJob.id).toBe(root.id);
      expect(body.jobs).toHaveLength(2);
    });

    it("returns 404 for missing chain", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/chains/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/chains/:chainId/blocking", () => {
    it("returns jobs blocked by chain", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blockedJob = await createJob(stateAdapter, "blocked-type", null);

      await stateAdapter.runInTransaction(async (txContext) =>
        stateAdapter.addJobBlockers({
          txContext,
          jobId: blockedJob.id,
          blockedByChainIds: [blockerChain.chainId],
        }),
      );

      const res = await request(`/api/chains/${blockerChain.chainId}/blocking`);
      const body = await res.json();

      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(blockedJob.id);
    });
  });

  describe("GET /api/jobs", () => {
    it("returns empty list when no jobs exist", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/jobs");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toEqual([]);
    });

    it("returns jobs across chains", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "type-a", null);
      await createJob(stateAdapter, "type-b", null);

      const res = await request("/api/jobs");
      const body = await res.json();

      expect(body.items).toHaveLength(2);
    });

    it("filters by chainId", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", null);
      await createContinuation(stateAdapter, "chain-step2", root.chainId, "chain-type", 1, null);
      await createJob(stateAdapter, "other-type", null);

      const res = await request(`/api/jobs?chainId=${root.chainId}`);
      const body = await res.json();

      expect(body.items).toHaveLength(2);
      for (const job of body.items) {
        expect(job.chainId).toBe(root.chainId);
      }
    });
  });

  describe("GET /api/jobs/:jobId", () => {
    it("returns job with blockers", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const job = await createJob(stateAdapter, "test-type", { key: "value" });

      const res = await request(`/api/jobs/${job.id}`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.job.id).toBe(job.id);
      expect(body.blockers).toEqual([]);
    });

    it("returns 404 for missing job", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/jobs/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
