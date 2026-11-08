import { describe, expect, it } from "vitest";

import {
  parseBody,
  createTestDashboard,
  createJob,
  createUuidStrictDashboard,
} from "./dashboard.spec-helper.ts";

describe("RPC transport", () => {
  describe("RPC endpoint", () => {
    it("answers POST /api/rpc with an NDJSON stream of seroval records", async () => {
      const { call } = await createTestDashboard();

      const res = await call("getChainTypeNames");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/x-ndjson");
      expect(await parseBody(res)).toEqual([]);
    });

    it("returns 404 for any other API path", async () => {
      const { request } = await createTestDashboard();

      const res = await request("/api/chains");

      expect(res.status).toBe(404);
      expect(await parseBody(res)).toEqual({ error: "Not found" });
    });

    it("rejects invalid arguments with 400 and names the offending field", async () => {
      const { call } = await createTestDashboard();

      const missingRes = await call("listChains", {});
      const unknownFieldRes = await call("listChains", { typeName: "a", extra: true });
      const limitRes = await call("listChains", { typeName: "a", limit: 500 });
      const inputRes = await call("getChainTypeNames", { typeName: "a" });

      expect(missingRes.status).toBe(400);
      expect((await parseBody(missingRes)).error).toContain("data.typeName");
      expect(unknownFieldRes.status).toBe(400);
      expect((await parseBody(unknownFieldRes)).error).toContain("extra");
      expect(limitRes.status).toBe(400);
      expect((await parseBody(limitRes)).error).toContain("data.limit");
      expect(inputRes.status).toBe(400);
    });

    it("returns a JSON error body with status 500 when a server function throws", async () => {
      const { call, failures } = await createUuidStrictDashboard();
      failures.probe = true;

      const res = await call("getChainTypeNames");

      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await parseBody(res)).toEqual({ error: "connection refused" });
    });
  });

  describe("streamed promises", () => {
    it("rejects a streamed promise with the error message only, without stack or details", async () => {
      const { call, stateAdapter, failures } = await createUuidStrictDashboard();
      const job = await createJob(stateAdapter, "type-a", null);
      failures.delete = true;

      const res = await call("deleteChain", { id: job.chainId });
      const wire = await res.text();
      const body = await parseBody(new Response(wire, { headers: res.headers }));
      const error: unknown = await body.deleted.catch((err: unknown) => err);

      expect(res.status).toBe(200);
      expect(wire).toContain("deadlock detected");
      expect(wire).not.toContain("ShareLock");
      expect(wire).not.toContain("DELETE FROM");
      expect(wire).not.toMatch(/\n\s+at /);
      expect(wire).not.toContain("server.ts");
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("deadlock detected");
      expect(Object.keys(error as Error)).toEqual([]);
    });
  });
});
