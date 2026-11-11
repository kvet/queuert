import { createClient, defineJobTypes } from "queuert";
import {
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
} from "queuert/conformance-internal";
import { describe, expect, it } from "vitest";

import { createDashboard } from "../api/dashboard.ts";
import {
  parseBody,
  rpcRequest,
  createTestDashboard,
  createJob,
  createContinuation,
  startAttempt,
  startWorker,
  completeJob,
  createUuidStrictDashboard,
  addBlocker,
} from "./dashboard.spec-helper.ts";

describe("job server functions", () => {
  describe("listJobs", () => {
    it("returns jobs across chains", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "test-type", null);
      await createJob(stateAdapter, "test-type", null);

      const body = await parseBody(await call("listJobs", { typeName: "test-type" }));

      expect(body.items).toHaveLength(2);
    });

    it("filters by each job status", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const pending = await createJob(stateAdapter, "pending-type", null);
      const blockerChain = await createJob(stateAdapter, "blocker-type", null);
      const blocked = await createJob(stateAdapter, "blocked-type", null);
      await addBlocker(stateAdapter, blocked.id, blockerChain.chainId);

      const running = await createJob(stateAdapter, "running-type", null);
      await startWorker(stateAdapter, "worker-1", [
        "running-type",
        "terminal-type",
        "continued-type",
      ]);
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

      const allTypeNames = [
        "pending-type",
        "blocker-type",
        "blocked-type",
        "running-type",
        "terminal-type",
        "continued-type",
        "continued-next",
      ];
      const ids = async (status?: string) => {
        const items: { id: string }[] = [];
        for (const typeName of allTypeNames) {
          const page = await parseBody(await call("listJobs", { typeName, status }));
          items.push(...page.items);
        }
        return items.map((job) => job.id).sort();
      };

      expect(await ids("blocked")).toEqual([blocked.id]);
      expect(await ids("pending")).toEqual([pending.id, blockerChain.id, continuation.id].sort());
      expect(await ids("running")).toEqual([running.id]);
      expect(await ids("completed")).toEqual([terminal.id, continued.id].sort());
      expect(await ids()).toHaveLength(7);
    });

    it("accepts each status's sort keys and rejects the others with 400", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await createJob(stateAdapter, "test-type", null);

      for (const [status, orderBy] of [
        ["pending", "scheduledAt"],
        ["blocked", "createdAt"],
        ["running", "attemptAt"],
        ["completed", "completedAt"],
        [undefined, "createdAt"],
      ] as const) {
        expect((await call("listJobs", { typeName: "test-type", status, orderBy })).status).toBe(
          200,
        );
      }
      for (const [status, orderBy] of [
        ["pending", "completedAt"],
        ["running", "scheduledAt"],
        ["completed", "attemptAt"],
        [undefined, "bogus"],
      ] as const) {
        expect((await call("listJobs", { typeName: "test-type", status, orderBy })).status).toBe(
          400,
        );
      }
      expect((await call("listJobs", { typeName: "test-type", status: "bogus" })).status).toBe(400);
    });
  });

  describe("getJobTypeNames", () => {
    it("returns distinct job type names sorted alphabetically", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "root-type", null);
      await createContinuation(stateAdapter, "cont-type", root.id, null);

      expect(await parseBody(await call("getJobTypeNames"))).toEqual(["cont-type", "root-type"]);
    });
  });

  describe("countJobsByTypeName", () => {
    it("returns per-status counts and live workers for each requested type name", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await startWorker(stateAdapter, "worker-1", ["type-b"]);
      await createJob(stateAdapter, "type-a", null);
      const blockerChain = await createJob(stateAdapter, "type-b", null);
      await startAttempt(stateAdapter, "type-b");
      const blocked = await createJob(stateAdapter, "type-a", null);
      await addBlocker(stateAdapter, blocked.id, blockerChain.chainId);

      const body = await parseBody(
        await call("countJobsByTypeName", { typeNames: ["type-a", "type-b"] }),
      );

      expect(body).toHaveLength(2);
      expect(body[0].typeName).toBe("type-a");
      expect(body[0].blocked.count).toBe(1);
      expect(body[0].pending.count).toBe(1);
      expect(body[0].running.count).toBe(0);
      expect(body[0].workers).toEqual({ live: 0, expired: 0 });
      expect(body[1].typeName).toBe("type-b");
      expect(body[1].blocked.count).toBe(0);
      expect(body[1].running.count).toBe(1);
      expect(body[1].workers).toEqual({ live: 1, expired: 0 });
      expect(await parseBody(await call("countJobsByTypeName", { typeNames: [] }))).toEqual([]);
    });
  });

  describe("getJobs", () => {
    it("returns the jobs matching the given ids and skips missing ones", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const a = await createJob(stateAdapter, "type-a", null);
      await createJob(stateAdapter, "type-b", null);
      const c = await createJob(stateAdapter, "type-c", null);

      const body = await parseBody(await call("getJobs", { ids: [a.id, c.id, "nonexistent"] }));

      expect(body.map((job: { id: string }) => job.id).sort()).toEqual([a.id, c.id].sort());
    });
  });

  describe("getJobDetail", () => {
    it("returns job with blockers", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const job = await createJob(stateAdapter, "test-type", { key: "value" });

      const body = await parseBody(await call("getJobDetail", { id: job.id }));

      expect(body.job.id).toBe(job.id);
      expect(body.blockers).toEqual([]);
    });

    it("returns continuation for job in chain", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      const cont = await createContinuation(stateAdapter, "chain-step2", root.id, { step: 2 });

      const body = await parseBody(await call("getJobDetail", { id: root.id }));

      expect(body.continuation.id).toBe(cont.id);
      expect(body.continuation.chainId).toBe(root.chainId);
      expect(body.continuation.chainIndex).toBe(1);
    });

    it("returns null continuation for last job in chain", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const root = await createJob(stateAdapter, "chain-type", { step: 1 });
      const cont = await createContinuation(stateAdapter, "chain-step2", root.id, { step: 2 });

      const body = await parseBody(await call("getJobDetail", { id: cont.id }));

      expect(body.continuation).toBeNull();
    });

    it("returns 404 for missing job", async () => {
      const { call } = await createTestDashboard();
      expect((await call("getJobDetail", { id: "nonexistent" })).status).toBe(404);
    });
  });

  describe("rescheduleJob", () => {
    it("reschedules a pending future-scheduled job to now", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
        stateAdapter.createJobs({
          txCtx,
          jobs: [
            {
              id: stateAdapter.config.generateJobId(),
              typeName: "scheduled-type",
              input: null,
              schedule: { afterMs: 60_000 },
            },
          ],
        }),
      );

      const res = await call("rescheduleJob", { id: stateChain.head.id });

      expect(res.status).toBe(200);
      expect((await parseBody(res)).id).toBe(stateChain.head.id);
    });

    it("notifies workers only after the reschedule transaction ends", async () => {
      const events: string[] = [];
      const innerStateAdapter = createInProcessStateAdapter();
      const stateAdapter: typeof innerStateAdapter = {
        ...innerStateAdapter,
        withTransaction: async (fn) =>
          innerStateAdapter.withTransaction(async (txCtx) => {
            innerStateAdapter.onTransactionCommit(txCtx, () => {
              events.push("committed");
            });
            const result = await fn(txCtx);
            events.push("callback returned");
            return result;
          }),
      };
      const innerNotifyAdapter = createInProcessNotifyAdapter();
      const client = createClient({
        stateAdapter,
        notifyAdapter: {
          ...innerNotifyAdapter,
          notifyJobsScheduled: async (typeNames) => {
            events.push("notify");
            return innerNotifyAdapter.notifyJobsScheduled(typeNames);
          },
        },
        jobTypes: defineJobTypes(),
      });
      const dashboard = createDashboard({ client });
      const job = await createJob(stateAdapter, "test-type", null);
      events.length = 0;

      const res = await dashboard.fetch(
        rpcRequest("http://test/api/rpc", "rescheduleJob", { id: job.id }),
      );

      expect(res.status).toBe(200);
      expect(events).toEqual(["callback returned", "committed", "notify"]);
    });

    it("returns 404 for missing job", async () => {
      const { call } = await createTestDashboard();
      expect((await call("rescheduleJob", { id: "nonexistent" })).status).toBe(404);
    });

    it("returns 409 for non-pending job", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const job = await createJob(stateAdapter, "test-type", null);
      const worker = await startWorker(stateAdapter, "test-worker", ["test-type"]);
      await stateAdapter.startJobAttempts({
        workerId: "test-worker",
        workerToken: worker.token,
        typeNames: ["test-type"],
        limit: 1,
      });

      const res = await call("rescheduleJob", { id: job.id });

      expect(res.status).toBe(409);
      expect((await parseBody(res)).error).toContain('not "pending"');
    });

    it("returns 500 when rescheduling an existing job fails for a non-ID reason", async () => {
      const { call, stateAdapter, failures } = await createUuidStrictDashboard();
      const job = await createJob(stateAdapter, "type-a", null);
      failures.reschedule = true;

      const res = await call("rescheduleJob", { id: job.id });

      expect(res.status).toBe(500);
      expect((await parseBody(res)).error).toBe("deadlock detected");
    });
  });
});
