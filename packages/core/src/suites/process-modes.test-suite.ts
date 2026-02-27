import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import {
  createClient,
  createInProcessWorker,
  defineJobTypes,
  withTransactionHooks,
} from "../index.js";
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: {
        "atomic-complete": {
          attemptHandler: async ({ job, complete }) => {
            return complete(async ({ continueWith: _, ...txCtx }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txCtx });
              return { result: job.input.value * 2 };
            });
          },
        },
      },
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "atomic-complete",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }), // TODO: why isn't it the part of acquireJob?
          expect.objectContaining({ name: "renewJobLease" }), // TODO: why do we need to renew the lease?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "unblockJobs" }), // TODO: shouldn't it be the part of completeJob?
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: {
        "staged-complete": {
          attemptHandler: async ({ job, complete }) => {
            await sleep(1);
            return complete(async ({ continueWith: _, ...txCtx }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txCtx });
              return { result: job.input.value * 3 };
            });
          },
        },
      },
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "staged-complete",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 30 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
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
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }), // TODO: why do we need it?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "unblockJobs" }), // TODO: shouldn't it be the part of completeJob?
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: {
        "staged-with-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            const multiplier = await prepare({ mode: "staged" }, async (txCtx) => {
              await spyStateAdapter.record({ name: "user-preparation", ...txCtx });
              return 4;
            });
            return complete(async ({ continueWith: _, ...txCtx }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txCtx });
              return { result: job.input.value * multiplier };
            });
          },
        },
      },
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "staged-with-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 40 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
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
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }), // TODO: why do we need it?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "unblockJobs" }), // TODO: shouldn't it be the part of completeJob?
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: {
        "staged-without-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "staged" });
            return complete(async ({ continueWith: _, ...txCtx }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txCtx });
              return { result: job.input.value * 5 };
            });
          },
        },
      },
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "staged-without-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 50 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
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
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobForUpdate" }), // TODO: why do we need it?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "unblockJobs" }), // TODO: shouldn't it be the part of completeJob?
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: {
        "atomic-with-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            const multiplier = await prepare({ mode: "atomic" }, async (txCtx) => {
              await spyStateAdapter.record({ name: "user-preparation", ...txCtx });
              return 6;
            });
            return complete(async ({ continueWith: _, ...txCtx }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txCtx });
              return { result: job.input.value * multiplier };
            });
          },
        },
      },
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "atomic-with-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 60 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }), // TODO: why isn't it the part of acquireJob?
          expect.objectContaining({ name: "renewJobLease" }), // TODO: why do we need to renew the lease?
          expect.objectContaining({ name: "user-preparation" }),
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "unblockJobs" }), // TODO: shouldn't it be the part of completeJob?
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
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: {
        "atomic-without-callback": {
          attemptHandler: async ({ job, prepare, complete }) => {
            await prepare({ mode: "atomic" });
            return complete(async ({ continueWith: _, ...txCtx }) => {
              await spyStateAdapter.record({ name: "user-completion", ...txCtx });
              return { result: job.input.value * 7 };
            });
          },
        },
      },
    });

    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      runInTransaction(async (txCtx) =>
        client.startJobChain({
          ...txCtx,
          transactionHooks,
          typeName: "atomic-without-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitJobChain(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 70 });
    });

    const expected = [
      expect.objectContaining({
        name: "runInTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }), // TODO: why isn't it the part of acquireJob?
          expect.objectContaining({ name: "renewJobLease" }), // TODO: why do we need to renew the lease?
          expect.objectContaining({ name: "user-completion" }),
          expect.objectContaining({ name: "completeJob" }),
          expect.objectContaining({ name: "getJobById" }), // TODO: why do we need it?
          expect.objectContaining({ name: "unblockJobs" }), // TODO: shouldn't it be the part of completeJob?
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });
};
