import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createQueuertClient, createQueuertInProcessWorker, defineJobTypes } from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const notifyTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("schedules processing immediately", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        test: {
          process: async ({ job, complete }) => {
            await sleep(50);
            return complete(async () => ({ result: job.input.value }));
          },
        },
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
            typeName: "test",
            input: { value: 1 },
          }),
        ),
      );

      const signal = AbortSignal.timeout(200);
      await client.waitForJobChainCompletion(jobChain, { timeoutMs: 200 });
      if (signal.aborted) {
        expect.fail("Timed out waiting for job chain completion");
      }
    });
  });

  it("distributes processing to multiple workers", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const createWorker = async () =>
      createQueuertInProcessWorker({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
        jobTypeProcessors: {
          test: {
            process: async ({ job, complete }) => {
              await sleep(50);
              return complete(async () => ({ result: job.input.value }));
            },
          },
        },
      });

    await withWorkers(
      await Promise.all(Array.from({ length: 5 }, async () => (await createWorker()).start())),
      async () => {
        const jobChains = await client.withNotify(async () =>
          runInTransaction(async (txContext) =>
            Promise.all(
              Array.from({ length: 5 }, async (_, i) =>
                client.startJobChain({
                  ...txContext,
                  typeName: "test",
                  input: { value: i },
                }),
              ),
            ),
          ),
        );

        const signal = AbortSignal.timeout(200);
        await Promise.all(
          jobChains.map(async (chain) =>
            client.waitForJobChainCompletion(chain, { timeoutMs: 200 }),
          ),
        );
        if (signal.aborted) {
          expect.fail("Timed out waiting for job chain completions");
        }
      },
    );
  });

  it("handles distributed blocker jobs", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      blocker: {
        entry: true;
        input: null;
        output: { allowed: boolean };
      };
      main: {
        entry: true;
        input: null;
        output: { done: true };
        blockers: [{ typeName: "blocker" }];
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const worker1 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        blocker: {
          process: async ({ complete }) => {
            await sleep(25);
            return complete(async () => ({ allowed: true }));
          },
        },
      },
    });
    const worker2 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        main: {
          process: async ({ complete }) => {
            await sleep(25);
            return complete(async () => ({ done: true }));
          },
        },
      },
    });

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const jobChain = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
            typeName: "main",
            input: null,
            startBlockers: async () => [
              await client.startJobChain({
                ...txContext,
                typeName: "blocker",
                input: null,
              }),
            ],
          }),
        ),
      );

      const signal = AbortSignal.timeout(100);
      await client.waitForJobChainCompletion(jobChain, {
        signal,
        timeoutMs: 200,
      });
      if (signal.aborted) {
        expect.fail("Timed out waiting for job chain completion");
      }
    });
  });

  it("handles distributed chain jobs", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      step1: {
        entry: true;
        input: null;
        continueWith: { typeName: "step2" };
      };
      step2: {
        input: null;
        output: { finished: true };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });
    const worker1 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        step1: {
          process: async ({ complete }) => {
            await sleep(25);
            return complete(async ({ continueWith }) =>
              continueWith({
                typeName: "step2",
                input: null,
              }),
            );
          },
        },
      },
    });
    const worker2 = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        step2: {
          process: async ({ complete }) => {
            await sleep(25);
            return complete(async () => ({ finished: true }));
          },
        },
      },
    });

    await withWorkers([await worker1.start(), await worker2.start()], async () => {
      const jobChain = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
            typeName: "step1",
            input: null,
          }),
        ),
      );

      const signal = AbortSignal.timeout(100);
      await client.waitForJobChainCompletion(jobChain, { timeoutMs: 200 });
      if (signal.aborted) {
        expect.fail("Timed out waiting for job chain completion");
      }
    });
  });

  // check that notify signals are sent when jobs are completed externally to workers
  // like there are 2 distributed workers with dedicated job handlers and first job is completed outside

  it("notifies workers about workerless completed jobs", async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();

    const worker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
      workerId: "worker",
      jobTypeProcessors: {
        test: {
          process: async ({ signal, prepare }) => {
            await prepare({ mode: "staged" });
            jobStarted.resolve();

            await sleep(1000, { signal });
            expect(signal.aborted).toBe(true);
            expect(signal.reason).toBe("already_completed");
            jobCompleted.resolve();

            throw new Error();
          },
        },
      },
    });

    await withWorkers([await worker.start()], async () => {
      const jobChain = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
            typeName: "test",
            input: null,
          }),
        ),
      );

      await jobStarted.promise;

      await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.completeJobChain({
            ...txContext,
            typeName: "test",
            id: jobChain.id,
            complete: async ({ job, complete }) => {
              return complete(job, async () => ({ result: "from-external" }));
            },
          }),
        ),
      );

      await jobCompleted.promise;
    });
  });

  it('notifies workers when reaper deletes "zombie" jobs', async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    withWorkers,
    runInTransaction,
    expect,
  }) => {
    const jobTypeRegistry = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: { result: string };
      };
    }>();

    const client = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypeRegistry,
    });

    const jobStarted = Promise.withResolvers<void>();
    const jobCompleted = Promise.withResolvers<void>();

    const createWorker = async () =>
      createQueuertInProcessWorker({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypeRegistry,
        jobTypeProcessors: {
          test: {
            process: async ({ signal, job, prepare, complete }) => {
              await prepare({ mode: "staged" });

              if (job.attempt > 1) {
                await jobCompleted.promise;
                await sleep(10);

                return complete(async () => ({ result: "recovered" }));
              }

              jobStarted.resolve();

              await sleep(1000, { signal });
              expect(signal.aborted).toBe(true);
              expect(signal.reason).toBe("taken_by_another_worker");
              jobCompleted.resolve();

              throw new Error();
            },
            leaseConfig: { leaseMs: 1, renewIntervalMs: 1000 },
          },
        },
      });

    await withWorkers([await (await createWorker()).start()], async () => {
      const jobChain = await client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
            typeName: "test",
            input: null,
          }),
        ),
      );

      await jobStarted.promise;
      await sleep(10);

      await withWorkers([await (await createWorker()).start()], async () => {
        await client.waitForJobChainCompletion(jobChain, { timeoutMs: 5000 });
      });

      await jobCompleted.promise;
    });
  });
};
