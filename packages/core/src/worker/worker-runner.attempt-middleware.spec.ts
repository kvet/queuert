import { describe, expect, it } from "vitest";

import type { AttemptMiddleware } from "../attempt-middleware/attempt-middleware.ts";
import { createClient } from "../client/client.ts";
import { createProcessors } from "../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import {
  createInProcessStateAdapter,
  type InProcessStateAdapter,
} from "../state-adapter.in-process/state-adapter.in-process.ts";
import { createWorkerRunner } from "./worker-runner.ts";

type Defs = {
  foo: { entry: true; input: { v: number }; output: { ok: true } };
};
const jobTypes = defineJobTypes<Defs>();

const stateAdapter = createInProcessStateAdapter({ mode: "async" });
const client = createClient({ stateAdapter, jobTypes });

describe("middleware ctx cannot shadow built-in handler keys", () => {
  it("handler built-ins (job, applyJobOutcome, fenceJob) win over middleware-injected ctx and in-place changes to jobs", async () => {
    const sentinel = { tampered: true };
    const tampering: AttemptMiddleware<InProcessStateAdapter<"async">> = {
      wrapHandler: async ({ jobs, next }) => {
        jobs.splice(0);
        await next({
          job: sentinel,
          applyJobOutcome: sentinel,
          fenceJob: sentinel,
        });
      },
    };

    let observedJobHasId = false;
    let observedJobSignalIsAbortSignal = false;
    let observedApplyJobOutcomeIsFn = false;
    let observedFenceJobIsFn = false;

    const registry = createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [tampering],
      processors: {
        foo: {
          attemptHandler: async ({ job, applyJobOutcome, fenceJob }) => {
            observedJobHasId = typeof job?.id === "string";
            observedJobSignalIsAbortSignal = job?.signal instanceof AbortSignal;
            observedApplyJobOutcomeIsFn = typeof applyJobOutcome === "function";
            observedFenceJobIsFn = typeof fenceJob === "function";
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcome({ ...txCtx, output: { ok: true as const } }),
            );
          },
        },
      },
    });

    await using workerRunner = createWorkerRunner({
      client,
      processors: registry,
    });
    const chain = await stateAdapter.withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "foo", input: { v: 1 } }),
    );
    await workerRunner.start();
    await client.awaitChain({ chain, timeoutMs: 5000, pollIntervalMs: 50 });
    await workerRunner.close();

    expect(observedJobHasId).toBe(true);
    expect(observedJobSignalIsAbortSignal).toBe(true);
    expect(observedApplyJobOutcomeIsFn).toBe(true);
    expect(observedFenceJobIsFn).toBe(true);
  });
});

describe("middleware ctx flows into the handler through wrapHandler", () => {
  it("merges ctx across middleware and runs them as an onion around the handler", async () => {
    const events: string[] = [];

    const outer: AttemptMiddleware<
      InProcessStateAdapter<"async">,
      { tenant: string; source: string }
    > = {
      wrapHandler: async ({ next }) => {
        events.push("outer:before");
        await next({ tenant: "acme", source: "outer" });
        events.push("outer:after");
      },
    };
    const inner: AttemptMiddleware<InProcessStateAdapter<"async">, { source: string }> = {
      wrapHandler: async ({ jobs, next }) => {
        events.push(...jobs.map((job) => `inner:before:${job.typeName}`));
        await next({ source: "inner" });
        events.push("inner:after");
      },
    };

    let observedCtx: { tenant: string; source: string } | undefined;

    const registry = createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [outer, inner],
      processors: {
        foo: {
          attemptHandler: async ({ tenant, source, applyJobOutcome }) => {
            events.push("handler");
            observedCtx = { tenant, source };
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcome({ ...txCtx, output: { ok: true as const } }),
            );
          },
        },
      },
    });

    await using workerRunner = createWorkerRunner({
      client,
      processors: registry,
    });
    const chain = await stateAdapter.withTransaction(async (txCtx) =>
      client.createChain({ ...txCtx, typeName: "foo", input: { v: 1 } }),
    );
    await workerRunner.start();
    await client.awaitChain({ chain, timeoutMs: 5000, pollIntervalMs: 50 });
    await workerRunner.close();

    expect(events).toEqual([
      "outer:before",
      "inner:before:foo",
      "handler",
      "inner:after",
      "outer:after",
    ]);
    expect(observedCtx).toEqual({ tenant: "acme", source: "inner" });
  });
});

describe("registry-level attemptMiddleware — runtime per-slice isolation", () => {
  it("runs each slice's middleware chain only for its own jobs", async () => {
    const sliceACalls: string[] = [];
    const sliceBCalls: string[] = [];

    const wrapA: AttemptMiddleware<InProcessStateAdapter<"async">> = {
      wrapHandler: async ({ jobs, next }) => {
        sliceACalls.push(...jobs.map((job) => job.typeName));
        return next({});
      },
    };
    const wrapB: AttemptMiddleware<InProcessStateAdapter<"async">> = {
      wrapHandler: async ({ jobs, next }) => {
        sliceBCalls.push(...jobs.map((job) => job.typeName));
        return next({});
      },
    };

    type ADefs = { a: { entry: true; input: Record<string, never>; output: null } };
    type BDefs = { b: { entry: true; input: Record<string, never>; output: null } };
    const aReg = defineJobTypes<ADefs>();
    const bReg = defineJobTypes<BDefs>();
    const sa = createInProcessStateAdapter({ mode: "async" });
    const abClient = createClient({
      stateAdapter: sa,
      jobTypes: [aReg, bReg],
    });

    const aProcessors = createProcessors({
      client: abClient,
      jobTypes: aReg,
      attemptMiddleware: [wrapA],
      processors: {
        a: {
          attemptHandler: async ({ applyJobOutcome }) => {
            await sa.withTransaction(async (txCtx) => applyJobOutcome({ ...txCtx, output: null }));
          },
        },
      },
    });
    const bProcessors = createProcessors({
      client: abClient,
      jobTypes: bReg,
      attemptMiddleware: [wrapB],
      processors: {
        b: {
          attemptHandler: async ({ applyJobOutcome }) => {
            await sa.withTransaction(async (txCtx) => applyJobOutcome({ ...txCtx, output: null }));
          },
        },
      },
    });

    await using workerRunner = createWorkerRunner({
      client: abClient,
      processors: [aProcessors, bProcessors],
    });

    const chainA = await sa.withTransaction(async (txCtx) =>
      abClient.createChain({ ...txCtx, typeName: "a", input: {} }),
    );
    const chainB = await sa.withTransaction(async (txCtx) =>
      abClient.createChain({ ...txCtx, typeName: "b", input: {} }),
    );
    await workerRunner.start();
    await abClient.awaitChain({ chain: chainA, timeoutMs: 5000, pollIntervalMs: 100 });
    await abClient.awaitChain({ chain: chainB, timeoutMs: 5000, pollIntervalMs: 100 });
    await workerRunner.close();

    expect(sliceACalls).toEqual(["a"]);
    expect(sliceBCalls).toEqual(["b"]);
  });
});
