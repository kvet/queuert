import { createClient, defineJobTypes, createSyncInProcessStateAdapter } from "queuert";
import { describe, expect, it } from "vitest";

import { createDashboard } from "../api/dashboard.ts";
import { parseBody, rpcRequest } from "./dashboard.spec-helper.ts";

const jobTypes = defineJobTypes<{
  blocker: { entry: true; input: null; output: null };
  blocked: { entry: true; input: null; output: null; blockers: [{ typeName: "blocker" }] };
}>();

const createSyncDashboard = () => {
  const stateAdapter = createSyncInProcessStateAdapter();
  const client = createClient({ stateAdapter, jobTypes });
  const dashboard = createDashboard({ client });
  const call = async (fn: string, data?: unknown) =>
    dashboard.fetch(rpcRequest("http://test/api/rpc", fn, data));
  return { stateAdapter, client, call };
};

describe("dashboard over a sync state adapter", () => {
  it("reads, reschedules and deletes chains through synchronous transactions", async () => {
    const { stateAdapter, client, call } = createSyncDashboard();
    const { blocker, blocked } = stateAdapter.withTransaction((txCtx) => {
      const blockerChain = client.createChain({
        ...txCtx,
        typeName: "blocker",
        input: null,
        schedule: { afterMs: 60_000 },
      });
      const blockedChain = client.createChain({
        ...txCtx,
        typeName: "blocked",
        input: null,
        blockers: [blockerChain],
      });
      return { blocker: blockerChain, blocked: blockedChain };
    });

    const chains = await parseBody(await call("getChains", { ids: [blocker.id] }));
    expect(chains.map((chain: { id: string }) => chain.id)).toEqual([blocker.id]);

    const rescheduled = await call("rescheduleJob", { id: blocker.id });
    expect(rescheduled.status).toBe(200);
    expect(client.getJob({ id: blocker.id })!.scheduledAt.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );

    const refused = await parseBody(await call("deleteChain", { id: blocker.id }));
    expect(await refused.deleted).toEqual({ outcome: "blocked" });

    const deleted = await parseBody(await call("deleteChain", { id: blocked.id }));
    expect(await deleted.deleted).toEqual({ outcome: "deleted", count: 1 });
    expect(client.getChain({ id: blocked.id })).toBeUndefined();
  });
});
