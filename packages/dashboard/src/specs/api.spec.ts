import { createClient, defineJobTypeRegistry } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
// @ts-expect-error tsgo doesn't resolve export * re-exports from seroval
import { deserialize } from "seroval";
import { describe, expect, it } from "vitest";
import { createDashboard } from "../api/dashboard.js";

const parseBody = async (res: Response) => deserialize(await res.text());

const createTestDashboard = async (basePath?: string) => {
  const stateAdapter = createInProcessStateAdapter();
  const client = await createClient({ stateAdapter, jobTypeRegistry: defineJobTypeRegistry() });
  const dashboard = createDashboard({ client, basePath });
  const prefix = basePath ?? "";
  const request = async (path: string, init?: RequestInit) =>
    dashboard.fetch(new Request(`http://test${prefix}${path}`, init));
  return { request, stateAdapter };
};

const createJob = async (
  stateAdapter: ReturnType<typeof createInProcessStateAdapter>,
  typeName: string,
  input: unknown,
) => {
  const [{ job }] = await stateAdapter.runInTransaction(async (txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [{ typeName, chainId: undefined, chainIndex: 0, chainTypeName: typeName, input }],
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
  const [{ job }] = await stateAdapter.runInTransaction(async (txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [{ typeName, chainId, chainTypeName, chainIndex, input }],
    }),
  );
  return job;
};

describe("Dashboard API", () => {
  describe("GET /api/chains", () => {
    it("returns empty list when no chains exist", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/chains");
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.items).toEqual([]);
      expect(body.nextCursor).toBeNull();
    });

    it("returns chains as serialized job chain objects", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "test-type", { key: "value" });

      const res = await request("/api/chains");
      const body = await parseBody(res);

      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(root.id);
      expect(body.items[0].typeName).toBe("test-type");
    });

    it("returns chain with continuation", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      await createContinuation(stateAdapter, "chain-step2", root.chainId, "chain-type", 1, {
        step: 2,
      });

      const res = await request("/api/chains");
      const body = await parseBody(res);

      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(root.id);
      expect(body.items[0].status).toBe("pending");
    });

    it("preserves Date objects via seroval", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "test", null);

      const res = await request("/api/chains");
      const body = await parseBody(res);

      expect(body.items[0].createdAt).toBeInstanceOf(Date);
    });

    it("respects limit param", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      for (let i = 0; i < 5; i++) {
        await createJob(stateAdapter, `type-${i}`, null);
      }

      const res = await request("/api/chains?limit=2");
      const body = await parseBody(res);

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
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.chain.id).toBe(root.id);
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

      await stateAdapter.runInTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [blockerChain.chainId] }],
        }),
      );

      const res = await request(`/api/chains/${blockerChain.chainId}/blocking`);
      const body = await parseBody(res);

      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(blockedJob.id);
    });
  });

  describe("DELETE /api/chains/:chainId", () => {
    it("deletes a chain and returns deleted entries", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "test-type", null);

      const res = await request(`/api/chains/${root.chainId}`, { method: "DELETE" });
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.deleted).toHaveLength(1);
      expect(body.deleted[0].id).toBe(root.id);

      const detail = await request(`/api/chains/${root.chainId}`);
      expect(detail.status).toBe(404);
    });

    it("returns 404 for missing chain", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/chains/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("returns 409 when chain is a blocker", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blockedJob = await createJob(stateAdapter, "blocked-type", null);

      await stateAdapter.runInTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [blockerChain.chainId] }],
        }),
      );

      const res = await request(`/api/chains/${blockerChain.chainId}`, { method: "DELETE" });
      const body = await parseBody(res);

      expect(res.status).toBe(409);
      expect(body.error).toContain("blocker");
    });

    it("cascade deletes chain and its blockers", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const mainJob = await createJob(stateAdapter, "main-type", null);

      await stateAdapter.runInTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerChain.chainId] }],
        }),
      );

      const res = await request(`/api/chains/${mainJob.chainId}?cascade=true`, {
        method: "DELETE",
      });
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.deleted).toHaveLength(2);

      const mainDetail = await request(`/api/chains/${mainJob.chainId}`);
      expect(mainDetail.status).toBe(404);

      const blockerDetail = await request(`/api/chains/${blockerChain.chainId}`);
      expect(blockerDetail.status).toBe(404);
    });

    it("cascade delete without blockers deletes only the target chain", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "test-type", null);

      const res = await request(`/api/chains/${root.chainId}?cascade=true`, {
        method: "DELETE",
      });
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.deleted).toHaveLength(1);
    });

    it("cascade delete still fails when resolved set has external dependents", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const sharedBlocker = await createJob(stateAdapter, "shared-blocker", null);
      const chainA = await createJob(stateAdapter, "chain-a", null);
      const chainB = await createJob(stateAdapter, "chain-b", null);

      await stateAdapter.runInTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [
            { jobId: chainA.id, blockedByChainIds: [sharedBlocker.chainId] },
            { jobId: chainB.id, blockedByChainIds: [sharedBlocker.chainId] },
          ],
        }),
      );

      const res = await request(`/api/chains/${chainA.chainId}?cascade=true`, {
        method: "DELETE",
      });

      expect(res.status).toBe(409);
      expect((await parseBody(res)).error).toContain("blocker");
    });
  });

  describe("GET /api/jobs", () => {
    it("returns empty list when no jobs exist", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/jobs");
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.items).toEqual([]);
    });

    it("returns jobs across chains", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "type-a", null);
      await createJob(stateAdapter, "type-b", null);

      const res = await request("/api/jobs");
      const body = await parseBody(res);

      expect(body.items).toHaveLength(2);
    });

    it("filters by chainTypeName", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", null);
      await createContinuation(stateAdapter, "chain-step2", root.chainId, "chain-type", 1, null);
      await createJob(stateAdapter, "other-type", null);

      const res = await request("/api/jobs?chainTypeName=chain-type");
      const body = await parseBody(res);

      expect(body.items).toHaveLength(2);
      for (const job of body.items) {
        expect(job.chainTypeName).toBe("chain-type");
      }
    });

    it("filters by chainId", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", null);
      await createContinuation(stateAdapter, "chain-step2", root.chainId, "chain-type", 1, null);
      await createJob(stateAdapter, "other-type", null);

      const res = await request(`/api/jobs?chainId=${root.chainId}`);
      const body = await parseBody(res);

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
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.job.id).toBe(job.id);
      expect(body.blockers).toEqual([]);
    });

    it("returns continuation for job in chain", async () => {
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

      const res = await request(`/api/jobs/${root.id}`);
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.continuation).not.toBeNull();
      expect(body.continuation.id).toBe(cont.id);
      expect(body.continuation.chainIndex).toBe(1);
    });

    it("returns null continuation for last job in chain", async () => {
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

      const res = await request(`/api/jobs/${cont.id}`);
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.continuation).toBeNull();
    });

    it("returns 404 for missing job", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/jobs/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/jobs/:jobId/trigger", () => {
    it("triggers a pending future-scheduled job", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const [{ job }] = await stateAdapter.runInTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: [
            {
              typeName: "scheduled-type",
              chainId: undefined,
              chainIndex: 0,
              chainTypeName: "scheduled-type",
              input: null,
              schedule: { afterMs: 60_000 },
            },
          ],
        }),
      );

      const res = await request(`/api/jobs/${job.id}/trigger`, { method: "POST" });
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.job.id).toBe(job.id);
    });

    it("returns 404 for missing job", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/jobs/nonexistent/trigger", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("returns 409 for non-pending job", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const job = await createJob(stateAdapter, "test-type", null);

      await stateAdapter.runInTransaction(async (txCtx) =>
        stateAdapter.acquireJob({ txCtx, typeNames: ["test-type"] }),
      );

      const res = await request(`/api/jobs/${job.id}/trigger`, { method: "POST" });
      const body = await parseBody(res);

      expect(res.status).toBe(409);
      expect(body.error).toContain("running");
    });
  });

  describe("sub-path mounting", () => {
    it("routes API calls correctly with basePath", async () => {
      const { request, stateAdapter } = await createTestDashboard("/internal/queuert");
      const job = await createJob(stateAdapter, "test-type", { key: "value" });

      const chainsRes = await request("/api/chains");
      expect(chainsRes.status).toBe(200);

      const chainDetailRes = await request(`/api/chains/${job.chainId}`);
      expect(chainDetailRes.status).toBe(200);

      const blockingRes = await request(`/api/chains/${job.chainId}/blocking`);
      expect(blockingRes.status).toBe(200);

      const jobsRes = await request("/api/jobs");
      expect(jobsRes.status).toBe(200);

      const jobDetailRes = await request(`/api/jobs/${job.id}`);
      expect(jobDetailRes.status).toBe(200);
    });

    it("returns 404 for requests outside basePath", async () => {
      const dashboard = createDashboard({
        client: await createClient({
          stateAdapter: createInProcessStateAdapter(),
          jobTypeRegistry: defineJobTypeRegistry(),
        }),
        basePath: "/internal/queuert",
      });
      const res = await dashboard.fetch(new Request("http://test/api/chains"));
      expect(res.status).toBe(404);
    });

    it("returns 404 for paths that share a prefix with basePath", async () => {
      const dashboard = createDashboard({
        client: await createClient({
          stateAdapter: createInProcessStateAdapter(),
          jobTypeRegistry: defineJobTypeRegistry(),
        }),
        basePath: "/app",
      });
      const res = await dashboard.fetch(new Request("http://test/application/api/chains"));
      expect(res.status).toBe(404);
    });
  });
});
