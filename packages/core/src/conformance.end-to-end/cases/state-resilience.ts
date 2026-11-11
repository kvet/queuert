import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceCase, ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import type { NotifyAdapter } from "../../notify-adapter/notify-adapter.ts";
import { createWorkerRunner } from "../../worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createFlakyStateAdapter } from "../support/flaky-state-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndFlakyDbContext, EndToEndStateAdapter } from "../types.ts";

const completionOptions = { pollIntervalMs: 100, timeoutMs: 15000 };

type FlakyWorkerRunnerShape = {
  nameSuffix: string;
  workerRunners: number;
  concurrency: number;
  pollIntervalMs: number;
};

const singleSlot: FlakyWorkerRunnerShape = {
  nameSuffix: "",
  workerRunners: 1,
  concurrency: 1,
  pollIntervalMs: 10_000,
};
const multipleSlots: FlakyWorkerRunnerShape = {
  nameSuffix: " with multiple slots",
  workerRunners: 1,
  concurrency: 5,
  pollIntervalMs: 250,
};
const multipleWorkers: FlakyWorkerRunnerShape = {
  nameSuffix: " with multiple workers",
  workerRunners: 2,
  concurrency: 5,
  pollIntervalMs: 100,
};

const completesChainsOverFlakyStateAdapter = async ({
  stateAdapter,
  flakyStateAdapter,
  notifyAdapter,
  shape,
}: {
  stateAdapter: EndToEndStateAdapter;
  flakyStateAdapter: EndToEndStateAdapter;
  notifyAdapter: NotifyAdapter;
  shape: FlakyWorkerRunnerShape;
}): Promise<void> => {
  const jobTypes = defineJobTypes<{
    test: { entry: true; input: { value: number }; output: { result: number } };
  }>();
  const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
  const flakyWorkerClient = createClient({
    stateAdapter: flakyStateAdapter,
    notifyAdapter,
    jobTypes,
  });
  await using stack = new AsyncDisposableStack();
  const flakyWorkerRunners = Array.from({ length: shape.workerRunners }, () =>
    stack.use(
      createWorkerRunner({
        client: flakyWorkerClient,
        concurrency: shape.concurrency,
        pollIntervalMs: shape.pollIntervalMs,
        recoveryBackoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
        processors: createProcessors({
          client,
          jobTypes,
          backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) =>
                withCaseTransaction(flakyStateAdapter, async (txCtx) =>
                  complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                ),
            },
          },
        }),
      }),
    ),
  );

  const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
    client.createChains({
      ...txCtx,
      items: Array.from({ length: 20 }, (_, i) => ({
        typeName: "test",
        input: { value: i },
      })),
    }),
  );

  for (const workerRunner of flakyWorkerRunners) {
    await workerRunner.start();
  }
  const completedChains = await Promise.all(
    chains.map(async (chain) => client.awaitChain(chain, completionOptions)),
  );
  assert.deepEqual(
    completedChains.map((chain) => chain.output),
    chains.map((_, i) => ({ result: i * 2 })),
  );
};

const transientErrorsCase = (
  shape: FlakyWorkerRunnerShape,
): ConformanceCase<StateAdapterConformanceContext> => ({
  name: `handles transient database errors gracefully${shape.nameSuffix}`,
  run: async ({ createStateAdapter, createNotifyAdapter }) => {
    await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
    await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
    const flaky = createFlakyStateAdapter(stateAdapter);

    await completesChainsOverFlakyStateAdapter({
      stateAdapter,
      flakyStateAdapter: flaky.stateAdapter,
      notifyAdapter,
      shape,
    });

    if (flaky.counts.calls > 5) {
      assert.ok(flaky.counts.errors > 0);
    }
  },
});

const realDatabaseErrorsCase = (
  shape: FlakyWorkerRunnerShape,
): ConformanceCase<EndToEndFlakyDbContext> => ({
  name: `handles real database errors gracefully${shape.nameSuffix}`,
  run: async ({ createFlakyDbStateAdapter, createStateAdapter, createNotifyAdapter }) => {
    await using flakyStateAdapter: EndToEndStateAdapter = await createFlakyDbStateAdapter();
    await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
    await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);

    await completesChainsOverFlakyStateAdapter({
      stateAdapter,
      flakyStateAdapter,
      notifyAdapter,
      shape,
    });
  },
});

const connectionErrorsCase = (
  shape: FlakyWorkerRunnerShape,
): ConformanceCase<EndToEndFlakyDbContext> => ({
  name: `handles connection errors on statements gracefully${shape.nameSuffix}`,
  run: async ({ createFlakyConnectionStateAdapter, createStateAdapter, createNotifyAdapter }) => {
    await using flakyStateAdapter: EndToEndStateAdapter = await createFlakyConnectionStateAdapter();
    await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
    await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);

    await completesChainsOverFlakyStateAdapter({
      stateAdapter,
      flakyStateAdapter,
      notifyAdapter,
      shape,
    });
  },
});

export const stateResilienceGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "state-resilience",
  cases: [
    transientErrorsCase(singleSlot),
    {
      name: "resets the recovery backoff once the worker starts a job",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        let failuresLeft = 2;
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerClient = createClient({
          stateAdapter: {
            ...stateAdapter,
            startJobAttempts: async (params) => {
              if (failuresLeft > 0) {
                failuresLeft--;
                throw new Error("startJobAttempts failed");
              }
              return stateAdapter.startJobAttempts(params);
            },
          },
          notifyAdapter,
          jobTypes,
        });
        await using workerRunner = createWorkerRunner({
          client: workerClient,
          pollIntervalMs: 100,
          recoveryBackoffConfig: { initialDelayMs: 1, multiplier: 100, maxDelayMs: 60_000 },
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: null }),
                  ),
              },
            },
          }),
        });

        const firstChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await workerRunner.start();
        const completedFirstChain = await client.awaitChain(firstChain, {
          pollIntervalMs: 100,
          timeoutMs: 5000,
        });
        assert.equal(completedFirstChain.status, "completed");

        failuresLeft = 1;
        const secondChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );
        const completedSecondChain = await client.awaitChain(secondChain, {
          pollIntervalMs: 100,
          timeoutMs: 5000,
        });
        assert.equal(completedSecondChain.status, "completed");
      },
    },
    {
      name: "aborts the attempts of a worker that lost its lease and completes them once it registers again under the same id",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const firstRenewal = new AbortController();
        const workerClient = createClient({
          stateAdapter: {
            ...stateAdapter,
            extendWorkerLease: async (params) => {
              if (firstRenewal.signal.aborted) return stateAdapter.extendWorkerLease(params);
              firstRenewal.abort();
              return undefined;
            },
          },
          notifyAdapter,
          jobTypes,
        });
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        await using workerRunner = createWorkerRunner({
          client: workerClient,
          concurrency: 2,
          pollIntervalMs: 50,
          recoveryBackoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
          leaseConfig: { durationMs: 300, heartbeatMs: 50 },
          processors: createProcessors({
            client,
            jobTypes,
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            processors: {
              test: {
                attemptHandler: async ({ job, signal, complete }) => {
                  if (job.attempt === 1) {
                    await sleep(Number.POSITIVE_INFINITY, { signal });
                    throw new Error("lease lost");
                  }
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: null }),
                  );
                },
              },
            },
          }),
        });

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "test", input: null },
              { typeName: "test", input: null },
            ],
          }),
        );

        await workerRunner.start();
        await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));

        const jobs = await client.getJobs({ ids: chains.map((chain) => chain.id) });
        assert.deepEqual(
          jobs.map((job) => ({ status: job?.status, attempt: job?.attempt })),
          [
            { status: "completed", attempt: 2 },
            { status: "completed", attempt: 2 },
          ],
        );
      },
    },
  ],
};

export const stateResilienceConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "state-resilience",
    cases: [transientErrorsCase(multipleSlots), transientErrorsCase(multipleWorkers)],
  };

export const stateResilienceFlakyDbGroup: ConformanceGroup<EndToEndFlakyDbContext> = {
  name: "state-resilience",
  cases: [realDatabaseErrorsCase(singleSlot), connectionErrorsCase(singleSlot)],
};

export const stateResilienceFlakyDbConcurrentTransactionsGroup: ConformanceGroup<EndToEndFlakyDbContext> =
  {
    name: "state-resilience",
    cases: [
      realDatabaseErrorsCase(multipleSlots),
      realDatabaseErrorsCase(multipleWorkers),
      connectionErrorsCase(multipleSlots),
      connectionErrorsCase(multipleWorkers),
    ],
  };
