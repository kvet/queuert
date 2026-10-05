import { describe, expect, it } from "vitest";

import { createClient } from "./client.js";
import { defineJobTypes } from "./entities/define-job-types.js";
import { createInProcessWorker } from "./in-process-worker.js";
import {
  createInProcessStateAdapter,
  type InProcessStateAdapter,
} from "./state-adapter/state-adapter.in-process.js";
import { withTransactionHooks } from "./transaction-hooks.js";
import { type AttemptMiddleware } from "./worker/attempt-middleware.js";
import { createProcessors } from "./worker/create-processors.js";

type Defs = {
  foo: { entry: true; input: { v: number }; output: { ok: true } };
};
const jobTypes = defineJobTypes<Defs>();

const stateAdapter = await createInProcessStateAdapter();
const client = await createClient({ stateAdapter, jobTypes });

describe("middleware ctx cannot shadow built-in handler keys", () => {
  it("handler built-ins (signal, job, finish, getBlockers) win over middleware-injected ctx", async () => {
    const sentinel = { tampered: true };
    const tampering: AttemptMiddleware<InProcessStateAdapter> = {
      wrapHandler: async ({ next }) =>
        next({
          signal: sentinel,
          job: sentinel,
          finish: sentinel,
          getBlockers: sentinel,
        }),
    };

    let observedSignalIsAbortSignal = false;
    let observedJobHasId = false;
    let observedFinishIsFn = false;
    let observedGetBlockersIsSentinel = true;

    const registry = createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [tampering],
      processors: {
        foo: {
          attemptHandler: async (options) => {
            const { signal, job, finish } = options;
            observedSignalIsAbortSignal = typeof signal?.aborted === "boolean";
            observedJobHasId = typeof job?.id === "string";
            observedFinishIsFn = typeof finish === "function";
            observedGetBlockersIsSentinel =
              (options as unknown as { getBlockers: unknown }).getBlockers === sentinel;
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: { ok: true as const } }),
              ),
            );
          },
        },
      },
    });

    const worker = await createInProcessWorker({
      client,
      processors: registry,
    });
    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "foo", input: { v: 1 } }),
      ),
    );
    const stop = await worker.start();
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 50 });
    await stop();

    expect(observedSignalIsAbortSignal).toBe(true);
    expect(observedJobHasId).toBe(true);
    expect(observedFinishIsFn).toBe(true);
    expect(observedGetBlockersIsSentinel).toBe(false);
  });
});

describe("middleware ctx flows into the handler through wrapHandler", () => {
  it("merges ctx across middleware, runs them as an onion and passes the finish result back out", async () => {
    const events: string[] = [];
    let outerResult: unknown;

    const outer: AttemptMiddleware<InProcessStateAdapter, { tenant: string; source: string }> = {
      wrapHandler: async ({ next }) => {
        events.push("outer:before");
        const result = await next({ tenant: "acme", source: "outer" });
        outerResult = result;
        events.push("outer:after");
        return result;
      },
    };
    const inner: AttemptMiddleware<InProcessStateAdapter, { source: string }> = {
      wrapHandler: async ({ job, next }) => {
        events.push(`inner:before:${job.typeName}`);
        const result = await next({ source: "inner" });
        events.push("inner:after");
        return result;
      },
    };

    let observedCtx: { tenant: string; source: string } | undefined;

    const registry = createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [outer, inner],
      processors: {
        foo: {
          attemptHandler: async ({ tenant, source, finish }) => {
            events.push("handler");
            observedCtx = { tenant, source };
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: { ok: true as const } }),
              ),
            );
          },
        },
      },
    });

    const worker = await createInProcessWorker({
      client,
      processors: registry,
    });
    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "foo", input: { v: 1 } }),
      ),
    );
    const stop = await worker.start();
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 50 });
    await stop();

    expect(events).toEqual([
      "outer:before",
      "inner:before:foo",
      "handler",
      "inner:after",
      "outer:after",
    ]);
    expect(observedCtx).toEqual({ tenant: "acme", source: "inner" });
    expect(outerResult).toMatchObject({
      id: chain.id,
      status: "completed",
      output: { ok: true },
    });
  });
});

describe("registry-level attemptMiddleware — runtime per-slice isolation", () => {
  it("runs each slice's middleware chain only for its own jobs", async () => {
    const sliceACalls: string[] = [];
    const sliceBCalls: string[] = [];

    const wrapA: AttemptMiddleware<InProcessStateAdapter> = {
      wrapHandler: async ({ job, next }) => {
        sliceACalls.push(job.typeName);
        return next({});
      },
    };
    const wrapB: AttemptMiddleware<InProcessStateAdapter> = {
      wrapHandler: async ({ job, next }) => {
        sliceBCalls.push(job.typeName);
        return next({});
      },
    };

    type ADefs = { a: { entry: true; input: Record<string, never>; output: null } };
    type BDefs = { b: { entry: true; input: Record<string, never>; output: null } };
    const aReg = defineJobTypes<ADefs>();
    const bReg = defineJobTypes<BDefs>();
    const sa = await createInProcessStateAdapter();
    const abClient = await createClient({
      stateAdapter: sa,
      jobTypes: [aReg, bReg],
    });

    const aProcessors = createProcessors({
      client: abClient,
      jobTypes: aReg,
      attemptMiddleware: [wrapA],
      processors: {
        a: {
          attemptHandler: async ({ finish }) =>
            withTransactionHooks(async (transactionHooks) =>
              sa.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              ),
            ),
        },
      },
    });
    const bProcessors = createProcessors({
      client: abClient,
      jobTypes: bReg,
      attemptMiddleware: [wrapB],
      processors: {
        b: {
          attemptHandler: async ({ finish }) =>
            withTransactionHooks(async (transactionHooks) =>
              sa.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: null }),
              ),
            ),
        },
      },
    });

    const worker = await createInProcessWorker({
      client: abClient,
      processors: [aProcessors, bProcessors],
    });

    const chainA = await withTransactionHooks(async (transactionHooks) =>
      sa.withTransaction(async (txCtx) =>
        abClient.createChain({ ...txCtx, transactionHooks, typeName: "a", input: {} }),
      ),
    );
    const chainB = await withTransactionHooks(async (transactionHooks) =>
      sa.withTransaction(async (txCtx) =>
        abClient.createChain({ ...txCtx, transactionHooks, typeName: "b", input: {} }),
      ),
    );
    const stop = await worker.start();
    await abClient.awaitChain(chainA, { timeoutMs: 5000, pollIntervalMs: 100 });
    await abClient.awaitChain(chainB, { timeoutMs: 5000, pollIntervalMs: 100 });
    await stop();

    expect(sliceACalls).toEqual(["a"]);
    expect(sliceBCalls).toEqual(["b"]);
  });
});
