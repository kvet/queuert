import { sleep } from "@queuert/helpers";
import { type TestAPI, expect } from "vitest";

import { createClient } from "../client.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
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
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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
              return complete(async ({ finish, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...txCtx });
                return finish({ output: { result: job.input.value * 2 } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "atomic-complete",
        input: { value: 10 },
      }),
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
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });

  it("fetches blockers in the start transaction when they were complete at creation", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const spyStateAdapter = createSpyStateAdapter(stateAdapter);

    const jobTypes = defineJobTypes<{
      "completed-blocker": { entry: true; input: null; output: { value: number } };
      "blocked-main": {
        entry: true;
        input: null;
        output: { value: number };
        blockers: [{ typeName: "completed-blocker" }];
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
          "blocked-main": {
            attemptHandler: async ({ job, complete }) =>
              complete(async ({ finish }) =>
                finish({ output: { value: job.blockers[0].output.value + 1 } }),
              ),
          },
        },
      }),
    });

    const blockerChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "completed-blocker",
        input: null,
      }),
    );
    await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...blockerChain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ finish }) => finish({ output: { value: 1 } })),
      }),
    );
    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "blocked-main",
        input: null,
        blockers: [blockerChain],
      }),
    );
    expect((await client.getJob({ id: chain.id }))!.status).toBe("pending");

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ value: 2 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({ name: "getJobBlockers" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [expect.objectContaining({ name: "completeJobs" })],
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
              return complete(async ({ finish, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...txCtx });
                return finish({ output: { result: job.input.value * 3 } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "staged-complete",
        input: { value: 10 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 30 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [expect.objectContaining({ name: "startJobAttempt" })],
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
              expect.objectContaining({ name: "completeJobs" }),
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
              return complete(async ({ finish, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...txCtx });
                return finish({ output: { result: job.input.value * multiplier } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "staged-with-callback",
        input: { value: 10 },
      }),
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
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [expect.objectContaining({ name: "user-preparation" })],
          }),
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
              expect.objectContaining({ name: "completeJobs" }),
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
              return complete(async ({ finish, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...txCtx });
                return finish({ output: { result: job.input.value * 5 } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "staged-without-callback",
        input: { value: 10 },
      }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 50 });
    });

    const expected = [
      expect.objectContaining({
        name: "withTransaction",
        status: "committed",
        children: [expect.objectContaining({ name: "startJobAttempt" })],
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
              expect.objectContaining({ name: "completeJobs" }),
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
              return complete(async ({ finish, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...txCtx });
                return finish({ output: { result: job.input.value * multiplier } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "atomic-with-callback",
        input: { value: 10 },
      }),
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
          expect.objectContaining({ name: "startJobAttempt" }),
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
              expect.objectContaining({ name: "completeJobs" }),
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
              return complete(async ({ finish, ...txCtx }) => {
                await spyStateAdapter.record({ name: "user-completion", ...txCtx });
                return finish({ output: { result: job.input.value * 7 } });
              });
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "atomic-without-callback",
        input: { value: 10 },
      }),
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
          expect.objectContaining({ name: "startJobAttempt" }),
          expect.objectContaining({
            name: "withSavepoint",
            status: "committed",
            children: [
              expect.objectContaining({ name: "user-completion" }),
              expect.objectContaining({ name: "completeJobs" }),
            ],
          }),
        ],
      }),
    ];
    expect(spyStateAdapter.calls.slice(0, expected.length)).toEqual(expected);
  });
};
