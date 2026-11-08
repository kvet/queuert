import { describe, expect, it } from "vitest";

import {
  parseBody,
  createTestDashboard,
  createJob,
  startAttempt,
  startWorker,
  completeJob,
  encodeRawCursor,
} from "./dashboard.spec-helper.ts";

describe("argument validation", () => {
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

    it.for(malformed)("rejects a cursor with %s", async ([, payload]) => {
      const { call } = await createTestDashboard();

      const res = await call("listChains", {
        typeName: "test-type",
        cursor: encodeRawCursor(payload),
      });

      expect(res.status).toBe(400);
      expect((await parseBody(res)).error).toContain("data.cursor");
    });

    it("rejects a cursor that is not valid base64url JSON", async () => {
      const { call } = await createTestDashboard();
      const res = await call("listChains", { typeName: "test-type", cursor: "not-a-cursor" });
      expect(res.status).toBe(400);
    });

    it("rejects a cursor issued for a different orderBy", async () => {
      const { call, stateAdapter } = await createTestDashboard();
      const first = await createJob(stateAdapter, "test-type", null);
      const second = await createJob(stateAdapter, "test-type", null);
      await startWorker(stateAdapter, "worker-1", ["test-type"]);
      await startAttempt(stateAdapter, "test-type");
      await completeJob(stateAdapter, first.id, { output: null });
      await startAttempt(stateAdapter, "test-type");
      await completeJob(stateAdapter, second.id, { output: null });

      const page = await parseBody(
        await call("listChains", {
          typeName: "test-type",
          status: "completed",
          orderBy: "completedAt",
          limit: 1,
        }),
      );
      expect(page.nextCursor).not.toBeNull();

      const res = await call("listChains", {
        typeName: "test-type",
        status: "completed",
        orderBy: "createdAt",
        cursor: page.nextCursor,
      });

      expect(res.status).toBe(400);
    });

    it("rejects the wrong cursor kind on every paginated function", async () => {
      const { call } = await createTestDashboard();
      const timestampCursor = (sortKey: string) =>
        encodeRawCursor({
          type: "timestampWithId",
          sortKey,
          value: new Date().toISOString(),
          id: "x",
        });

      const responses = await Promise.all([
        call("listChainJobs", { chainId: "c", cursor: timestampCursor("createdAt") }),
        call("listBlockedJobs", { chainId: "c", cursor: encodeRawCursor({ type: "id", id: "x" }) }),
        call("listWorkers", { cursor: timestampCursor("attemptAt") }),
        call("listWorkerJobs", { workerId: "w", cursor: timestampCursor("startedAt") }),
        call("listJobs", {
          typeName: "test-type",
          status: "running",
          cursor: timestampCursor("createdAt"),
        }),
      ]);

      expect(responses.map((res) => res.status)).toEqual([400, 400, 400, 400, 400]);
    });
  });

  describe("ID lists", () => {
    it("rejects more than 100 IDs with 400", async () => {
      const { call } = await createTestDashboard();
      const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);

      const responses = await Promise.all(
        ["getChains", "getJobs", "getWorkers"].map(async (fn) => call(fn, { ids })),
      );

      expect(responses.map((res) => res.status)).toEqual([400, 400, 400]);
      expect((await parseBody(responses[0])).error).toContain("data.ids");
    });

    it("counts IDs after de-duplication against the 100 ID limit", async () => {
      const { call } = await createTestDashboard();
      const ids = [...Array.from({ length: 100 }, (_, i) => `id-${i}`), "id-0"];

      expect((await call("getChains", { ids })).status).toBe(200);
    });
  });
});
