import { describe, expect, it } from "vitest";

import { createClient } from "./client.js";
import { defineJobTypes } from "./entities/define-job-types.js";
import { createInProcessWorker } from "./in-process-worker.js";
import {
  type InProcessStateAdapter,
  createInProcessStateAdapter,
} from "./state-adapter/state-adapter.in-process.js";
import { type StateAdapter } from "./state-adapter/state-adapter.js";
import { type AttemptMiddleware } from "./worker/attempt-middleware.js";
import { createProcessors } from "./worker/create-processors.js";

type Defs = {
  foo: { entry: true; input: null; output: null };
};
type OtherDefs = {
  bar: { entry: true; input: null; output: null };
};

// Realistic middleware definitions: each injects a distinct typed ctx, so the
// values have distinct AttemptMiddleware<...> types — which is what powers the
// compile-time subsequence check. (Two middlewares that inject the same ctx
// shape are still structurally identical at the type level; for those the
// compile-time check passes vacuously and runtime reference identity is the
// source of truth — exercised by the "lookalike" test below.)
const authMiddleware: AttemptMiddleware<InProcessStateAdapter, { userId: string }> = {
  wrapHandler: async ({ next }) => next({ userId: "u-1" }),
};
const traceMiddleware: AttemptMiddleware<InProcessStateAdapter, { traceId: string }> = {
  wrapHandler: async ({ next }) => next({ traceId: "t-1" }),
};
const metricsMiddleware: AttemptMiddleware<
  InProcessStateAdapter,
  { metricsSink: { count: number } }
> = {
  wrapHandler: async ({ next }) => next({ metricsSink: { count: 0 } }),
};

describe("createInProcessWorker requiredAttemptMiddleware", () => {
  it("constructs when the single slice contains required middleware in order", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    const worker = await createInProcessWorker({
      client,
      requiredAttemptMiddleware: [authMiddleware, traceMiddleware],
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [authMiddleware, traceMiddleware],
        processors: {
          foo: {
            attemptHandler: async ({ complete }) => complete(async () => null),
          },
        },
      }),
    });

    const stop = await worker.start();
    await stop();
  });

  it("allows extra middleware around the required entries", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    const worker = await createInProcessWorker({
      client,
      requiredAttemptMiddleware: [authMiddleware, traceMiddleware],
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [metricsMiddleware, authMiddleware, traceMiddleware],
        processors: {
          foo: {
            attemptHandler: async ({ complete }) => complete(async () => null),
          },
        },
      }),
    });

    const stop = await worker.start();
    await stop();
  });

  it("throws when a slice is missing a required middleware instance", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    await expect(
      createInProcessWorker({
        client,
        requiredAttemptMiddleware: [authMiddleware, traceMiddleware],
        // @ts-expect-error — slice is missing traceMiddleware; the compile-time
        // subsequence check substitutes a string error for this slice.
        processors: createProcessors({
          client,
          jobTypes,
          attemptMiddleware: [authMiddleware],
          processors: {
            foo: {
              attemptHandler: async ({ complete }) => complete(async () => null),
            },
          },
        }),
      }),
    ).rejects.toThrow(/missing requiredAttemptMiddleware at position\(s\) \[1\]/);
  });

  it("throws when required middleware appear out of order", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    await expect(
      createInProcessWorker({
        client,
        requiredAttemptMiddleware: [authMiddleware, traceMiddleware],
        // @ts-expect-error — order reversed; with distinct middleware types the
        // subsequence check catches this at compile time too.
        processors: createProcessors({
          client,
          jobTypes,
          attemptMiddleware: [traceMiddleware, authMiddleware],
          processors: {
            foo: {
              attemptHandler: async ({ complete }) => complete(async () => null),
            },
          },
        }),
      }),
    ).rejects.toThrow(/missing requiredAttemptMiddleware/);
  });

  it("identity check uses reference equality at runtime (structural twin still fails)", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    // Two structurally-identical middleware values: same injected ctx shape, so
    // the compile-time check cannot tell them apart and accepts the call. The
    // runtime walk uses `===` and rejects the impostor.
    const required: AttemptMiddleware<InProcessStateAdapter, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "real" }),
    };
    const lookalike: AttemptMiddleware<InProcessStateAdapter, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "impostor" }),
    };

    await expect(
      createInProcessWorker({
        client,
        requiredAttemptMiddleware: [required],
        processors: createProcessors({
          client,
          jobTypes,
          attemptMiddleware: [lookalike],
          processors: {
            foo: {
              attemptHandler: async ({ complete }) => complete(async () => null),
            },
          },
        }),
      }),
    ).rejects.toThrow(/missing requiredAttemptMiddleware/);
  });

  it("aggregates violations across multiple slices in one error", async () => {
    const fooJobTypes = defineJobTypes<Defs>();
    const barJobTypes = defineJobTypes<OtherDefs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({
      stateAdapter,
      jobTypes: [fooJobTypes, barJobTypes],
    });

    const goodSlice = createProcessors({
      client,
      jobTypes: fooJobTypes,
      attemptMiddleware: [authMiddleware],
      processors: {
        foo: {
          attemptHandler: async ({ complete }) => complete(async () => null),
        },
      },
    });

    const badSlice = createProcessors({
      client,
      jobTypes: barJobTypes,
      processors: {
        bar: {
          attemptHandler: async ({ complete }) => complete(async () => null),
        },
      },
    });

    await expect(
      createInProcessWorker({
        client,
        requiredAttemptMiddleware: [authMiddleware],
        // @ts-expect-error — second slice is missing authMiddleware
        processors: [goodSlice, badSlice],
      }),
    ).rejects.toThrow(/"bar": missing requiredAttemptMiddleware at position\(s\) \[0\]/);
  });

  it("accepts a slice typed against a user-supplied StateAdapter alias", async () => {
    type MyStateAdapter = StateAdapter<{ db: string }, `job.${string}`>;
    const mw: AttemptMiddleware<MyStateAdapter> = {
      wrapHandler: async ({ next }) => next({}),
    };

    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    const worker = await createInProcessWorker({
      client,
      requiredAttemptMiddleware: [mw],
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [mw],
        processors: {
          foo: { attemptHandler: async ({ complete }) => complete(async () => null) },
        },
      }),
    });

    const stop = await worker.start();
    await stop();
  });

  it("still rejects a mismatched slice when required mw is typed against a StateAdapter alias", async () => {
    type MyStateAdapter = StateAdapter<{ db: string }, `job.${string}`>;
    const required: AttemptMiddleware<MyStateAdapter, { userId: string }> = {
      wrapHandler: async ({ next }) => next({ userId: "u-1" }),
    };
    const other: AttemptMiddleware<MyStateAdapter, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "t-1" }),
    };

    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    await expect(
      createInProcessWorker({
        client,
        requiredAttemptMiddleware: [required],
        // @ts-expect-error — slice has a distinct middleware shape; the
        // subsequence check must still flag this even though both are typed
        // against the same user-supplied StateAdapter alias.
        processors: createProcessors({
          client,
          jobTypes,
          attemptMiddleware: [other],
          processors: {
            foo: { attemptHandler: async ({ complete }) => complete(async () => null) },
          },
        }),
      }),
    ).rejects.toThrow(/missing requiredAttemptMiddleware/);
  });

  it("is a no-op when requiredAttemptMiddleware is omitted", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes });

    const worker = await createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            attemptHandler: async ({ complete }) => complete(async () => null),
          },
        },
      }),
    });

    const stop = await worker.start();
    await stop();
  });
});
