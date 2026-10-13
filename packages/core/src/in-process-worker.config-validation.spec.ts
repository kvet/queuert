import { describe, expect, it } from "vitest";

import { createClient } from "./client.js";
import { defineJobTypes } from "./entities/define-job-types.js";
import { createInProcessWorker } from "./in-process-worker.js";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.js";
import { createProcessors } from "./worker/create-processors.js";

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
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["negative", -1],
  ])("rejects a %s defaults.attemptConfig.timeoutMs", async (_, timeoutMs) => {
    const { jobTypes, client } = await setup();

    await expect(
      createInProcessWorker({
        client,
        defaults: { attemptConfig: { timeoutMs, heartbeatMs: 1000 } },
        processors: createProcessors({
          client,
          jobTypes,
          processors: { foo: { attemptHandler: async () => undefined as never } },
        }),
      }),
    ).rejects.toThrow(
      `defaults.attemptConfig.timeoutMs must be a positive finite number (got ${String(timeoutMs)})`,
    );
  });

  it("names the processor and every invalid field", async () => {
    const { jobTypes, client } = await setup();

    const error = await createInProcessWorker({
      client,
      recoveryBackoffConfig: { initialDelayMs: -1, maxDelayMs: 1000 },
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            backoffConfig: { initialDelayMs: 1000, maxDelayMs: Number.NaN, multiplier: 0 },
            attemptConfig: { timeoutMs: 1000, heartbeatMs: Number.POSITIVE_INFINITY },
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
        '  - processors["foo"].backoffConfig.maxDelayMs must be a non-negative number (got NaN)',
        '  - processors["foo"].backoffConfig.multiplier must be a positive finite number (got 0)',
        '  - processors["foo"].attemptConfig.heartbeatMs must be a positive finite number (got Infinity)',
      ].join("\n"),
    );
  });

  it("accepts fractional delays, an uncapped maxDelayMs and a heartbeat longer than the timeout", async () => {
    const { jobTypes, client } = await setup();

    const worker = await createInProcessWorker({
      client,
      recoveryBackoffConfig: { initialDelayMs: 0, maxDelayMs: 1000.5, multiplier: 1.5 },
      defaults: {
        backoffConfig: {
          initialDelayMs: 1.5,
          maxDelayMs: Number.POSITIVE_INFINITY,
          multiplier: 1.5,
        },
        attemptConfig: { timeoutMs: 10.5, heartbeatMs: 100 },
      },
      processors: createProcessors({
        client,
        jobTypes,
        processors: { foo: { attemptHandler: async () => undefined as never } },
      }),
    });

    expect(worker).toBeDefined();
  });
});
