import { describe, expect, it } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import { createProcessors } from "./create-processors.js";

type Defs = {
  foo: { entry: true; input: { v: number }; output: { ok: true } };
};
const jobTypes = defineJobTypes<Defs>();

const stateAdapter = await createInProcessStateAdapter();
const client = await createClient({ stateAdapter, jobTypes });

describe("registry-level backoffConfig / leaseConfig cascade", () => {
  it("stamps registry-level defaults onto processors that don't override them", () => {
    const registry = createProcessors({
      client,
      jobTypes,
      backoffConfig: { initialDelayMs: 111, multiplier: 2, maxDelayMs: 500 },
      leaseConfig: { leaseMs: 1111, renewIntervalMs: 500 },
      processors: {
        foo: {
          attemptHandler: async ({ complete }) => complete(async () => ({ ok: true as const })),
        },
      },
    });

    const processor = (registry as unknown as Record<string, any>).foo;
    expect(processor.backoffConfig).toEqual({
      initialDelayMs: 111,
      multiplier: 2,
      maxDelayMs: 500,
    });
    expect(processor.leaseConfig).toEqual({ leaseMs: 1111, renewIntervalMs: 500 });
  });

  it("processor-level overrides take precedence over registry-level", () => {
    const registry = createProcessors({
      client,
      jobTypes,
      backoffConfig: { initialDelayMs: 111, multiplier: 2, maxDelayMs: 500 },
      leaseConfig: { leaseMs: 1111, renewIntervalMs: 500 },
      processors: {
        foo: {
          attemptHandler: async ({ complete }) => complete(async () => ({ ok: true as const })),
          backoffConfig: { initialDelayMs: 999, multiplier: 3, maxDelayMs: 9999 },
          leaseConfig: { leaseMs: 9999, renewIntervalMs: 1000 },
        },
      },
    });

    const processor = (registry as unknown as Record<string, any>).foo;
    expect(processor.backoffConfig).toEqual({
      initialDelayMs: 999,
      multiplier: 3,
      maxDelayMs: 9999,
    });
    expect(processor.leaseConfig).toEqual({ leaseMs: 9999, renewIntervalMs: 1000 });
  });

  it("leaves processors untouched when registry provides no defaults", () => {
    const registry = createProcessors({
      client,
      jobTypes,
      processors: {
        foo: {
          attemptHandler: async ({ complete }) => complete(async () => ({ ok: true as const })),
        },
      },
    });

    const processor = (registry as unknown as Record<string, any>).foo;
    expect(processor.backoffConfig).toBeUndefined();
    expect(processor.leaseConfig).toBeUndefined();
  });
});
