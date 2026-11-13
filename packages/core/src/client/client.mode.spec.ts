import { describe, expect, expectTypeOf, it } from "vitest";

import { createProcessors } from "../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import {
  createInProcessStateAdapter,
  createSyncInProcessStateAdapter,
} from "../state-adapter.in-process/state-adapter.in-process.ts";
import { createWorkerRunner } from "../worker/worker-runner.ts";
import { createClient } from "./client.ts";

const jobTypes = defineJobTypes<{
  greet: {
    entry: true;
    input: { name: string };
    output: { greeting: string };
  };
}>();

const syncIt = it
  // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
  .extend("stateAdapter", async ({}, { onCleanup }) => {
    const stateAdapter = createSyncInProcessStateAdapter();
    onCleanup(() => {
      stateAdapter.close();
    });
    return stateAdapter;
  })
  .extend("client", async ({ stateAdapter }) => createClient({ stateAdapter, jobTypes }));

describe("createClient over a sync state adapter", () => {
  syncIt("types state-touching methods as synchronous and awaitChain as async", ({ client }) => {
    expectTypeOf(client.createChain).returns.not.toExtend<Promise<unknown>>();
    expectTypeOf(client.getChains).returns.not.toExtend<Promise<unknown>>();
    expectTypeOf(client.awaitChain).returns.toExtend<Promise<unknown>>();
  });

  it("types state-touching methods as promises over an async state adapter", () => {
    const client = createClient({ stateAdapter: createInProcessStateAdapter(), jobTypes });
    expectTypeOf(client.createChain).returns.toExtend<Promise<unknown>>();
    expectTypeOf(client.getChains).returns.toExtend<Promise<unknown>>();
  });

  syncIt("accepts a notify adapter of either mode", ({ stateAdapter }) => {
    const client = createClient({
      stateAdapter,
      notifyAdapter: createInProcessNotifyAdapter(),
      jobTypes,
    });
    expectTypeOf(client.createChain).returns.not.toExtend<Promise<unknown>>();
  });

  syncIt("returns plain values from state-touching methods", ({ client, stateAdapter }) => {
    const chain = stateAdapter.withTransaction((txCtx) =>
      client.createChain({ ...txCtx, typeName: "greet", input: { name: "Ada" } }),
    );
    expect(chain).not.toBeInstanceOf(Promise);
    expect(client.getChain({ id: chain.id })).toMatchObject({ id: chain.id, status: "running" });
  });

  syncIt("throws a misuse error synchronously", ({ client }) => {
    expect(() =>
      // @ts-expect-error -- the types require a transaction context; the runtime check covers callers that get past them
      client.createChain({ typeName: "greet", input: { name: "Ada" } }),
    ).toThrow("createChain requires a transaction context");
  });

  syncIt("throws when a completeChain handler returns a promise", ({ client, stateAdapter }) => {
    const chain = stateAdapter.withTransaction((txCtx) =>
      client.createChain({ ...txCtx, typeName: "greet", input: { name: "Ada" } }),
    );

    expect(() =>
      stateAdapter.withTransaction((txCtx) =>
        client.completeChain({
          ...txCtx,
          typeName: "greet",
          id: chain.id,
          handler: async () => {},
        }),
      ),
    ).toThrow("Expected a synchronous callback, but it returned a promise");
  });

  syncIt("throws when a completeJob callback returns a promise", ({ client, stateAdapter }) => {
    const chain = stateAdapter.withTransaction((txCtx) =>
      client.createChain({ ...txCtx, typeName: "greet", input: { name: "Ada" } }),
    );

    expect(() =>
      stateAdapter.withTransaction((txCtx) =>
        client.completeChain({
          ...txCtx,
          typeName: "greet",
          id: chain.id,
          handler: ({ job, completeJob }) =>
            // @ts-expect-error -- the types reject an async callback; the runtime check covers callers that get past them
            completeJob(job, async () => {}),
        }),
      ),
    ).toThrow("Expected a synchronous callback, but it returned a promise");
  });

  syncIt("throws when a withTransaction callback returns a promise", ({ stateAdapter }) => {
    expect(() => {
      void stateAdapter.withTransaction(async () => {});
    }).toThrow("returned a promise");
  });
});

describe("worker runner over a sync client", () => {
  syncIt("builds processors and a worker runner from the same factories", ({ client }) => {
    const workerRunner = createWorkerRunner({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: { greet: { attemptHandler: async () => undefined as never } },
      }),
    });
    expectTypeOf(workerRunner.start).toBeFunction();
  });

  syncIt("names createWorkerRunner in its configuration errors", ({ client }) => {
    expect(() => {
      createWorkerRunner({
        client,
        leaseConfig: { durationMs: 0, heartbeatMs: 1000 },
        processors: createProcessors({
          client,
          jobTypes,
          processors: { greet: { attemptHandler: async () => undefined as never } },
        }),
      });
    }).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: [
          "createWorkerRunner: invalid configuration:",
          "  - leaseConfig.durationMs must be a positive finite number (got 0)",
        ].join("\n"),
      }),
    );
  });
});
