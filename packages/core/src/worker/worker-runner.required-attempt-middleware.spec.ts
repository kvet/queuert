import { describe, expect, it } from "vitest";

import type { AttemptMiddleware } from "../attempt-middleware/attempt-middleware.ts";
import { createClient } from "../client/client.ts";
import { createProcessors } from "../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import {
  type InProcessStateAdapter,
  createInProcessStateAdapter,
} from "../state-adapter.in-process/state-adapter.in-process.ts";
import { createWorkerRunner } from "./worker-runner.ts";

type Defs = {
  foo: { entry: true; input: null; output: null };
};
type OtherDefs = {
  bar: { entry: true; input: null; output: null };
};

const authMiddleware: AttemptMiddleware<InProcessStateAdapter<"async">, { userId: string }> = {
  wrapHandler: async ({ next }) => next({ userId: "u-1" }),
};
const traceMiddleware: AttemptMiddleware<InProcessStateAdapter<"async">, { traceId: string }> = {
  wrapHandler: async ({ next }) => next({ traceId: "t-1" }),
};
const metricsMiddleware: AttemptMiddleware<
  InProcessStateAdapter<"async">,
  { metricsSink: { count: number } }
> = {
  wrapHandler: async ({ next }) => next({ metricsSink: { count: 0 } }),
};

describe("createWorkerRunner requiredAttemptMiddleware", () => {
  it("constructs when the single slice contains required middleware in order", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const client = createClient({ stateAdapter, jobTypes });

    await using workerRunner = createWorkerRunner({
      client,
      requiredAttemptMiddleware: [authMiddleware, traceMiddleware],
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [authMiddleware, traceMiddleware],
        processors: {
          foo: {
            attemptHandler: async ({ applyJobOutcome }) => {
              await stateAdapter.withTransaction(async (txCtx) =>
                applyJobOutcome({ ...txCtx, output: null }),
              );
            },
          },
        },
      }),
    });

    await workerRunner.start();
  });

  it("allows extra middleware around the required entries", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const client = createClient({ stateAdapter, jobTypes });

    await using workerRunner = createWorkerRunner({
      client,
      requiredAttemptMiddleware: [authMiddleware, traceMiddleware],
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [metricsMiddleware, authMiddleware, traceMiddleware],
        processors: {
          foo: {
            attemptHandler: async ({ applyJobOutcome }) => {
              await stateAdapter.withTransaction(async (txCtx) =>
                applyJobOutcome({ ...txCtx, output: null }),
              );
            },
          },
        },
      }),
    });

    await workerRunner.start();
  });

  it("throws when a slice is missing a required middleware instance", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const client = createClient({ stateAdapter, jobTypes });

    expect(() => {
      createWorkerRunner({
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
              attemptHandler: async ({ applyJobOutcome }) => {
                await stateAdapter.withTransaction(async (txCtx) =>
                  applyJobOutcome({ ...txCtx, output: null }),
                );
              },
            },
          },
        }),
      });
    }).toThrow(/missing requiredAttemptMiddleware at position\(s\) \[1\]/);
  });

  it("throws when required middleware appear out of order", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const client = createClient({ stateAdapter, jobTypes });

    expect(() => {
      createWorkerRunner({
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
              attemptHandler: async ({ applyJobOutcome }) => {
                await stateAdapter.withTransaction(async (txCtx) =>
                  applyJobOutcome({ ...txCtx, output: null }),
                );
              },
            },
          },
        }),
      });
    }).toThrow(/missing requiredAttemptMiddleware/);
  });

  it("identity check uses reference equality at runtime (structural twin still fails)", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const client = createClient({ stateAdapter, jobTypes });

    const required: AttemptMiddleware<InProcessStateAdapter<"async">, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "real" }),
    };
    const lookalike: AttemptMiddleware<InProcessStateAdapter<"async">, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "impostor" }),
    };

    expect(() => {
      createWorkerRunner({
        client,
        requiredAttemptMiddleware: [required],
        processors: createProcessors({
          client,
          jobTypes,
          attemptMiddleware: [lookalike],
          processors: {
            foo: {
              attemptHandler: async ({ applyJobOutcome }) => {
                await stateAdapter.withTransaction(async (txCtx) =>
                  applyJobOutcome({ ...txCtx, output: null }),
                );
              },
            },
          },
        }),
      });
    }).toThrow(/missing requiredAttemptMiddleware/);
  });

  it("aggregates violations across multiple slices in one error", async () => {
    const fooJobTypes = defineJobTypes<Defs>();
    const barJobTypes = defineJobTypes<OtherDefs>();
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const client = createClient({
      stateAdapter,
      jobTypes: [fooJobTypes, barJobTypes],
    });

    const goodSlice = createProcessors({
      client,
      jobTypes: fooJobTypes,
      attemptMiddleware: [authMiddleware],
      processors: {
        foo: {
          attemptHandler: async ({ applyJobOutcome }) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcome({ ...txCtx, output: null }),
            );
          },
        },
      },
    });

    const badSlice = createProcessors({
      client,
      jobTypes: barJobTypes,
      processors: {
        bar: {
          attemptHandler: async ({ applyJobOutcome }) => {
            await stateAdapter.withTransaction(async (txCtx) =>
              applyJobOutcome({ ...txCtx, output: null }),
            );
          },
        },
      },
    });

    expect(() => {
      createWorkerRunner({
        client,
        requiredAttemptMiddleware: [authMiddleware],
        // @ts-expect-error — second slice is missing authMiddleware
        processors: [goodSlice, badSlice],
      });
    }).toThrow(/"bar": missing requiredAttemptMiddleware at position\(s\) \[0\]/);
  });

  it("accepts a slice typed against a user-supplied StateAdapter alias", async () => {
    const mw: AttemptMiddleware<InProcessStateAdapter<"async">> = {
      wrapHandler: async ({ next }) => next({}),
    };

    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const client = createClient({ stateAdapter, jobTypes });

    await using workerRunner = createWorkerRunner({
      client,
      requiredAttemptMiddleware: [mw],
      processors: createProcessors({
        client,
        jobTypes,
        attemptMiddleware: [mw],
        processors: {
          foo: {
            attemptHandler: async ({ applyJobOutcome }) => {
              await stateAdapter.withTransaction(async (txCtx) =>
                applyJobOutcome({ ...txCtx, output: null }),
              );
            },
          },
        },
      }),
    });

    await workerRunner.start();
  });

  it("still rejects a mismatched slice when required mw is typed against a StateAdapter alias", async () => {
    const required: AttemptMiddleware<InProcessStateAdapter<"async">, { userId: string }> = {
      wrapHandler: async ({ next }) => next({ userId: "u-1" }),
    };
    const other: AttemptMiddleware<InProcessStateAdapter<"async">, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "t-1" }),
    };

    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const client = createClient({ stateAdapter, jobTypes });

    expect(() => {
      createWorkerRunner({
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
            foo: {
              attemptHandler: async ({ applyJobOutcome }) => {
                await stateAdapter.withTransaction(async (txCtx) =>
                  applyJobOutcome({ ...txCtx, output: null }),
                );
              },
            },
          },
        }),
      });
    }).toThrow(/missing requiredAttemptMiddleware/);
  });

  it("is a no-op when requiredAttemptMiddleware is omitted", async () => {
    const jobTypes = defineJobTypes<Defs>();
    const stateAdapter = createInProcessStateAdapter({ mode: "async" });
    const client = createClient({ stateAdapter, jobTypes });

    await using workerRunner = createWorkerRunner({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          foo: {
            attemptHandler: async ({ applyJobOutcome }) => {
              await stateAdapter.withTransaction(async (txCtx) =>
                applyJobOutcome({ ...txCtx, output: null }),
              );
            },
          },
        },
      }),
    });

    await workerRunner.start();
  });
});
