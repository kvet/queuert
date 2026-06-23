import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createSpyStateAdapter } from "../state-adapter/state-adapter.spy.spec-helper.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const processModesTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  it("completes job atomically without prepare", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
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
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "atomic-complete",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job in staged mode without prepare", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
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
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "staged-complete",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 30 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job with staged prepare and callback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
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
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "staged-with-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 40 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [expect.objectContaining({ name: "user-preparation" })],
          }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job with staged prepare without callback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
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
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "staged-without-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 50 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job with atomic prepare and callback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
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
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "atomic-with-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 60 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [expect.objectContaining({ name: "user-preparation" })],
          }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("completes job with atomic prepare without callback", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
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
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
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
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "atomic-without-callback",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 70 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("execute runs callback in a committed transaction with valid txCtx and transactionHooks", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
      "execute-basic": {
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
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "execute-basic": {
            attemptHandler: async ({ job, prepare, execute, complete }) => {
              await prepare({ mode: "staged" });

              await execute(async ({ transactionHooks: _, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-execute", ...txCtx });
              });

              return complete(async ({ continueWith: _, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...txCtx });
                return { result: job.input.value * 2 };
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "execute-basic",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 20 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({ name: "user-execute" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("execute return value is forwarded to the caller", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      "execute-return": {
        entry: true;
        input: null;
        output: { sum: number };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "execute-return": {
            attemptHandler: async ({ prepare, execute, complete }) => {
              await prepare({ mode: "staged" });

              const a = await execute(async () => 10);
              const b = await execute(async () => 20);

              return complete(async () => ({ sum: a + b }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "execute-return",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ sum: 30 });
    });
  });

  it("multiple sequential execute calls each get independent transactions", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
      "execute-multi": {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "execute-multi": {
            attemptHandler: async ({ prepare, execute, complete }) => {
              await prepare({ mode: "staged" });

              await execute(async (txCtx) => {
                await spyStateAdapter.record({ name: "execute-1", ...txCtx });
              });
              await execute(async (txCtx) => {
                await spyStateAdapter.record({ name: "execute-2", ...txCtx });
              });

              return complete(async () => null);
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "execute-multi",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      await client.awaitChain(chain, completionOptions);
    });

    const executeTxns = spyStateAdapter.calls.filter(
      (c: { name: string; children?: { name: string }[] }) =>
        c.name === "withTransaction" &&
        c.children?.some(
          (child: { name: string }) => child.name === "execute-1" || child.name === "execute-2",
        ),
    );
    expect(executeTxns).toHaveLength(2);
  });

  it("hooks flush after each execute call", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const jobTypes = defineJobTypes<{
      "execute-hooks": {
        entry: true;
        input: null;
        output: { flushOrder: number[] };
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const flushOrder: number[] = [];

    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "execute-hooks": {
            attemptHandler: async ({ prepare, execute, complete }) => {
              await prepare({ mode: "staged" });

              await execute(async ({ transactionHooks }) => {
                transactionHooks.getOrInsert(Symbol(), () => ({
                  state: {},
                  flush: () => {
                    flushOrder.push(1);
                  },
                }));
              });

              expect(flushOrder).toEqual([1]);

              await execute(async ({ transactionHooks }) => {
                transactionHooks.getOrInsert(Symbol(), () => ({
                  state: {},
                  flush: () => {
                    flushOrder.push(2);
                  },
                }));
              });

              expect(flushOrder).toEqual([1, 2]);

              return complete(async () => ({ flushOrder }));
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "execute-hooks",
          input: null,
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ flushOrder: [1, 2] });
    });
  });

  it("execute and complete in staged mode without prepare", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
      "execute-race": {
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
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "execute-race": {
            attemptHandler: async ({ job, execute, complete }) => {
              await sleep(1);

              await execute(async ({ transactionHooks: _, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-execute", ...txCtx });
              });

              return complete(async ({ continueWith: _, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...txCtx });
                return { result: job.input.value * 3 };
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "execute-race",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 30 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({ name: "user-execute" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("execute works without explicit prepare via auto-setup", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
      "execute-auto": {
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
      jobTypes,
    });
    const workerClient = await createClient({
      stateAdapter: spyStateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });
    const worker = await createInProcessWorker({
      client: workerClient,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          "execute-auto": {
            attemptHandler: async ({ job, execute, complete }) => {
              const intermediate = await execute(async ({ ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-execute", ...txCtx });
                return job.input.value * 3;
              });

              return complete(async ({ continueWith: _, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...txCtx });
                return { result: intermediate };
              });
            },
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "execute-auto",
          input: { value: 10 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 30 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "acquireJob" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({ name: "renewJobLease" }),
        ],
      }),
      expect.objectContaining({
        name: "getNextJobAvailableInMs",
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({ name: "user-execute" }),
        ],
      }),
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "getJobs", args: { lock: "exclusive" } }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJob" }),
              expect.objectContaining({ name: "getJobs" }),
              expect.objectContaining({ name: "unblockJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });
};
