import { describe, expect, it } from "vitest";

import { createClient } from "./client.ts";
import { InvalidWorkerIdError } from "./errors.ts";
import { createProcessors } from "./job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "./job-types/define-job-types.ts";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.ts";
import { createWorkerRunner } from "./worker-runner.ts";

type Defs = {
  foo: { entry: true; input: null; output: null };
};

const setup = () => {
  const jobTypes = defineJobTypes<Defs>();
  const stateAdapter = createInProcessStateAdapter();
  const client = createClient({ stateAdapter, jobTypes });
  return { jobTypes, client };
};

describe("createWorkerRunner config validation", () => {
  it("names the processor and every invalid field", () => {
    const { jobTypes, client } = setup();

    expect(() => {
      createWorkerRunner({
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
      });
    }).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: [
          "createWorkerRunner: invalid configuration:",
          "  - recoveryBackoffConfig.initialDelayMs must be a non-negative finite number (got -1)",
          "  - leaseConfig.durationMs must be a positive finite number (got 0)",
          '  - processors["foo"].backoffConfig.maxDelayMs must be a non-negative number (got NaN)',
          '  - processors["foo"].backoffConfig.multiplier must be a positive finite number (got 0)',
        ].join("\n"),
      }),
    );
  });

  it("rejects a lease heartbeat that is not below a third of its duration", () => {
    const { jobTypes, client } = setup();

    expect(() => {
      createWorkerRunner({
        client,
        leaseConfig: { durationMs: 900, heartbeatMs: 300 },
        processors: createProcessors({
          client,
          jobTypes,
          processors: { foo: { attemptHandler: async () => undefined as never } },
        }),
      });
    }).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: [
          "createWorkerRunner: invalid configuration:",
          "  - leaseConfig.heartbeatMs must be below a third of leaseConfig.durationMs (got 300 and 900)",
        ].join("\n"),
      }),
    );
  });

  it("accepts fractional delays, an uncapped maxDelayMs and a fractional lease", () => {
    const { jobTypes, client } = setup();

    const workerRunner = createWorkerRunner({
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

    expect(workerRunner).toBeDefined();
  });

  it("rejects a non-integer concurrency and a non-positive pollIntervalMs", () => {
    const { jobTypes, client } = setup();

    expect(() => {
      createWorkerRunner({
        client,
        concurrency: 1.5,
        pollIntervalMs: 0,
        processors: createProcessors({
          client,
          jobTypes,
          processors: { foo: { attemptHandler: async () => undefined as never } },
        }),
      });
    }).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: [
          "createWorkerRunner: invalid configuration:",
          "  - concurrency must be a positive integer (got 1.5)",
          "  - pollIntervalMs must be a positive finite number (got 0)",
        ].join("\n"),
      }),
    );
  });

  it("rejects a second start until the running start's stop resolves", async () => {
    const { jobTypes, client } = setup();

    const workerRunner = createWorkerRunner({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: { foo: { attemptHandler: async () => undefined as never } },
      }),
    });

    const stop = await workerRunner.start();
    await expect(workerRunner.start()).rejects.toThrow("the worker runner is already started");
    await stop();
    const stopAgain = await workerRunner.start();
    await stop();
    await expect(workerRunner.start()).rejects.toThrow("the worker runner is already started");
    await stopAgain();
  });

  it("rejects a workerId that fails the state adapter's validateWorkerId", () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter({
      validateWorkerId: (id) => id.startsWith("worker-"),
    });
    const client = createClient({ stateAdapter, jobTypes });

    expect(() => {
      createWorkerRunner({
        client,
        workerId: "invalid",
        processors: createProcessors({
          client,
          jobTypes,
          processors: { foo: { attemptHandler: async () => undefined as never } },
        }),
      });
    }).toThrow(InvalidWorkerIdError);
  });
});
