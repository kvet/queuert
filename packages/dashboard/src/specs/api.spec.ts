import { createClient, createInProcessStateAdapter, defineJobTypes } from "queuert";
// @ts-expect-error tsgo doesn't resolve export * re-exports from seroval
import { deserialize } from "seroval";
import { describe, expect, it } from "vitest";

import { createDashboard } from "../api/dashboard.js";

const parseBody = async (res: Response) => deserialize(await res.text());

const createTestDashboard = async (basePath?: string) => {
  const stateAdapter = await createInProcessStateAdapter();
  const client = await createClient({ stateAdapter, jobTypes: defineJobTypes() });
  const dashboard = await createDashboard({ client, basePath });
  const prefix = basePath ?? "";
  const request = async (path: string, init?: RequestInit) =>
    dashboard.fetch(new Request(`http://test${prefix}${path}`, init));
  return { request, stateAdapter };
};

const createJob = async (
  stateAdapter: Awaited<ReturnType<typeof createInProcessStateAdapter>>,
  typeName: string,
  input: unknown,
) => {
  const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createChains({
      txCtx,
      jobs: [{ typeName, chainTypeName: typeName, input }],
    }),
  );
  return job;
};

const createContinuation = async (
  stateAdapter: Awaited<ReturnType<typeof createInProcessStateAdapter>>,
  typeName: string,
  continueFromId: string,
  input: unknown,
) => {
  const { job } = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createContinuationJob({
      txCtx,
      job: { typeName, continueFromId, input },
    }),
  );
  return job;
};

const startAttempt = async (
  stateAdapter: Awaited<ReturnType<typeof createInProcessStateAdapter>>,
  typeName: string,
) =>
  stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: [typeName] }),
  );

const completeJob = async (
  stateAdapter: Awaited<ReturnType<typeof createInProcessStateAdapter>>,
  jobId: string,
  outcome: { output: unknown } | { continuedToId: string },
) =>
  stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.finishJobAttempt({ txCtx, jobId, workerId: "worker-1", outcome }),
  );

const encodeRawCursor = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload)).toString("base64url");

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

    it("returns chains as serialized chain objects", async () => {
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
      await createContinuation(stateAdapter, "chain-step2", root.id, {
        step: 2,
      });

      const res = await request("/api/chains");
      const body = await parseBody(res);

      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(root.id);
      expect(body.items[0].status).toBe("running");
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

    it("excludes blocker chains unless independent=false", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const mainChain = await createJob(stateAdapter, "main-type", null);

      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: mainChain.id, blockedByChainIds: [blockerChain.chainId] }],
        }),
      );

      const independent = await parseBody(await request("/api/chains"));
      expect(independent.items.map((c: { id: string }) => c.id)).toEqual([mainChain.chainId]);

      const blockers = await parseBody(await request("/api/chains?independent=false"));
      expect(blockers.items.map((c: { id: string }) => c.id)).toEqual([blockerChain.chainId]);
    });

    it("filters by chain status", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const running = await createJob(stateAdapter, "running-type", null);
      const done = await createJob(stateAdapter, "done-type", null);

      await startAttempt(stateAdapter, "done-type");
      await completeJob(stateAdapter, done.id, { output: null });

      const completed = await parseBody(await request("/api/chains?status=completed"));
      expect(completed.items.map((c: { id: string }) => c.id)).toEqual([done.chainId]);

      const inProgress = await parseBody(await request("/api/chains?status=running"));
      expect(inProgress.items.map((c: { id: string }) => c.id)).toEqual([running.chainId]);
    });

    it("falls back to the default orderBy for unknown or status-incompatible values", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "test-type", null);

      for (const orderBy of ["bogus", "completedAt", "id; DROP TABLE job"]) {
        const res = await request(`/api/chains?orderBy=${encodeURIComponent(orderBy)}`);
        expect(res.status).toBe(200);
        expect((await parseBody(res)).items).toHaveLength(1);
      }
    });
  });

  describe("GET /api/chains/:chainId", () => {
    it("returns chain detail with jobs", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      await createContinuation(stateAdapter, "chain-step2", root.id, {
        step: 2,
      });

      const res = await request(`/api/chains/${root.chainId}`);
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.chain.id).toBe(root.id);
      expect(body.jobs).toHaveLength(2);
      expect(body.nextCursor).toBeNull();
    });

    it("returns 404 for missing chain", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/chains/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/chains/:chainId/jobs", () => {
    it("paginates the chain job sequence with a cursor", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      await createContinuation(stateAdapter, "chain-step2", root.id, {
        step: 2,
      });

      const first = await parseBody(await request(`/api/chains/${root.chainId}/jobs?limit=1`));
      expect(first.jobs).toHaveLength(1);
      expect(first.jobs[0].id).toBe(root.id);
      expect(first.nextCursor).not.toBeNull();

      const second = await parseBody(
        await request(
          `/api/chains/${root.chainId}/jobs?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
        ),
      );
      expect(second.jobs).toHaveLength(1);
      expect(second.jobs[0].id).not.toBe(root.id);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe("GET /api/chains/:chainId/blocking", () => {
    it("returns jobs blocked by chain", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blockedJob = await createJob(stateAdapter, "blocked-type", null);

      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [blockerChain.chainId] }],
        }),
      );

      const res = await request(`/api/chains/${blockerChain.chainId}/blocking`);
      const body = await parseBody(res);

      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(blockedJob.id);
      expect(body.nextCursor).toBeNull();
    });

    it("paginates blocked jobs with a cursor", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blocked1 = await createJob(stateAdapter, "blocked-type", null);
      const blocked2 = await createJob(stateAdapter, "blocked-type", null);

      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [
            { jobId: blocked1.id, blockedByChainIds: [blockerChain.chainId] },
            { jobId: blocked2.id, blockedByChainIds: [blockerChain.chainId] },
          ],
        }),
      );

      const first = await parseBody(
        await request(`/api/chains/${blockerChain.chainId}/blocking?limit=1`),
      );
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();

      const second = await parseBody(
        await request(
          `/api/chains/${blockerChain.chainId}/blocking?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
        ),
      );
      expect(second.items).toHaveLength(1);
      expect(second.items[0].id).not.toBe(first.items[0].id);
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

      await stateAdapter.withTransaction(async (txCtx) =>
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

      await stateAdapter.withTransaction(async (txCtx) =>
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

      await stateAdapter.withTransaction(async (txCtx) =>
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
      await createContinuation(stateAdapter, "chain-step2", root.id, null);
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
      await createContinuation(stateAdapter, "chain-step2", root.id, null);
      await createJob(stateAdapter, "other-type", null);

      const res = await request(`/api/jobs?chainId=${root.chainId}`);
      const body = await parseBody(res);

      expect(body.items).toHaveLength(2);
      for (const job of body.items) {
        expect(job.chainId).toBe(root.chainId);
      }
    });

    it("filters by each job status alias", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const pending = await createJob(stateAdapter, "pending-type", null);
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blocked = await createJob(stateAdapter, "blocked-type", null);
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: blocked.id, blockedByChainIds: [blockerChain.chainId] }],
        }),
      );

      const running = await createJob(stateAdapter, "running-type", null);
      await startAttempt(stateAdapter, "running-type");

      const terminal = await createJob(stateAdapter, "terminal-type", null);
      await startAttempt(stateAdapter, "terminal-type");
      await completeJob(stateAdapter, terminal.id, { output: null });

      const continued = await createJob(stateAdapter, "continued-type", null);
      await startAttempt(stateAdapter, "continued-type");
      const continuation = await createContinuation(
        stateAdapter,
        "continued-next",
        continued.id,
        null,
      );
      await completeJob(stateAdapter, continued.id, { continuedToId: continuation.id });

      const ids = async (status: string) =>
        (await parseBody(await request(`/api/jobs?status=${status}`))).items
          .map((job: { id: string }) => job.id)
          .sort();

      expect(await ids("blocked")).toEqual([blocked.id]);
      expect(await ids("pending-unblocked")).toEqual(
        [pending.id, blockerChain.id, continuation.id].sort(),
      );
      expect(await ids("running")).toEqual([running.id]);
      expect(await ids("completed-terminal")).toEqual([terminal.id]);
      expect(await ids("completed-continued")).toEqual([continued.id]);
      expect(await ids("completed")).toEqual([terminal.id, continued.id].sort());
      expect(await ids("bogus-status")).toHaveLength(7);
    });

    it("falls back to the default orderBy per status branch", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "test-type", null);

      for (const query of [
        "status=pending&orderBy=completedAt",
        "status=running&orderBy=scheduledAt",
        "status=completed&orderBy=attemptUntil",
        "orderBy=bogus",
      ]) {
        const res = await request(`/api/jobs?${query}`);
        expect(res.status).toBe(200);
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
      const cont = await createContinuation(stateAdapter, "chain-step2", root.id, { step: 2 });
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.finishJobAttempt({
          txCtx,
          jobId: root.id,
          workerId: "test",
          outcome: { continuedToId: cont.id },
        }),
      );

      const res = await request(`/api/jobs/${root.id}`);
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.continuation).not.toBeNull();
      expect(body.continuation.id).toBe(cont.id);
      expect(body.continuation.chainId).toBe(root.chainId);
    });

    it("returns null continuation for last job in chain", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      const cont = await createContinuation(stateAdapter, "chain-step2", root.id, { step: 2 });
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.finishJobAttempt({
          txCtx,
          jobId: root.id,
          workerId: "test",
          outcome: { continuedToId: cont.id },
        }),
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

  describe("POST /api/jobs/:jobId/reschedule", () => {
    it("reschedules a pending future-scheduled job to now", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createChains({
          txCtx,
          jobs: [
            {
              typeName: "scheduled-type",
              chainTypeName: "scheduled-type",
              input: null,
              schedule: { afterMs: 60_000 },
            },
          ],
        }),
      );

      const res = await request(`/api/jobs/${job.id}/reschedule`, { method: "POST" });
      const body = await parseBody(res);

      expect(res.status).toBe(200);
      expect(body.job.id).toBe(job.id);
    });

    it("returns 404 for missing job", async () => {
      const { request } = await createTestDashboard();
      const res = await request("/api/jobs/nonexistent/reschedule", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("returns 409 for non-pending job", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const job = await createJob(stateAdapter, "test-type", null);

      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.startJobAttempt({ txCtx, workerId: "test-worker", typeNames: ["test-type"] }),
      );

      const res = await request(`/api/jobs/${job.id}/reschedule`, { method: "POST" });
      const body = await parseBody(res);

      expect(res.status).toBe(409);
      expect(body.error).toContain('not "pending"');
    });
  });

  describe("cursor validation", () => {
    const malformed: [string, unknown][] = [
      [
        "sort key that disagrees with the resolved orderBy",
        {
          type: "timestampWithId",
          sortKey: "completedAt",
          value: new Date().toISOString(),
          id: "some-id",
        },
      ],
      ["timestampWithId cursor missing sortKey and value", { type: "timestampWithId", id: "x" }],
      ["id cursor where a timestampWithId cursor is expected", { type: "id", id: "x" }],
      ["unknown cursor type", { type: "chainIndex", id: "x" }],
      ["non-object payload", "just-a-string"],
    ];

    it.for(malformed)("drops a cursor with %s", async ([, payload]) => {
      const { request, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "test-type", null);

      const res = await request(`/api/chains?cursor=${encodeRawCursor(payload)}`);

      expect(res.status).toBe(200);
      expect((await parseBody(res)).items).toHaveLength(1);
    });

    it("drops a cursor that is not valid base64url JSON", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "test-type", null);

      const res = await request("/api/chains?cursor=not-a-cursor");

      expect(res.status).toBe(200);
      expect((await parseBody(res)).items).toHaveLength(1);
    });

    it("drops a cursor issued for a different orderBy instead of failing", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const first = await createJob(stateAdapter, "type-a", null);
      const second = await createJob(stateAdapter, "type-b", null);
      for (const job of [first, second]) {
        await startAttempt(stateAdapter, job.typeName);
        await completeJob(stateAdapter, job.id, { output: null });
      }

      const page = await parseBody(
        await request("/api/chains?status=completed&orderBy=completedAt&limit=1"),
      );
      expect(page.nextCursor).not.toBeNull();

      const res = await request(
        `/api/chains?status=completed&orderBy=createdAt&cursor=${encodeURIComponent(page.nextCursor)}`,
      );

      expect(res.status).toBe(200);
      expect((await parseBody(res)).items).toHaveLength(2);
    });

    it("drops a timestampWithId cursor on the chain jobs route", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", null);
      const cursor = encodeRawCursor({
        type: "timestampWithId",
        sortKey: "createdAt",
        value: new Date().toISOString(),
        id: root.id,
      });

      const res = await request(`/api/chains/${root.chainId}/jobs?cursor=${cursor}`);

      expect(res.status).toBe(200);
      expect((await parseBody(res)).jobs).toHaveLength(1);
    });

    it("drops an id cursor on the blocking route", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blockedJob = await createJob(stateAdapter, "blocked-type", null);
      await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.addJobsBlockers({
          txCtx,
          jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [blockerChain.chainId] }],
        }),
      );

      const res = await request(
        `/api/chains/${blockerChain.chainId}/blocking?cursor=${encodeRawCursor({ type: "id", id: blockedJob.id })}`,
      );

      expect(res.status).toBe(200);
      expect((await parseBody(res)).items).toHaveLength(1);
    });

    it("drops a malformed cursor on the jobs route", async () => {
      const { request, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "test-type", null);

      const res = await request(
        `/api/jobs?status=running&cursor=${encodeRawCursor({ type: "timestampWithId", sortKey: "createdAt", value: new Date().toISOString(), id: "x" })}`,
      );

      expect(res.status).toBe(200);
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
      const dashboard = await createDashboard({
        client: await createClient({
          stateAdapter: await createInProcessStateAdapter(),
          jobTypes: defineJobTypes(),
        }),
        basePath: "/internal/queuert",
      });
      const res = await dashboard.fetch(new Request("http://test/api/chains"));
      expect(res.status).toBe(404);
    });

    it("returns 404 for paths that share a prefix with basePath", async () => {
      const dashboard = await createDashboard({
        client: await createClient({
          stateAdapter: await createInProcessStateAdapter(),
          jobTypes: defineJobTypes(),
        }),
        basePath: "/app",
      });
      const res = await dashboard.fetch(new Request("http://test/application/api/chains"));
      expect(res.status).toBe(404);
    });
  });
});
