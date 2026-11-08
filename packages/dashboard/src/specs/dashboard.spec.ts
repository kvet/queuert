import { createClient, createInProcessStateAdapter, defineJobTypes } from "queuert";
import { describe, expect, it } from "vitest";

import { createDashboard } from "../api/dashboard.ts";
import { rpcRequest, createTestDashboard, createJob } from "./dashboard.spec-helper.ts";

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
          stateAdapter: createInProcessStateAdapter(),
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
          stateAdapter: createInProcessStateAdapter(),
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
