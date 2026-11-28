import { describe, expect, it } from "vitest";

import { createClient } from "../client/client.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import { createProcessors } from "./create-job-type-processors.ts";

type Defs = {
  foo: { entry: true; input: { v: number }; output: { ok: true } };
  bar: { entry: true; input: null; output: null };
  baz: { entry: true; input: null; output: null };
  qux: { entry: true; input: null; output: null };
  quux: { entry: true; input: null; output: null };
};
const jobTypes = defineJobTypes<Defs>();

const stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

describe("createProcessors config validation", () => {
  it("names the processor and every invalid field", () => {
    expect(() => {
      createProcessors({
        client,
        jobTypes,
        backoffConfig: { initialDelayMs: -1, maxDelayMs: 1000 },
        processors: {
          foo: {
            backoffConfig: { initialDelayMs: 1000, maxDelayMs: Number.NaN, multiplier: 0 },
            batchLimit: 0,
            batchAttemptHandler: async () => {},
          },
          bar: { batchLimit: undefined, batchAttemptHandler: async () => {} } as never,
          baz: { batchLimit: 5, attemptHandler: async () => {} } as never,
          qux: {} as never,
          quux: {
            attemptHandler: async () => {},
            batchAttemptHandler: async () => {},
            batchLimit: 5,
          } as never,
        },
      });
    }).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: [
          "createProcessors: invalid configuration:",
          "  - backoffConfig.initialDelayMs must be a non-negative finite number (got -1)",
          '  - processors["foo"].backoffConfig.maxDelayMs must be a non-negative number (got NaN)',
          '  - processors["foo"].backoffConfig.multiplier must be a positive finite number (got 0)',
          '  - processors["foo"].batchLimit must be a positive integer (got 0)',
          '  - processors["bar"].batchLimit must be a positive integer (got undefined)',
          '  - processors["baz"].batchLimit requires batchAttemptHandler',
          '  - processors["qux"] must have exactly one of attemptHandler and batchAttemptHandler',
          '  - processors["quux"] must have exactly one of attemptHandler and batchAttemptHandler',
        ].join("\n"),
      }),
    );
  });
});

describe("registry-level backoffConfig cascade", () => {
  it("stamps registry-level defaults onto processors that don't override them", () => {
    const registry = createProcessors({
      client,
      jobTypes,
      backoffConfig: { initialDelayMs: 111, multiplier: 2, maxDelayMs: 500 },
      processors: {
        foo: {
          attemptHandler: async ({ applyJobOutcome }) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcome({ ...txCtx, output: { ok: true as const } }),
            );
          },
        },
      },
    });

    const processor = (registry as unknown as Record<string, any>).foo;
    expect(processor.backoffConfig).toEqual({
      initialDelayMs: 111,
      multiplier: 2,
      maxDelayMs: 500,
    });
  });

  it("processor-level overrides take precedence over registry-level", () => {
    const registry = createProcessors({
      client,
      jobTypes,
      backoffConfig: { initialDelayMs: 111, multiplier: 2, maxDelayMs: 500 },
      processors: {
        foo: {
          attemptHandler: async ({ applyJobOutcome }) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcome({ ...txCtx, output: { ok: true as const } }),
            );
          },
          backoffConfig: { initialDelayMs: 999, multiplier: 3, maxDelayMs: 9999 },
        },
      },
    });

    const processor = (registry as unknown as Record<string, any>).foo;
    expect(processor.backoffConfig).toEqual({
      initialDelayMs: 999,
      multiplier: 3,
      maxDelayMs: 9999,
    });
  });

  it("leaves processors untouched when registry provides no defaults", () => {
    const registry = createProcessors({
      client,
      jobTypes,
      processors: {
        foo: {
          attemptHandler: async ({ applyJobOutcome }) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcome({ ...txCtx, output: { ok: true as const } }),
            );
          },
        },
      },
    });

    const processor = (registry as unknown as Record<string, any>).foo;
    expect(processor.backoffConfig).toBeUndefined();
  });
});
