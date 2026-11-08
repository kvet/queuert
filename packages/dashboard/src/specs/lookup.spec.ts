import { describe, expect, it } from "vitest";

import {
  parseBody,
  createJob,
  startWorker,
  createUuidStrictDashboard,
} from "./dashboard.spec-helper.ts";

describe("ID lookups", () => {
  describe("malformed IDs", () => {
    it("returns only the valid items when getChains and getJobs mix valid and malformed IDs", async () => {
      const { call, stateAdapter } = await createUuidStrictDashboard();
      const job = await createJob(stateAdapter, "type-a", null);

      const chains = await parseBody(await call("getChains", { ids: [job.chainId, "junk"] }));
      const jobs = await parseBody(await call("getJobs", { ids: ["junk", job.id] }));

      expect(chains.map((c: { id: string }) => c.id)).toEqual([job.chainId]);
      expect(jobs.map((j: { id: string }) => j.id)).toEqual([job.id]);
    });

    it("returns an empty list when getChains and getJobs have only malformed IDs", async () => {
      const { call } = await createUuidStrictDashboard();

      expect(await parseBody(await call("getChains", { ids: ["junk", "also-junk"] }))).toEqual([]);
      expect(await parseBody(await call("getJobs", { ids: ["junk"] }))).toEqual([]);
    });

    it("returns 500 when ID lookups fail and the database probe fails too", async () => {
      const { call, failures } = await createUuidStrictDashboard();
      failures.probe = true;

      const res = await call("getChains", { ids: ["junk"] });

      expect(res.status).toBe(500);
      expect((await parseBody(res)).error).toContain("invalid input syntax");
    });

    it("returns 404 for chain detail, job detail and actions with a malformed ID", async () => {
      const { call } = await createUuidStrictDashboard();

      const chainRes = await call("getChainDetail", { id: "junk" });
      const jobRes = await call("getJobDetail", { id: "junk" });
      const deleteRes = await call("deleteChain", { id: "junk" });
      const rescheduleRes = await call("rescheduleJob", { id: "junk" });
      const chainJobsRes = await call("listChainJobs", { chainId: "junk" });
      const blockingRes = await call("listBlockedJobs", { chainId: "junk" });

      expect(chainRes.status).toBe(404);
      expect((await parseBody(chainRes)).error).toBe("Chain not found");
      expect(jobRes.status).toBe(404);
      expect((await parseBody(jobRes)).error).toBe("Job not found");
      expect(deleteRes.status).toBe(404);
      expect(rescheduleRes.status).toBe(404);
      expect((await parseBody(rescheduleRes)).error).toBe("Job not found");
      expect(chainJobsRes.status).toBe(404);
      expect((await parseBody(chainJobsRes)).error).toBe("Chain not found");
      expect(blockingRes.status).toBe(404);
      expect((await parseBody(blockingRes)).error).toBe("Chain not found");
    });

    it("returns only the valid workers when getWorkers mixes valid and malformed IDs", async () => {
      const { call, stateAdapter } = await createUuidStrictDashboard();
      const workerId = crypto.randomUUID();
      await startWorker(stateAdapter, workerId, ["type-a"]);

      const body = await parseBody(await call("getWorkers", { ids: ["junk", workerId] }));

      expect(body.map((w: { id: string }) => w.id)).toEqual([workerId]);
    });

    it("returns 404 for worker detail and an empty page for its jobs with a malformed ID", async () => {
      const { call } = await createUuidStrictDashboard();

      const workerRes = await call("getWorker", { id: "junk" });
      const workerJobsRes = await call("listWorkerJobs", { workerId: "junk" });

      expect(workerRes.status).toBe(404);
      expect(await parseBody(workerRes)).toEqual({ error: "Worker not found" });
      expect(await parseBody(workerJobsRes)).toEqual({ items: [], nextCursor: null });
    });

    it("returns 500 for worker detail with a malformed ID when the database probe fails too", async () => {
      const { call, failures } = await createUuidStrictDashboard();
      failures.probe = true;

      const res = await call("getWorker", { id: "junk" });

      expect(res.status).toBe(500);
      expect((await parseBody(res)).error).toContain("invalid input syntax");
    });

    it("returns 500 when rescheduling a malformed ID and the database probe fails too", async () => {
      const { call, failures } = await createUuidStrictDashboard();
      failures.probe = true;

      const res = await call("rescheduleJob", { id: "junk" });

      expect(res.status).toBe(500);
      expect((await parseBody(res)).error).toContain("invalid input syntax");
    });
  });
});
