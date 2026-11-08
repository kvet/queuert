import { RpcError } from "@queuert/rpc";
import { createClient, createInProcessStateAdapter, defineJobTypes } from "queuert";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDashboard } from "../api/dashboard.ts";
import { isNotFound, serverFns } from "./api.ts";

const createChain = async (stateAdapter: ReturnType<typeof createInProcessStateAdapter>) => {
  const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "test-type", input: null }],
    }),
  );
  return stateChain.head;
};

const serveDashboard = () => {
  const stateAdapter = createInProcessStateAdapter();
  const dashboard = createDashboard({
    client: createClient({ stateAdapter, jobTypes: defineJobTypes() }),
  });
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) =>
    dashboard.fetch(new Request(new URL(input, "http://test/"), init)),
  );
  return { stateAdapter };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serverFns client", () => {
  it("calls a server function and returns its deserialized result", async () => {
    const { stateAdapter } = serveDashboard();
    const job = await createChain(stateAdapter);

    const page = await serverFns.listChains({ data: { typeName: "test-type" } });

    expect(page.items.map((chain) => chain.id)).toEqual([job.chainId]);
    expect(page.items[0].createdAt).toBeInstanceOf(Date);
  });

  it("resolves a promise the server streams after the first record", async () => {
    const { stateAdapter } = serveDashboard();
    const job = await createChain(stateAdapter);

    const { deleted } = await serverFns.deleteChain({ data: { id: job.chainId } });

    expect(await deleted).toEqual({ outcome: "deleted", count: 1 });
  });

  it("throws an RpcError carrying the status and message of an error response", async () => {
    serveDashboard();

    const notFound = await serverFns
      .getJobDetail({ data: { id: "missing" } })
      .catch((err: unknown) => err);
    const invalid = await serverFns
      .listChains({ data: { typeName: "test-type", limit: 0 } })
      .catch((err: unknown) => err);

    expect(notFound).toBeInstanceOf(RpcError);
    expect(isNotFound(notFound)).toBe(true);
    expect((notFound as RpcError).message).toBe("Job not found");
    expect((invalid as RpcError).status).toBe(400);
  });
});
