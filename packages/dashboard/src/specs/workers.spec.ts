import { describe, expect, it } from "vitest";

import {
  parseBody,
  createTestDashboard,
  createJob,
  startAttempt,
  startWorker,
} from "./dashboard.spec-helper.ts";

describe("worker server functions", () => {
  describe("listWorkers", () => {
    it("returns an empty page when no worker has a row", async () => {
      const { call } = await createTestDashboard();
      expect(await parseBody(await call("listWorkers", {}))).toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it("returns every worker, or only those processing typeName, with its running job count", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await startWorker(stateAdapter, "worker-a", ["type-a"]);
      await startWorker(stateAdapter, "worker-1", ["type-b"]);
      await createJob(stateAdapter, "type-b", null);
      await startAttempt(stateAdapter, "type-b");

      const all = await parseBody(await call("listWorkers", {}));
      const typeB = await parseBody(await call("listWorkers", { typeName: "type-b" }));

      expect(all.items.map((worker: { id: string }) => worker.id).sort()).toEqual([
        "worker-1",
        "worker-a",
      ]);
      expect(typeB.items.map((worker: { id: string }) => worker.id)).toEqual(["worker-1"]);
      expect(typeB.items[0].typeNames).toEqual(["type-b"]);
      expect(typeB.items[0].concurrency).toBe(2);
      expect(typeB.items[0].runningJobCount).toBe(1);
      expect(typeB.items[0].startedAt).toBeInstanceOf(Date);
    });

    it("rejects an empty typeName with 400", async () => {
      const { call } = await createTestDashboard();
      expect((await call("listWorkers", { typeName: "" })).status).toBe(400);
    });

    it("pages with cursor and limit", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await startWorker(stateAdapter, "worker-a", ["type-a"]);
      await startWorker(stateAdapter, "worker-b", ["type-a"]);

      const firstPage = await parseBody(await call("listWorkers", { limit: 1 }));
      const secondPage = await parseBody(
        await call("listWorkers", { limit: 1, cursor: firstPage.nextCursor }),
      );

      expect(firstPage.items).toHaveLength(1);
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(new Set([firstPage.items[0].id, secondPage.items[0].id])).toEqual(
        new Set(["worker-a", "worker-b"]),
      );
    });

    it("returns whether each worker lost its lease from listWorkers, getWorker and getWorkers", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await startWorker(stateAdapter, "worker-live", ["type-a"]);
      await stateAdapter.startWorker({
        workerId: "worker-expired",
        typeNames: ["type-a"],
        concurrency: 1,
        leaseMs: 0,
      });

      const list = await parseBody(await call("listWorkers", {}));
      const byIds = await parseBody(
        await call("getWorkers", { ids: ["worker-live", "worker-expired"] }),
      );

      expect(
        list.items
          .map((worker: { id: string; expired: boolean }) => [worker.id, worker.expired])
          .sort(),
      ).toEqual([
        ["worker-expired", true],
        ["worker-live", false],
      ]);
      expect(
        byIds.map((worker: { id: string; expired: boolean }) => [worker.id, worker.expired]),
      ).toEqual([
        ["worker-live", false],
        ["worker-expired", true],
      ]);
      expect((await parseBody(await call("getWorker", { id: "worker-live" }))).expired).toBe(false);
      expect((await parseBody(await call("getWorker", { id: "worker-expired" }))).expired).toBe(
        true,
      );
    });
  });

  describe("countWorkers", () => {
    it("returns the live and expired worker counts", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await startWorker(stateAdapter, "worker-a", ["type-a"]);
      await stateAdapter.startWorker({
        workerId: "worker-b",
        typeNames: ["type-a"],
        concurrency: 1,
        leaseMs: 0,
      });

      expect(await parseBody(await call("countWorkers"))).toEqual({ live: 1, expired: 1 });
    });
  });

  describe("getWorker", () => {
    it("returns the worker with its running job count", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await startWorker(stateAdapter, "worker-1", ["type-a"]);
      await createJob(stateAdapter, "type-a", null);
      await startAttempt(stateAdapter, "type-a");

      const body = await parseBody(await call("getWorker", { id: "worker-1" }));

      expect(body.id).toBe("worker-1");
      expect(body.runningJobCount).toBe(1);
      expect(body.leaseUntil).toBeInstanceOf(Date);
    });

    it("returns 404 for a worker with no row", async () => {
      const { call } = await createTestDashboard();
      const res = await call("getWorker", { id: "missing-worker" });

      expect(res.status).toBe(404);
      expect(await parseBody(res)).toEqual({ error: "Worker not found" });
    });

    it("rejects a call without an id with 400", async () => {
      const { call } = await createTestDashboard();
      expect((await call("getWorker", {})).status).toBe(400);
    });

    it("returns a worker whose id contains / % and ,", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await startWorker(stateAdapter, "pod/7%a,b", ["type-a"]);

      expect((await parseBody(await call("getWorker", { id: "pod/7%a,b" }))).id).toBe("pod/7%a,b");
    });
  });

  describe("listWorkerJobs", () => {
    it("returns the jobs running under the worker", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const job = await createJob(stateAdapter, "type-a", null);
      await startWorker(stateAdapter, "worker-1", ["type-a"]);
      await startAttempt(stateAdapter, "type-a");

      const body = await parseBody(await call("listWorkerJobs", { workerId: "worker-1" }));

      expect(
        body.items.map((running: { id: string; status: string }) => [running.id, running.status]),
      ).toEqual([[job.id, "running"]]);
      expect(body.nextCursor).toBeNull();
    });

    it("paginates the running jobs with an attemptAt cursor", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const first = await createJob(stateAdapter, "type-a", null);
      const second = await createJob(stateAdapter, "type-a", null);
      await startWorker(stateAdapter, "worker-1", ["type-a"]);
      await startAttempt(stateAdapter, "type-a");
      await startAttempt(stateAdapter, "type-a");

      const firstPage = await parseBody(
        await call("listWorkerJobs", { workerId: "worker-1", limit: 1 }),
      );
      const secondPage = await parseBody(
        await call("listWorkerJobs", {
          workerId: "worker-1",
          limit: 1,
          cursor: firstPage.nextCursor,
        }),
      );

      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextCursor).not.toBeNull();
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(new Set([firstPage.items[0].id, secondPage.items[0].id])).toEqual(
        new Set([first.id, second.id]),
      );
    });

    it("returns an empty page for an unknown worker", async () => {
      const { call } = await createTestDashboard();
      expect(await parseBody(await call("listWorkerJobs", { workerId: "missing-worker" }))).toEqual(
        { items: [], nextCursor: null },
      );
    });
  });

  describe("getWorkers", () => {
    it("returns the workers matching the given ids with their running job counts", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      await startWorker(stateAdapter, "worker-1", ["type-a"]);
      await startWorker(stateAdapter, "worker-b", ["type-a"]);
      await startWorker(stateAdapter, "pod/7%a", ["type-b"]);
      await createJob(stateAdapter, "type-a", null);
      await startAttempt(stateAdapter, "type-a");

      const body = await parseBody(
        await call("getWorkers", { ids: ["worker-1", "pod/7%a", "nonexistent"] }),
      );

      expect(
        body.map((worker: { id: string; runningJobCount: number }) => [
          worker.id,
          worker.runningJobCount,
        ]),
      ).toEqual([
        ["worker-1", 1],
        ["pod/7%a", 0],
      ]);
    });
  });
});
