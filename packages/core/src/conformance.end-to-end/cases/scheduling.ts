import assert from "node:assert/strict";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

export const schedulingGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "scheduling",
  cases: [
    {
      name: "createChain with schedule.afterMs defers job processing",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 50,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 1 },
            schedule: { afterMs: 300 },
          }),
        );

        await workerRunner.start();
        await assert.rejects(client.awaitChain(chain, { timeoutMs: 200 }));
        assert.notEqual(
          await client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 }),
          undefined,
        );
      },
    },
    {
      name: "createChain with schedule.at defers job processing",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 50,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 1 },
            schedule: { at: new Date(Date.now() + 300) },
          }),
        );

        await workerRunner.start();
        await assert.rejects(client.awaitChain(chain, { timeoutMs: 200 }));
        assert.notEqual(
          await client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 }),
          undefined,
        );
      },
    },
    {
      name: "continueWith with schedule.afterMs defers continuation job",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: { value: number }; continueWith: { typeName: "second" } };
          second: { input: { continued: boolean }; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const firstCompleted = Promise.withResolvers<void>();
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 50,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              first: {
                attemptHandler: async ({ complete }) => {
                  try {
                    return await withCaseTransaction(stateAdapter, async (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: {
                          typeName: "second",
                          input: { continued: true },
                          schedule: { afterMs: 300 },
                        },
                      }),
                    );
                  } finally {
                    firstCompleted.resolve();
                  }
                },
              },
              second: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: "done" } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "first", input: { value: 1 } }),
        );

        await workerRunner.start();
        await firstCompleted.promise;
        await assert.rejects(client.awaitChain(chain, { timeoutMs: 200 }));
        assert.notEqual(
          await client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 }),
          undefined,
        );
      },
    },
    {
      name: "continueWith with schedule.at defers continuation job",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: { value: number }; continueWith: { typeName: "second" } };
          second: { input: { continued: boolean }; output: { result: string } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const firstCompleted = Promise.withResolvers<void>();
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 50,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              first: {
                attemptHandler: async ({ complete }) => {
                  try {
                    return await withCaseTransaction(stateAdapter, async (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: {
                          typeName: "second",
                          input: { continued: true },
                          schedule: { at: new Date(Date.now() + 300) },
                        },
                      }),
                    );
                  } finally {
                    firstCompleted.resolve();
                  }
                },
              },
              second: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: "done" } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "first", input: { value: 1 } }),
        );

        await workerRunner.start();
        await firstCompleted.promise;
        await assert.rejects(client.awaitChain(chain, { timeoutMs: 200 }));
        assert.notEqual(
          await client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 }),
          undefined,
        );
      },
    },
    {
      name: "rescheduling with afterMs defers the next attempt by the given delay",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        let attemptCount = 0;
        const firstAttemptDone = Promise.withResolvers<void>();
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 50,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) => {
                  attemptCount++;
                  if (attemptCount > 1) {
                    assert.equal(job.lastAttemptError, null);
                  }
                  if (attemptCount === 1) {
                    firstAttemptDone.resolve();
                    return withCaseTransaction(stateAdapter, async (txCtx) =>
                      complete({ ...txCtx, reschedule: { afterMs: 300 } }),
                    );
                  }
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                  );
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: { value: 1 } }),
        );

        await workerRunner.start();
        await firstAttemptDone.promise;
        await assert.rejects(client.awaitChain(chain, { timeoutMs: 200 }));
        assert.notEqual(
          await client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 }),
          undefined,
        );
        assert.equal(attemptCount, 2);
      },
    },
    {
      name: "recurring job self-schedules after complete without matching its own chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          recurring: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        let completionCount = 0;
        const allDone = Promise.withResolvers<void>();
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 50,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              recurring: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) => {
                    completionCount++;
                    const completedJob = await complete({ ...txCtx, output: null });
                    if (completionCount < 3) {
                      const next = await client.createChain({
                        ...txCtx,
                        typeName: "recurring",
                        input: null,
                        deduplication: { key: "recurring", scope: "running" },
                      });
                      assert.equal(next.deduplicated, false);
                    } else {
                      allDone.resolve();
                    }
                    return completedJob;
                  }),
              },
            },
          }),
        });

        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "recurring",
            input: null,
            deduplication: { key: "recurring", scope: "running" },
          }),
        );

        await workerRunner.start();
        await allDone.promise;
        const { items: chains } = await client.listChains({ typeName: "recurring", limit: 10 });
        assert.equal(chains.length, 3);
        assert.equal(completionCount, 3);
      },
    },
    {
      name: "rescheduling with schedule.at defers the next attempt to the given time",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        let attemptCount = 0;
        const firstAttemptDone = Promise.withResolvers<void>();
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 50,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) => {
                  attemptCount++;
                  if (attemptCount > 1) {
                    assert.equal(job.lastAttemptError, null);
                  }
                  if (attemptCount === 1) {
                    firstAttemptDone.resolve();
                    return withCaseTransaction(stateAdapter, async (txCtx) =>
                      complete({
                        ...txCtx,
                        reschedule: { at: new Date(Date.now() + 300) },
                      }),
                    );
                  }
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                  );
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: { value: 1 } }),
        );

        await workerRunner.start();
        await firstAttemptDone.promise;
        await assert.rejects(client.awaitChain(chain, { timeoutMs: 200 }));
        assert.notEqual(
          await client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 400 }),
          undefined,
        );
        assert.equal(attemptCount, 2);
      },
    },
    {
      name: "createChain with past schedule.at clamps scheduledAt to now",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
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
        const past = new Date(Date.now() - 60 * 60 * 1000);

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: null,
            schedule: { at: past },
          }),
        );

        const headJob = await client.getJob({ id: chain.id });
        assert.notEqual(headJob, undefined);
        assert.ok(headJob!.scheduledAt.getTime() - past.getTime() > 30 * 60 * 1000);

        await workerRunner.start();
        await client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 });
      },
    },
    {
      name: "continueWith with past schedule.at clamps scheduledAt to now",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          first: { entry: true; input: null; continueWith: { typeName: "second" } };
          second: { input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const past = new Date(Date.now() - 60 * 60 * 1000);
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              first: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({
                      ...txCtx,
                      continueWith: { typeName: "second", input: null, schedule: { at: past } },
                    }),
                  ),
              },
              second: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: null }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "first", input: null }),
        );

        await workerRunner.start();
        await client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 });

        const chainJobs = await client.listChainJobs({
          chainId: chain.id,
          orderDirection: "asc",
          limit: 10,
        });
        const continuation = chainJobs.items.find((job) => job.chainIndex === 1);
        assert.notEqual(continuation, undefined);
        assert.ok(continuation!.scheduledAt.getTime() - past.getTime() > 30 * 60 * 1000);
      },
    },
    {
      name: "rescheduling with past schedule.at clamps scheduledAt to now",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const past = new Date(Date.now() - 60 * 60 * 1000);
        let attempts = 0;
        const firstAttemptDone = Promise.withResolvers<void>();
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 50,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) => {
                  attempts++;
                  if (attempts > 1) {
                    assert.equal(job.lastAttemptError, null);
                  }
                  if (attempts === 1) {
                    firstAttemptDone.resolve();
                    return withCaseTransaction(stateAdapter, async (txCtx) =>
                      complete({ ...txCtx, reschedule: { at: past } }),
                    );
                  }
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: null }),
                  );
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: null }),
        );

        await workerRunner.start();
        await firstAttemptDone.promise;
        await client.awaitChain(chain, { timeoutMs: 2000, pollIntervalMs: 50 });

        assert.equal(attempts, 2);
      },
    },
  ],
};
