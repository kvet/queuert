import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createClient, createInProcessWorker, defineJobTypes } from "../index.js";
import { createSpyStateAdapter } from "../state-adapter/state-adapter.spy.spec-helper.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processModesTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("completes job atomically without prepare", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypes<{
      "atomic-complete": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        "atomic-complete": {
          attemptHandler: async ({ job, complete }) => {
            return complete(async ({ continueWith: _, ...txContext }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txContext });
              return { result: job.input.value * 2 };
            });
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "atomic-complete",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }), // TODO: why isn't it the part of acquireJob?
          expect.objectContaining({ name: "renewJobLease" }), // TODO: why do we need to renew the lease?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "scheduleBlockedJobs" }), // TODO: shouldn't it be the part of completeJob?
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job in staged mode without prepare", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypes<{
      "staged-complete": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        "staged-complete": {
          attemptHandler: async ({ job, complete }) => {
            await sleep(1);
            return complete(async ({ continueWith: _, ...txContext }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txContext });
              return { result: job.input.value * 3 };
            });
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "staged-complete",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 30 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }), // TODO: why isn't it the part of acquireJob?
          expect.objectContaining({ name: "renewJobLease" }), // TODO: why do we need to renew the lease?
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
      expect.objectContaining({
        name: "runInTransaction",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }), // TODO: why do we need it?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "scheduleBlockedJobs" }), // TODO: shouldn't it be the part of completeJob?
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job with staged prepare and callback", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypes<{
      "staged-with-callback": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        "staged-with-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            const multiplier = await prepare({ mode: "staged" }, async (txContext) => {
              await spyStateAdapter.record({ name: "user-preparation", ...txContext });
              return 4;
            });
            return complete(async ({ continueWith: _, ...txContext }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txContext });
              return { result: job.input.value * multiplier };
            });
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "staged-with-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 40 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }), // TODO: why isn't it the part of acquireJob?
          expect.objectContaining({ name: "renewJobLease" }), // TODO: why do we need to renew the lease?
          expect.objectContaining({ name: "user-preparation" }),
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
      expect.objectContaining({
        name: "runInTransaction",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }), // TODO: why do we need it?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "scheduleBlockedJobs" }), // TODO: shouldn't it be the part of completeJob?
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job with staged prepare without callback", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypes<{
      "staged-without-callback": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        "staged-without-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "staged" });
            return complete(async ({ continueWith: _, ...txContext }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txContext });
              return { result: job.input.value * 5 };
            });
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "staged-without-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 50 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }), // TODO: why isn't it the part of acquireJob?
          expect.objectContaining({ name: "renewJobLease" }), // TODO: why do we need to renew the lease?
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
      expect.objectContaining({
        name: "runInTransaction",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }), // TODO: why do we need it?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "scheduleBlockedJobs" }), // TODO: shouldn't it be the part of completeJob?
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job with atomic prepare and callback", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypes<{
      "atomic-with-callback": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        "atomic-with-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            const multiplier = await prepare({ mode: "atomic" }, async (txContext) => {
              await spyStateAdapter.record({ name: "user-preparation", ...txContext });
              return 6;
            });
            return complete(async ({ continueWith: _, ...txContext }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txContext });
              return { result: job.input.value * multiplier };
            });
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "atomic-with-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 60 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }), // TODO: why isn't it the part of acquireJob?
          expect.objectContaining({ name: "renewJobLease" }), // TODO: why do we need to renew the lease?
          expect.objectContaining({ name: "user-preparation" }),
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "scheduleBlockedJobs" }), // TODO: shouldn't it be the part of completeJob?
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job with atomic prepare without callback", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const registry = defineJobTypes<{
      "atomic-without-callback": {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
      concurrency: 1,
      processors: {
        "atomic-without-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "atomic" });
            return complete(async ({ continueWith: _, ...txContext }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txContext });
              return { result: job.input.value * 7 };
            });
          },
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "atomic-without-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 70 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }), // TODO: why isn't it the part of acquireJob?
          expect.objectContaining({ name: "renewJobLease" }), // TODO: why do we need to renew the lease?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "scheduleBlockedJobs" }), // TODO: shouldn't it be the part of completeJob?
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });
};
