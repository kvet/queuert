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

describe("middleware ctx cannot shadow built-in handler/prepare/complete keys", () => {
  it("handler built-ins (signal, job, prepare, complete) win over middleware-injected ctx", async () => {
    const sentinel = { tampered: true };
    const tampering: AttemptMiddleware<InProcessStateAdapter> = {
      wrapHandler: async ({ next }) =>
        next({
          signal: sentinel,
          job: sentinel,
          prepare: sentinel,
          complete: sentinel,
        } as unknown as Record<string, unknown>),
    };

    let observedSignalIsAbortSignal = false;
    let observedJobHasId = false;
    let observedCompleteIsFn = false;

    const registry = createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [tampering],
      processors: {
        foo: {
          attemptHandler: async ({ signal, job, complete }) => {
            observedSignalIsAbortSignal = typeof signal?.aborted === "boolean";
            observedJobHasId = typeof job?.id === "string";
            observedCompleteIsFn = typeof complete === "function";
            return complete(async () => ({ ok: true as const }));
          },
        },
      },
    });

    const worker = await createInProcessWorker({
      client,
      processors: registry,
    });
    const stop = await worker.start();
    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "foo", input: { v: 1 } }),
      ),
    );
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 50 });
    await stop();

    expect(observedSignalIsAbortSignal).toBe(true);
    expect(observedJobHasId).toBe(true);
    expect(observedCompleteIsFn).toBe(true);
  });

  it("prepare callback's txCtx keys win over middleware-injected ctx", async () => {
    // The in-process txCtx is empty, so a middleware-injected key would never
    // collide with a real txCtx field. To exercise the spread-order fix, wrap
    // the adapter so its withTransaction / withSavepoint inject a known marker
    // key into txCtx, and have the middleware inject the same key with a
    // tampered value. The prepare callback must observe the real value.
    const realMarker = { real: true };
    const tamperedMarker = { tampered: true };
    const MARKER_KEY = "__shadowMarker";

    type MarkerTxCtx = Record<typeof MARKER_KEY, typeof realMarker>;
    const baseAdapter = await createInProcessStateAdapter();
    const wrappedAdapter = {
      ...baseAdapter,
      withTransaction: async <T>(cb: (txCtx: MarkerTxCtx) => Promise<T>): Promise<T> =>
        baseAdapter.withTransaction(async (realTxCtx) =>
          cb({ ...(realTxCtx as object), [MARKER_KEY]: realMarker } as MarkerTxCtx),
        ),
      withSavepoint: async <T>(realTxCtx: MarkerTxCtx, cb: (txCtx: MarkerTxCtx) => Promise<T>) =>
        baseAdapter.withSavepoint(realTxCtx as never, async (inner) =>
          cb({ ...(inner as object), [MARKER_KEY]: realMarker } as MarkerTxCtx),
        ),
    } as unknown as typeof baseAdapter;
    const wrappedClient = await createClient({
      stateAdapter: wrappedAdapter,
      jobTypes,
    });

    const tampering: AttemptMiddleware<InProcessStateAdapter> = {
      wrapPrepare: async ({ next }) =>
        next({ [MARKER_KEY]: tamperedMarker } as unknown as Record<string, unknown>),
    };

    let observedMarkerIsReal = false;

    const registry = createProcessors({
      client: wrappedClient,
      jobTypes,
      attemptMiddleware: [tampering],
      processors: {
        foo: {
          attemptHandler: async ({ prepare, complete }) => {
            await prepare({ mode: "atomic" }, async (txCtx) => {
              observedMarkerIsReal = (txCtx as unknown as MarkerTxCtx)[MARKER_KEY] === realMarker;
            });
            return complete(async () => ({ ok: true as const }));
          },
        },
      },
    });

    const worker = await createInProcessWorker({
      client: wrappedClient,
      processors: registry,
    });
    const stop = await worker.start();
    const chain = await withTransactionHooks(async (transactionHooks) =>
      wrappedAdapter.withTransaction(async (txCtx) =>
        wrappedClient.startChain({
          ...(txCtx as unknown as object),
          transactionHooks,
          typeName: "foo",
          input: { v: 1 },
        } as Parameters<typeof wrappedClient.startChain>[0]),
      ),
    );
    await wrappedClient.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 50 });
    await stop();

    expect(observedMarkerIsReal).toBe(true);
  });

  it("complete callback's txCtx keys win over middleware-injected ctx", async () => {
    // Mirror of the prepare test, exercising the spread order at the complete
    // call site (txCtx spread is the last entry in completeCallback options).
    const realMarker = { real: true };
    const tamperedMarker = { tampered: true };
    const MARKER_KEY = "__shadowMarker";

    type MarkerTxCtx = Record<typeof MARKER_KEY, typeof realMarker>;
    const baseAdapter = await createInProcessStateAdapter();
    const wrappedAdapter = {
      ...baseAdapter,
      withTransaction: async <T>(cb: (txCtx: MarkerTxCtx) => Promise<T>): Promise<T> =>
        baseAdapter.withTransaction(async (realTxCtx) =>
          cb({ ...(realTxCtx as object), [MARKER_KEY]: realMarker } as MarkerTxCtx),
        ),
      withSavepoint: async <T>(realTxCtx: MarkerTxCtx, cb: (txCtx: MarkerTxCtx) => Promise<T>) =>
        baseAdapter.withSavepoint(realTxCtx as never, async (inner) =>
          cb({ ...(inner as object), [MARKER_KEY]: realMarker } as MarkerTxCtx),
        ),
    } as unknown as typeof baseAdapter;
    const wrappedClient = await createClient({
      stateAdapter: wrappedAdapter,
      jobTypes,
    });

    const tampering: AttemptMiddleware<InProcessStateAdapter> = {
      wrapComplete: async ({ next }) =>
        next({ [MARKER_KEY]: tamperedMarker } as unknown as Record<string, unknown>),
    };

    let observedMarkerIsReal = false;

    const registry = createProcessors({
      client: wrappedClient,
      jobTypes,
      attemptMiddleware: [tampering],
      processors: {
        foo: {
          attemptHandler: async ({ complete }) =>
            complete(async (opts) => {
              observedMarkerIsReal = (opts as unknown as MarkerTxCtx)[MARKER_KEY] === realMarker;
              return { ok: true as const };
            }),
        },
      },
    });

    const worker = await createInProcessWorker({
      client: wrappedClient,
      processors: registry,
    });
    const stop = await worker.start();
    const chain = await withTransactionHooks(async (transactionHooks) =>
      wrappedAdapter.withTransaction(async (txCtx) =>
        wrappedClient.startChain({
          ...(txCtx as unknown as object),
          transactionHooks,
          typeName: "foo",
          input: { v: 1 },
        } as Parameters<typeof wrappedClient.startChain>[0]),
      ),
    );
    await wrappedClient.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 50 });
    await stop();

    expect(observedMarkerIsReal).toBe(true);
  });

  it("complete built-ins (continueWith, transactionHooks) win over middleware-injected ctx", async () => {
    const sentinel = { tampered: true };
    const tampering: AttemptMiddleware<InProcessStateAdapter> = {
      wrapComplete: async ({ next }) =>
        next({
          continueWith: sentinel,
          transactionHooks: sentinel,
        } as unknown as Record<string, unknown>),
    };

    let observedContinueWithIsFn = false;
    let observedTransactionHooksIsObject = false;

    const registry = createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [tampering],
      processors: {
        foo: {
          attemptHandler: async ({ complete }) =>
            complete(async ({ continueWith, transactionHooks }) => {
              observedContinueWithIsFn = typeof continueWith === "function";
              observedTransactionHooksIsObject =
                transactionHooks !== null && typeof transactionHooks === "object";
              return { ok: true as const };
            }),
        },
      },
    });

    const worker = await createInProcessWorker({
      client,
      processors: registry,
    });
    const stop = await worker.start();
    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.startChain({ ...txCtx, transactionHooks, typeName: "foo", input: { v: 1 } }),
      ),
    );
    await client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 50 });
    await stop();

    expect(observedContinueWithIsFn).toBe(true);
    expect(observedTransactionHooksIsObject).toBe(true);
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

    type ADefs = { a: { entry: true; input: {}; output: null } };
    type BDefs = { b: { entry: true; input: {}; output: null } };
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
        a: { attemptHandler: async ({ complete }) => complete(async () => null) },
      },
    });
    const bProcessors = createProcessors({
      client: abClient,
      jobTypes: bReg,
      attemptMiddleware: [wrapB],
      processors: {
        b: { attemptHandler: async ({ complete }) => complete(async () => null) },
      },
    });

    const worker = await createInProcessWorker({
      client: abClient,
      processors: [aProcessors, bProcessors],
    });
    const stop = await worker.start();

    const chainA = await withTransactionHooks(async (transactionHooks) =>
      sa.withTransaction(async (txCtx) =>
        abClient.startChain({ ...txCtx, transactionHooks, typeName: "a", input: {} }),
      ),
    );
    const chainB = await withTransactionHooks(async (transactionHooks) =>
      sa.withTransaction(async (txCtx) =>
        abClient.startChain({ ...txCtx, transactionHooks, typeName: "b", input: {} }),
      ),
    );
    await abClient.awaitChain(chainA, { timeoutMs: 5000, pollIntervalMs: 100 });
    await abClient.awaitChain(chainB, { timeoutMs: 5000, pollIntervalMs: 100 });
    await stop();

    expect(sliceACalls).toEqual(["a"]);
    expect(sliceBCalls).toEqual(["b"]);
  });
});
