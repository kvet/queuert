import { sleep } from "@queuert/helpers";
import { describe, expect, it } from "vitest";

import { createClient } from "./client.ts";
import { createProcessors } from "./job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "./job-types/define-job-types.ts";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.ts";
import { withTxHooks } from "./tx-hooks/tx-hooks.ts";
import { createWorkerRunner } from "./worker-runner.ts";

const jobTypes = defineJobTypes<{
  foo: { entry: true; input: null; output: null };
}>();

describe("createWorkerRunner lifecycle", () => {
  it("starts, stops and starts again, rejecting start while started or stopping", async () => {
    const stateAdapter = createInProcessStateAdapter();
    const client = createClient({ stateAdapter, jobTypes });
    const workerRunner = createWorkerRunner({
      client,
      workerId: "lifecycle-worker",
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            attemptHandler: async ({ complete }) =>
              withTxHooks(async (txHooks) =>
                stateAdapter.withTransaction(async (txCtx) =>
                  complete({ ...txCtx, txHooks, output: null }),
                ),
              ),
          },
        },
      }),
    });
    const runChain = async () => {
      const chain = await withTxHooks(async (txHooks) =>
        stateAdapter.withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, txHooks, typeName: "foo", input: null }),
        ),
      );
      await client.awaitChain(chain, { timeoutMs: 5000 });
    };

    await workerRunner.stop();

    await workerRunner.start();
    await expect(workerRunner.start()).rejects.toThrow("the worker runner is already started");
    await runChain();
    const stopping = workerRunner.stop();
    await expect(workerRunner.start()).rejects.toThrow("the worker runner is already started");
    await stopping;
    expect(await client.getWorker({ id: "lifecycle-worker" })).toBeUndefined();

    await workerRunner.start();
    await runChain();
    await workerRunner.stop();
    expect(await client.getWorker({ id: "lifecycle-worker" })).toBeUndefined();
  });

  it("resolves concurrent stops only once the running attempt ends", async () => {
    const stateAdapter = createInProcessStateAdapter();
    const client = createClient({ stateAdapter, jobTypes });
    const attemptStarted = Promise.withResolvers<void>();
    const attemptReleased = Promise.withResolvers<void>();
    const workerRunner = createWorkerRunner({
      client,
      workerId: "lifecycle-worker",
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            attemptHandler: async ({ complete }) => {
              attemptStarted.resolve();
              await attemptReleased.promise;
              return withTxHooks(async (txHooks) =>
                stateAdapter.withTransaction(async (txCtx) =>
                  complete({ ...txCtx, txHooks, output: null }),
                ),
              );
            },
          },
        },
      }),
    });

    await workerRunner.start();
    await withTxHooks(async (txHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, txHooks, typeName: "foo", input: null }),
      ),
    );
    await attemptStarted.promise;

    let resolvedStops = 0;
    const stops = [workerRunner.stop(), workerRunner.stop()].map(async (stop) =>
      stop.then(() => {
        resolvedStops++;
      }),
    );
    await sleep(100);
    expect(resolvedStops).toBe(0);

    attemptReleased.resolve();
    await Promise.all(stops);
    expect(resolvedStops).toBe(2);
    expect(await client.getWorker({ id: "lifecycle-worker" })).toBeUndefined();

    await workerRunner.start();
    await workerRunner.stop();
  });

  it("closes once a stop in flight ends and rejects every later start", async () => {
    const stateAdapter = createInProcessStateAdapter();
    const client = createClient({ stateAdapter, jobTypes });
    const attemptStarted = Promise.withResolvers<void>();
    const attemptReleased = Promise.withResolvers<void>();
    const workerRunner = createWorkerRunner({
      client,
      workerId: "lifecycle-worker",
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            attemptHandler: async ({ complete }) => {
              attemptStarted.resolve();
              await attemptReleased.promise;
              return withTxHooks(async (txHooks) =>
                stateAdapter.withTransaction(async (txCtx) =>
                  complete({ ...txCtx, txHooks, output: null }),
                ),
              );
            },
          },
        },
      }),
    });

    await workerRunner.start();
    await withTxHooks(async (txHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, txHooks, typeName: "foo", input: null }),
      ),
    );
    await attemptStarted.promise;

    let closed = false;
    const stopping = workerRunner.stop();
    const closing = workerRunner.close().then(() => {
      closed = true;
    });
    await sleep(100);
    expect(closed).toBe(false);

    attemptReleased.resolve();
    await Promise.all([stopping, closing]);
    expect(await client.getWorker({ id: "lifecycle-worker" })).toBeUndefined();
    await expect(workerRunner.start()).rejects.toThrow("the worker runner is closed");
    await workerRunner.close();
    await workerRunner.stop();
  });

  it("rejects start once closed directly or by an await using scope", async () => {
    const stateAdapter = createInProcessStateAdapter();
    const client = createClient({ stateAdapter, jobTypes });
    const processors = createProcessors({
      client,
      jobTypes,
      processors: { foo: { attemptHandler: async () => undefined as never } },
    });

    const neverStartedWorkerRunner = createWorkerRunner({ client, processors });
    await neverStartedWorkerRunner.close();
    await expect(neverStartedWorkerRunner.start()).rejects.toThrow("the worker runner is closed");

    const scopedWorkerRunner = createWorkerRunner({
      client,
      workerId: "lifecycle-worker",
      processors,
    });
    {
      await using workerRunner = scopedWorkerRunner;
      await workerRunner.start();
    }
    expect(await client.getWorker({ id: "lifecycle-worker" })).toBeUndefined();
    await expect(scopedWorkerRunner.start()).rejects.toThrow("the worker runner is closed");
  });
});
