import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, syncAsync, resource, step, wait } from "@queuert/sync-async";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { runInModeOf } from "../../conformance/adapters.ts";
import type { ConformanceCase, ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import type { NotifyAdapter } from "../../notify-adapter/notify-adapter.ts";
import type { StateAdapter } from "../../state-adapter/state-adapter.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createCaseStateAdapter } from "../support/create-case-state-adapter.ts";
import { createFlakyStateAdapter } from "../support/flaky-state-adapter.ts";
import type { EndToEndFlakyDbContext, EndToEndTxContext } from "../types.ts";

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

const completesChainsOverFlakyStateAdapter = syncAsync(function* ({
  stateAdapter,
  flakyStateAdapter,
  notifyAdapter,
  shape,
}: {
  stateAdapter: StateAdapter<EndToEndTxContext, string, string, "async">;
  flakyStateAdapter: StateAdapter<EndToEndTxContext, string, string, "async">;
  notifyAdapter: NotifyAdapter<"async">;
  shape: FlakyWorkerRunnerShape;
}) {
  const jobTypes = defineJobTypes<{
    test: { entry: true; input: { value: number }; output: { result: number } };
  }>();
  const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
  const flakyWorkerClient = createClient({
    stateAdapter: flakyStateAdapter,
    notifyAdapter,
    jobTypes,
  });
  const stack = yield* resource(new AsyncDisposableStack());
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
              attemptHandler: async ({ job, applyOutcome }) =>
                flakyStateAdapter.withTransaction((txCtx) =>
                  applyOutcome({ ...txCtx, output: { result: job.input.value * 2 } }),
                ),
            },
          },
        }),
      }),
    ),
  );

  const chains = yield* step(
    stateAdapter.withTransaction((txCtx) =>
      client.createChains({
        ...txCtx,
        items: Array.from({ length: 20 }, (_, i) => ({
          typeName: "test",
          input: { value: i },
        })),
      }),
    ),
  );

  for (const workerRunner of flakyWorkerRunners) {
    yield* wait(workerRunner.start());
  }
  const completedChains = yield* wait(client.awaitChains({ chains, ...completionOptions }));
  assert.deepEqual(
    completedChains.map((chain) => chain.output),
    chains.map((_, i) => ({ result: i * 2 })),
  );
});

const transientErrorsCase = (
  shape: FlakyWorkerRunnerShape,
): ConformanceCase<StateAdapterConformanceContext> => ({
  name: `handles transient database errors gracefully${shape.nameSuffix}`,
  run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
    const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
    const notifyAdapter = yield* resource(
      createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
    );
    const flaky = createFlakyStateAdapter(stateAdapter);

    yield* completesChainsOverFlakyStateAdapter.steps({
      stateAdapter,
      flakyStateAdapter: flaky.stateAdapter,
      notifyAdapter,
      shape,
    });

    if (flaky.counts.calls > 5) {
      assert.ok(flaky.counts.errors > 0);
    }
  }),
});

const realDatabaseErrorsCase = (
  shape: FlakyWorkerRunnerShape,
): ConformanceCase<EndToEndFlakyDbContext> => ({
  name: `handles real database errors gracefully${shape.nameSuffix}`,
  run: dynamicSyncAsync(function* ({
    createFlakyDbStateAdapter,
    createStateAdapter,
    createNotifyAdapter,
  }) {
    const flakyStateAdapter = yield* resource(createCaseStateAdapter(createFlakyDbStateAdapter));
    const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
    const notifyAdapter = yield* resource(
      createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
    );

    yield* completesChainsOverFlakyStateAdapter.steps({
      stateAdapter,
      flakyStateAdapter,
      notifyAdapter,
      shape,
    });
  }),
});

const connectionErrorsCase = (
  shape: FlakyWorkerRunnerShape,
): ConformanceCase<EndToEndFlakyDbContext> => ({
  name: `handles connection errors on statements gracefully${shape.nameSuffix}`,
  run: dynamicSyncAsync(function* ({
    createFlakyConnectionStateAdapter,
    createStateAdapter,
    createNotifyAdapter,
  }) {
    const flakyStateAdapter = yield* resource(
      createCaseStateAdapter(createFlakyConnectionStateAdapter),
    );
    const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
    const notifyAdapter = yield* resource(
      createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
    );

    yield* completesChainsOverFlakyStateAdapter.steps({
      stateAdapter,
      flakyStateAdapter,
      notifyAdapter,
      shape,
    });
  }),
});

export const stateResilienceGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "state-resilience",
  cases: [
    transientErrorsCase(singleSlot),
    {
      name: "resets the recovery backoff once the worker starts a job",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        let failuresLeft = 2;
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerClient = createClient({
          stateAdapter: {
            ...stateAdapter,
            startJobAttempts: (params) =>
              runInModeOf(
                stateAdapter,
                syncAsync(function* () {
                  if (failuresLeft > 0) {
                    failuresLeft--;
                    throw new Error("startJobAttempts failed");
                  }
                  return yield* step(stateAdapter.startJobAttempts(params));
                }),
              ),
          },
          notifyAdapter,
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client: workerClient,
            pollIntervalMs: 100,
            recoveryBackoffConfig: { initialDelayMs: 1, multiplier: 100, maxDelayMs: 60_000 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: null }),
                    ),
                },
              },
            }),
          }),
        );

        const firstChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        const completedFirstChain = yield* wait(
          client.awaitChain({ chain: firstChain, pollIntervalMs: 100, timeoutMs: 5000 }),
        );
        assert.equal(completedFirstChain.status, "completed");

        failuresLeft = 1;
        const secondChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );
        const completedSecondChain = yield* wait(
          client.awaitChain({ chain: secondChain, pollIntervalMs: 100, timeoutMs: 5000 }),
        );
        assert.equal(completedSecondChain.status, "completed");
      }),
    },
    {
      name: "aborts the attempts of a worker that lost its lease and completes them once it registers again under the same id",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const firstRenewal = new AbortController();
        const workerClient = createClient({
          stateAdapter: {
            ...stateAdapter,
            extendWorkerLease: (params) =>
              runInModeOf(
                stateAdapter,
                syncAsync(function* () {
                  if (firstRenewal.signal.aborted) {
                    return yield* step(stateAdapter.extendWorkerLease(params));
                  }
                  firstRenewal.abort();
                  return undefined;
                }),
              ),
          },
          notifyAdapter,
          jobTypes,
        });
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
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
                  attemptHandler: async ({ job, signal, applyOutcome }) => {
                    if (job.attempt === 1) {
                      await sleep(Number.POSITIVE_INFINITY, { signal });
                      throw new Error("lease lost");
                    }
                    return stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: null },
                { typeName: "test", input: null },
              ],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChains({ chains, ...completionOptions }));

        const jobs = yield* step(client.getJobs({ ids: chains.map((chain) => chain.id) }));
        assert.deepEqual(
          jobs.map((job) => ({ status: job?.status, attempt: job?.attempt })),
          [
            { status: "completed", attempt: 2 },
            { status: "completed", attempt: 2 },
          ],
        );
      }),
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
