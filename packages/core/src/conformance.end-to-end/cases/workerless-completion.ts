import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import {
  BlockerLimitExceededError,
  ChainTypeMismatchError,
  JobAlreadyCompletedError,
} from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { rejectionOf } from "../support/rejection-of.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

export const workerlessCompletionGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "workerless-completion",
  cases: [
    {
      name: "completes a simple chain without worker",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 42 },
          }),
        );

        const completedChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job, completeJob }) => {
              assert.deepEqual(job.typeName, "test");
              assert.deepEqual(job.status, "pending");
              assert.deepEqual(job.input, { value: 42 });

              return completeJob(job, async ({ complete }) => {
                return complete({ output: { result: 84 } });
              });
            },
          }),
        );

        assert.deepEqual(completedChain.output, { result: 84 });
      },
    },
    {
      name: "completes a complex chain without worker",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          "awaiting-approval": {
            entry: true;
            input: { requestId: string };
            continueWith: { typeName: "process-approved" };
          };
          "process-approved": {
            input: { approved: boolean };
            output: { done: boolean };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "awaiting-approval",
            input: { requestId: "req-123" },
          }),
        );

        assert.deepEqual(chain.status, "running");
        const initialJob = await client.getJob({ id: chain.id });
        assert.equal(initialJob!.status, "pending");

        const completedChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "awaiting-approval") {
                job = await completeJob(job, async ({ complete }) =>
                  complete({
                    continueWith: {
                      typeName: "process-approved",
                      input: { approved: true },
                    },
                  }),
                );
                return completeJob(job, async ({ complete }) =>
                  complete({ output: { done: true } }),
                );
              }
              return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
            },
          }),
        );

        assert.deepEqual(completedChain.output, { done: true });
      },
    },
    {
      name: "rejects continueWith typeName/input mismatches in completeChain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          start: {
            entry: true;
            input: { requestId: string };
            continueWith: { typeName: "step-a" };
          };
          "step-a": {
            input: { valueA: number };
            continueWith: { typeName: "step-b" };
          };
          "step-b": {
            input: { valueB: boolean };
            output: { result: string };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "start",
            input: { requestId: "req-1" },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "start") {
                job = await completeJob(job, async ({ complete }) =>
                  complete({ continueWith: { typeName: "step-a", input: { valueA: 42 } } }),
                );
              }

              if (job.typeName === "step-a") {
                job = await completeJob(job, async ({ complete }) =>
                  complete({ continueWith: { typeName: "step-b", input: { valueB: true } } }),
                );
              }

              if (job.typeName === "step-b") {
                return completeJob(job, async ({ complete }) =>
                  complete({ output: { result: "done" } }),
                );
              }
            },
          }),
        );

        assert.partialDeepStrictEqual(await client.getChain({ id: chain.id }), {
          status: "completed",
          output: { result: "done" },
        });
      },
    },
    {
      name: "rejects continueWith declaring more blockers than the limit in completeChain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: null;
            output: null;
          };
          starter: {
            entry: true;
            input: null;
            output: null;
            continueWith: { typeName: "next" };
          };
          next: {
            input: null;
            output: null;
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const blockerChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "blocker",
            input: null,
          }),
        );

        const starterChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "starter",
            input: null,
          }),
        );

        const error = await rejectionOf(async () => {
          await withCaseTransaction(stateAdapter, async (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...starterChain,
              handler: async ({ job, completeJob }) => {
                if (job.typeName === "starter") {
                  return completeJob(job, async ({ complete }) =>
                    complete({
                      continueWith: {
                        typeName: "next",
                        input: null,
                        blockers: Array.from(
                          { length: stateAdapter.config.maxBlockersPerJob + 1 },
                          () => blockerChain,
                        ) as [typeof blockerChain],
                      },
                    }),
                  );
                }
              },
            }),
          );
        });
        assert.ok(error instanceof BlockerLimitExceededError);
        assert.equal(error.count, stateAdapter.config.maxBlockersPerJob + 1);
        assert.equal(error.limit, stateAdapter.config.maxBlockersPerJob);
        assert.equal(error.typeName, "next");
      },
    },
    {
      name: "partially completes a complex chain without worker",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          "awaiting-approval": {
            entry: true;
            input: { requestId: string };
            continueWith: { typeName: "process-approved" };
          };
          "process-approved": {
            input: { approved: boolean };
            output: { done: true };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              "process-approved": {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { done: true } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "awaiting-approval",
            input: { requestId: "req-123" },
          }),
        );

        assert.deepEqual(chain.status, "running");
        const initialJob = await client.getJob({ id: chain.id });
        assert.equal(initialJob!.status, "pending");

        const partiallyCompletedChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "awaiting-approval") {
                await completeJob(job, async ({ complete }) =>
                  complete({
                    continueWith: {
                      typeName: "process-approved",
                      input: { approved: true },
                    },
                  }),
                );
              }
            },
          }),
        );

        await workerRunner.start();
        const succeededChain = await client.awaitChain(partiallyCompletedChain, completionOptions);

        assert.deepEqual(succeededChain.output, { done: true });
      },
    },
    {
      name: "throws error when finalizing already completed job",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: null;
            output: { result: boolean };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: null,
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job, completeJob }) => {
              const completed = await completeJob(job, async ({ complete }) =>
                complete({ output: { result: false } }),
              );

              const error = await rejectionOf(async () => {
                await completeJob(job, async ({ complete }) =>
                  complete({ output: { result: true } }),
                );
              });
              assert.ok(error instanceof JobAlreadyCompletedError);

              return completed;
            },
          }),
        );

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx) =>
              client.completeChain({
                ...txCtx,
                ...chain,
                handler: async ({ job, completeJob }) =>
                  completeJob(job, async ({ complete }) => complete({ output: { result: false } })),
              }),
            ),
          /job is already completed/,
        );
      },
    },
    {
      name: "read-only update without calling complete",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 42 },
          }),
        );

        const handlerCalled = new AbortController();
        const updatedChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job }) => {
              assert.partialDeepStrictEqual(job, { typeName: "test", status: "pending" });
              handlerCalled.abort();
            },
          }),
        );

        assert.equal(handlerCalled.signal.aborted, true);
        assert.partialDeepStrictEqual(updatedChain, {
          id: chain.id,
          status: "running",
        });
      },
    },
    {
      name: "signals running job when completed without worker",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobStarted = Promise.withResolvers<void>();
        const jobCompleted = Promise.withResolvers<void>();
        const processCompleted = Promise.withResolvers<void>();

        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: null;
            output: { result: string };
          };
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
                attemptHandler: async ({ signal, complete }) => {
                  jobStarted.resolve();

                  await jobCompleted.promise;

                  try {
                    await assert.rejects(
                      async () =>
                        withCaseTransaction(stateAdapter, async (txCtx) =>
                          complete({ ...txCtx, output: { result: "from-worker" } }),
                        ),
                      JobAlreadyCompletedError,
                    );

                    assert.equal(signal.aborted, true);

                    throw new Error();
                  } finally {
                    processCompleted.resolve();
                  }
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: null,
          }),
        );

        await workerRunner.start();
        await jobStarted.promise;
        await sleep(10);

        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job, completeJob }) => {
              await completeJob(job, async ({ complete }) =>
                complete({ output: { result: "from-external" } }),
              );
            },
          }),
        );
        jobCompleted.resolve();

        await processCompleted.promise;
      },
    },
    {
      name: "correctly narrows chainTypeName in completeChain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          entryA: { entry: true; input: null; continueWith: { typeName: "shared" } };
          entryB: { entry: true; input: null; continueWith: { typeName: "shared" } };
          shared: { input: null; output: { done: boolean } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "entryA", input: null }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job, completeJob }) => {
              assert.equal(job.chainTypeName, "entryA");

              if (job.typeName === "entryA") {
                job = await completeJob(job, async ({ complete }) =>
                  complete({ continueWith: { typeName: "shared", input: null } }),
                );
              }

              assert.equal(job.chainTypeName, "entryA");

              return completeJob(job, async ({ complete }) => complete({ output: { done: true } }));
            },
          }),
        );
      },
    },
    {
      name: "completeChain throws when called without transaction context",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 42 },
          }),
        );

        await assert.rejects(
          async () =>
            // @ts-expect-error missing txCtx
            client.completeChain({
              typeName: "test",
              id: chain.id,
              handler: async ({ job, completeJob }) =>
                completeJob(job, async ({ complete }) => complete({ output: { result: 84 } })),
            }),
          /requires a transaction context/,
        );
      },
    },
    {
      name: "completeChain throws when the context is not in a transaction",
      run: async ({ createStateAdapter, createNotifyAdapter, withNonTransactionContext }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "test", input: { value: 42 } }),
        );

        await withNonTransactionContext(async (txCtx) => {
          const error = await rejectionOf(async () => {
            await client.completeChain({
              ...txCtx,
              typeName: "test",
              id: chain.id,
              handler: async ({ job, completeJob }) =>
                completeJob(job, async ({ complete }) => complete({ output: { result: 84 } })),
            });
          });
          assert.match((error as Error).message, /not in a transaction/);
        });

        const job = await client.getJob({ id: chain.id });
        assert.equal(job!.status, "pending");
      },
    },
    {
      name: "completeChain throws on typeName mismatch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          order: { entry: true; input: { amount: number }; output: { receipt: string } };
          notification: { entry: true; input: { message: string }; output: { sent: boolean } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "order",
            input: { amount: 42 },
          }),
        );

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx) =>
              client.completeChain({
                ...txCtx,
                typeName: "notification",
                id: chain.id,
                handler: async ({ job, completeJob }) =>
                  completeJob(job, async ({ complete }) => complete({ output: { sent: true } })),
              }),
            ),
          ChainTypeMismatchError,
        );
      },
    },
    {
      name: "applies the terminal transition inline and rejects a second one",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          review: {
            entry: true;
            input: { requestId: string };
            output: { approved: boolean };
            continueWith: { typeName: "archive" };
          };
          archive: {
            input: { requestId: string };
            output: { archived: boolean };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "review",
            input: { requestId: "req-1" },
          }),
        );

        const completedChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...chain,
            handler: async ({ job, completeJob }) => {
              if (job.typeName !== "review") throw new Error("unexpected job type");
              return completeJob(job, async ({ complete }) => {
                const completedJob = await complete({ output: { approved: true } });

                const error = await rejectionOf(async () => {
                  await complete({
                    continueWith: { typeName: "archive", input: { requestId: "req-1" } },
                  });
                });
                assert.match((error as Error).message, /complete can only be called once/);

                return completedJob;
              });
            },
          }),
        );

        assert.deepEqual(completedChain.output, { approved: true });
      },
    },
    {
      name: "re-throws a swallowed complete failure instead of committing half of it",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: null };
          review: {
            entry: true;
            input: { requestId: string };
            output: { approved: boolean };
            continueWith: { typeName: "archive" };
          };
          archive: {
            input: { requestId: string };
            output: { archived: boolean };
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [blockerChain, chain] = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "blocker", input: null },
              { typeName: "review", input: { requestId: "req-1" } },
            ],
          }),
        );

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx) =>
              client.completeChain({
                ...txCtx,
                ...chain,
                handler: async ({ job, completeJob }) => {
                  if (job.typeName !== "review") throw new Error("unexpected job type");
                  return completeJob(job, async ({ complete }) => {
                    const error = await rejectionOf(async () => {
                      await complete({
                        continueWith: {
                          typeName: "archive",
                          input: { requestId: "req-1" },
                          blockers: Array.from(
                            { length: stateAdapter.config.maxBlockersPerJob + 1 },
                            () => blockerChain,
                          ) as [typeof blockerChain],
                        },
                      });
                    });
                    assert.ok(error instanceof BlockerLimitExceededError);

                    return complete({ output: { approved: false } });
                  });
                },
              }),
            ),
          BlockerLimitExceededError,
        );

        const jobs = await client.listChainJobs({ chainId: chain.id, limit: 10 });
        assert.equal(jobs.items.length, 1);
        const [onlyJob] = jobs.items;
        assert.equal(onlyJob.status, "pending");
      },
    },
  ],
};

export const workerlessCompletionConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "workerless-completion",
    cases: [
      {
        name: "skips the current job in workers while the completeChain handler runs",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
          await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
          const jobTypes = defineJobTypes<{
            first: { entry: true; input: null; continueWith: { typeName: "second" } };
            second: { input: null; output: null };
          }>();

          const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

          const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
            client.createChain({ ...txCtx, typeName: "first", input: null }),
          );
          await withCaseTransaction(stateAdapter, async (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain,
              handler: async ({ job, completeJob }) => {
                if (job.typeName !== "first") throw new Error(`unexpected ${job.typeName}`);
                return completeJob(job, async ({ complete }) =>
                  complete({ continueWith: { typeName: "second", input: null } }),
                );
              },
            }),
          );

          const secondAttempted = new AbortController();
          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                second: {
                  attemptHandler: async () => {
                    secondAttempted.abort();
                    throw new Error("acquired the job locked by completeChain");
                  },
                },
              },
            }),
          });

          const handlerEntered = Promise.withResolvers<void>();
          const handlerGate = Promise.withResolvers<void>();
          const completion = withCaseTransaction(stateAdapter, async (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain,
              handler: async ({ job, completeJob }) => {
                handlerEntered.resolve();
                await handlerGate.promise;
                if (job.typeName !== "second") throw new Error(`unexpected ${job.typeName}`);
                return completeJob(job, async ({ complete }) => complete({ output: null }));
              },
            }),
          );

          try {
            await handlerEntered.promise;
            await workerRunner.start();
            await sleep(100);
            await workerRunner.close();
            assert.equal(secondAttempted.signal.aborted, false);
          } finally {
            handlerGate.resolve();
            await completion;
          }
        },
      },
    ],
  };
