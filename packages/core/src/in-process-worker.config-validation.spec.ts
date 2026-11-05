import { describe, expect, it } from "vitest";

import { createClient } from "./client.js";
import { InvalidWorkerIdError } from "./errors.js";
import { createInProcessWorker } from "./in-process-worker.js";
import { createProcessors } from "./job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "./job-types/define-job-types.js";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.js";

type Defs = {
  foo: { entry: true; input: null; output: null };
};

const setup = async () => {
  const jobTypes = defineJobTypes<Defs>();
  const stateAdapter = await createInProcessStateAdapter();
  const client = await createClient({ stateAdapter, jobTypes });
  return { jobTypes, client };
};

describe("createInProcessWorker config validation", () => {
  it("names the processor and every invalid field", async () => {
    const { jobTypes, client } = await setup();

    const error = await createInProcessWorker({
      client,
      recoveryBackoffConfig: { initialDelayMs: -1, maxDelayMs: 1000 },
      leaseConfig: { durationMs: 0, heartbeatMs: 1000 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            backoffConfig: { initialDelayMs: 1000, maxDelayMs: Number.NaN, multiplier: 0 },
            attemptHandler: async () => undefined as never,
          },
        },
      }),
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(
      [
        "createInProcessWorker: invalid configuration:",
        "  - recoveryBackoffConfig.initialDelayMs must be a non-negative finite number (got -1)",
        "  - leaseConfig.durationMs must be a positive finite number (got 0)",
        '  - processors["foo"].backoffConfig.maxDelayMs must be a non-negative number (got NaN)',
        '  - processors["foo"].backoffConfig.multiplier must be a positive finite number (got 0)',
      ].join("\n"),
    );
  });

  it("rejects a lease heartbeat that is not below a third of its duration", async () => {
    const { jobTypes, client } = await setup();

    const error = await createInProcessWorker({
      client,
      leaseConfig: { durationMs: 900, heartbeatMs: 300 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: { foo: { attemptHandler: async () => undefined as never } },
      }),
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(
      [
        "createInProcessWorker: invalid configuration:",
        "  - leaseConfig.heartbeatMs must be below a third of leaseConfig.durationMs (got 300 and 900)",
      ].join("\n"),
    );
  });

  it("accepts fractional delays, an uncapped maxDelayMs and a fractional lease", async () => {
    const { jobTypes, client } = await setup();

    const worker = await createInProcessWorker({
      client,
      recoveryBackoffConfig: { initialDelayMs: 0, maxDelayMs: 1000.5, multiplier: 1.5 },
      backoffConfig: {
        initialDelayMs: 1.5,
        maxDelayMs: Number.POSITIVE_INFINITY,
        multiplier: 1.5,
      },
      leaseConfig: { durationMs: 100.5, heartbeatMs: 10.5 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: { foo: { attemptHandler: async () => undefined as never } },
      }),
    });

    expect(worker).toBeDefined();
  });

  it("rejects a non-integer concurrency and a non-positive pollIntervalMs", async () => {
    const { jobTypes, client } = await setup();

    const error = await createInProcessWorker({
      client,
      concurrency: 1.5,
      pollIntervalMs: 0,
      processors: createProcessors({
        client,
        jobTypes,
        processors: { foo: { attemptHandler: async () => undefined as never } },
      }),
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe(
      [
        "createInProcessWorker: invalid configuration:",
        "  - concurrency must be a positive integer (got 1.5)",
        "  - pollIntervalMs must be a positive finite number (got 0)",
      ].join("\n"),
    );
  });

  it("rejects a second start until the running start's stop resolves", async () => {
    const { jobTypes, client } = await setup();

    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: { foo: { attemptHandler: async () => undefined as never } },
      }),
    });

    const stop = await worker.start();
    await expect(worker.start()).rejects.toThrow("the worker is already started");
    await stop();
    const stopAgain = await worker.start();
    await stop();
    await expect(worker.start()).rejects.toThrow("the worker is already started");
    await stopAgain();
  });

  it("rejects a workerId that fails the state adapter's validateWorkerId", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter({
      validateWorkerId: (id) => id.startsWith("worker-"),
    });
    const client = await createClient({ stateAdapter, jobTypes });

    await expect(
      createInProcessWorker({
        client,
        workerId: "invalid",
        processors: createProcessors({
          client,
          jobTypes,
          processors: { foo: { attemptHandler: async () => undefined as never } },
        }),
      }),
    ).rejects.toThrow(InvalidWorkerIdError);
  });
});
