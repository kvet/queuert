import assert from "node:assert/strict";

import { sleep, withWorkerRunners } from "@queuert/helpers";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { Chain } from "../../entities/chain.ts";
import { BlockerLimitExceededError, ChainTypeMismatchError } from "../../errors.ts";
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

export const blockerChainsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "blocker-chains",
  cases: [
    {
      name: "handles long blocker chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { done: true };
            continueWith: { typeName: "blocker" };
          };
          main: {
            entry: true;
            input: { start: boolean };
            output: { finalResult: number };
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        let blockerChainId: string;

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) => {
                  assert.deepEqual(job.chainId, blockerChainId);

                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    job.input.value < 1
                      ? complete({
                          ...txCtx,
                          txHooks,
                          continueWith: {
                            typeName: "blocker",
                            input: { value: job.input.value + 1 },
                          },
                        })
                      : complete({ ...txCtx, txHooks, output: { done: true } }),
                  );
                },
              },
              main: {
                attemptHandler: async ({
                  job: {
                    input,
                    blockers: [blocker],
                  },
                  complete,
                }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: {
                        finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
                      },
                    }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
          const dependencyChain = await client.createChain({
            ...txCtx,
            txHooks,
            typeName: "blocker",
            input: { value: 0 },
          });
          blockerChainId = dependencyChain.id;

          const chain = await client.createChain({
            ...txCtx,
            txHooks,
            typeName: "main",
            input: { start: true },
            blockers: [dependencyChain],
          });

          return chain;
        });

        await withWorkerRunners([await workerRunner.start()], async () => {
          const succeededChain = await client.awaitChain(chain, completionOptions);

          assert.deepEqual(succeededChain.output, { finalResult: 2 });
        });
      },
    },
    {
      name: "handles completed blocker chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          main: {
            entry: true;
            input: null;
            output: { finalResult: number };
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  ),
              },
              main: {
                attemptHandler: async ({ job, complete }) => {
                  const [blocker] = job.blockers;

                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: {
                        finalResult: blocker.output.result,
                      },
                    }),
                  );
                },
              },
            },
          }),
        });

        const blockerChain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "blocker",
            input: { value: 1 },
          }),
        );
        const completedBlockerChain = await withCaseTransaction(
          stateAdapter,
          async (txCtx, txHooks) =>
            client.completeChain({
              ...txCtx,
              txHooks,
              ...blockerChain,
              handler: async ({ job, completeJob }) =>
                completeJob(job, async ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                ),
            }),
        );

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "main",
            input: null,
            blockers: [completedBlockerChain],
          }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          const succeededChain = await client.awaitChain(chain, completionOptions);

          assert.deepEqual(succeededChain.output, {
            finalResult: completedBlockerChain.output.result,
          });
        });
      },
    },
    {
      name: "rejects createChain declaring more blockers than the limit",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: null;
            output: null;
          };
          main: {
            entry: true;
            input: null;
            output: null;
            blockers: { typeName: "blocker" }[];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const blockerChain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "blocker",
            input: null,
          }),
        );

        const error = await rejectionOf(async () => {
          await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
            client.createChain({
              ...txCtx,
              txHooks,
              typeName: "main",
              input: null,
              blockers: Array.from(
                { length: stateAdapter.config.maxBlockersPerJob + 1 },
                () => blockerChain,
              ),
            }),
          );
        });
        assert.ok(error instanceof BlockerLimitExceededError);
        assert.equal(error.count, stateAdapter.config.maxBlockersPerJob + 1);
        assert.equal(error.limit, stateAdapter.config.maxBlockersPerJob);
        assert.equal(error.typeName, "main");
      },
    },
    {
      name: "rejects continueWith declaring more blockers than the limit",
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
            blockers: { typeName: "blocker" }[];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const blockerChain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "blocker",
            input: null,
          }),
        );

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
              starter: {
                backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
                attemptHandler: async ({ job, complete }) => {
                  if (job.attempt === 1) {
                    return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                      complete({
                        ...txCtx,
                        txHooks,
                        continueWith: {
                          typeName: "next",
                          input: null,
                          blockers: Array.from(
                            { length: stateAdapter.config.maxBlockersPerJob + 1 },
                            () => blockerChain,
                          ),
                        },
                      }),
                    );
                  }

                  assert.ok(job.lastAttemptError?.includes("BlockerLimitExceededError"));
                  assert.ok(
                    job.lastAttemptError?.includes(
                      `exceeding the limit of ${stateAdapter.config.maxBlockersPerJob}`,
                    ),
                  );
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  );
                },
              },
              next: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "starter",
            input: null,
          }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(chain, completionOptions);
        });
      },
    },
    {
      name: "independent chains spawned during processing do not inherit context",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          inner: {
            entry: true;
            input: null;
            output: null;
          };
          outer: {
            entry: true;
            input: null;
            output: null;
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const childChains: Chain<string, "inner", null, null>[] = [];

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              inner: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
              outer: {
                attemptHandler: async ({ complete }) => {
                  await withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
                    childChains.push(
                      await client.createChain({
                        ...txCtx,
                        txHooks,
                        typeName: "inner",
                        input: null,
                      }),
                    );
                  });

                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
                    childChains.push(
                      await client.createChain({
                        ...txCtx,
                        txHooks,
                        typeName: "inner",
                        input: null,
                      }),
                    );

                    return complete({ ...txCtx, txHooks, output: null });
                  });
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "outer",
            input: null,
          }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          await client.awaitChain(chain, completionOptions);

          const succeededChildChains = await Promise.all(
            childChains.map(async (chain) => client.awaitChain(chain, completionOptions)),
          );

          assert.equal(succeededChildChains.length, 2);
        });
      },
    },
    {
      name: "handles chains that are distributed across workers",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { value: number };
            continueWith: { typeName: "finish" };
          };
          finish: {
            input: { valueNext: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner1 = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 100,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      continueWith: {
                        typeName: "finish",
                        input: { valueNext: job.input.value + 1 },
                      },
                    }),
                  ),
              },
            },
          }),
        });
        const workerRunner2 = createWorkerRunner({
          client,
          concurrency: 1,
          pollIntervalMs: 100,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              finish: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: { result: job.input.valueNext + 1 },
                    }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 1 },
          }),
        );

        await withWorkerRunners(
          [await workerRunner1.start(), await workerRunner2.start()],
          async () => {
            const finishedChain = await client.awaitChain(chain, completionOptions);

            assert.deepEqual(finishedChain.output, { result: 3 });
          },
        );
      },
    },
    {
      name: "handles multiple blocker chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          main: {
            entry: true;
            input: null;
            output: { finalResult: number[] };
            blockers: { typeName: "blocker" }[];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  ),
              },
              main: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: {
                        finalResult: job.blockers.map((blocker) => blocker.output.result),
                      },
                    }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
          const blockerChains = await client.createChains({
            ...txCtx,
            txHooks,
            items: Array.from({ length: 5 }, (_, i) => ({
              typeName: "blocker",
              input: { value: i + 1 },
            })),
          });
          return client.createChain({
            ...txCtx,
            txHooks,
            typeName: "main",
            input: null,
            blockers: blockerChains,
          });
        });

        await withWorkerRunners([await workerRunner.start()], async () => {
          const succeededChain = await client.awaitChain(chain, completionOptions);

          assert.deepEqual(succeededChain.output, {
            finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
          });
        });
      },
    },
    {
      name: "continueWith supports blockers",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          first: {
            entry: true;
            input: { id: string };
            continueWith: { typeName: "second" };
          };
          second: {
            input: { fromFirst: string };
            output: { finalResult: number };
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value * 10 } }),
                  ),
              },
              first: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
                    const blockerChain = await client.createChain({
                      ...txCtx,
                      txHooks,
                      typeName: "blocker",
                      input: { value: 5 },
                    });
                    return complete({
                      ...txCtx,
                      txHooks,
                      continueWith: {
                        typeName: "second",
                        input: { fromFirst: job.input.id },
                        blockers: [blockerChain],
                      },
                    });
                  }),
              },
              second: {
                attemptHandler: async ({ job, complete }) => {
                  const [blocker] = job.blockers;
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: { finalResult: blocker.output.result },
                    }),
                  );
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "first",
            input: { id: "test-123" },
          }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          const succeededChain = await client.awaitChain(chain, completionOptions);

          assert.deepEqual(succeededChain.output, { finalResult: 50 });
        });
      },
    },
    {
      name: "continueWith accepts blockers by id and resolves them from the stored chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          other: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          first: {
            entry: true;
            input: { blockerId: string; otherId: string };
            continueWith: { typeName: "second" };
          };
          second: {
            input: null;
            output: { sum: number };
            blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" | "other" }[]];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  ),
              },
              other: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  ),
              },
              first: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      continueWith: {
                        typeName: "second",
                        input: null,
                        blockers: [{ id: job.input.blockerId }, { id: job.input.otherId }],
                      },
                    }),
                  ),
              },
              second: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: {
                        sum: job.blockers.reduce((sum, blocker) => sum + blocker.output.result, 0),
                      },
                    }),
                  ),
              },
            },
          }),
        });

        const { blockerChain, otherChain } = await withCaseTransaction(
          stateAdapter,
          async (txCtx, txHooks) => ({
            blockerChain: await client.createChain({
              ...txCtx,
              txHooks,
              typeName: "blocker",
              input: { value: 1 },
            }),
            otherChain: await client.createChain({
              ...txCtx,
              txHooks,
              typeName: "other",
              input: { value: 10 },
            }),
          }),
        );

        const mismatchChain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "first",
            input: { blockerId: blockerChain.id, otherId: otherChain.id },
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...mismatchChain,
            handler: async ({ job, completeJob }) => {
              if (job.typeName !== "first") return;
              try {
                await completeJob(job, async ({ complete }) => {
                  return complete({
                    continueWith: {
                      typeName: "second",
                      input: null,
                      blockers: [{ id: otherChain.id, typeName: "blocker" }],
                    },
                  });
                });
              } catch (error) {
                assert.ok(error instanceof ChainTypeMismatchError);
                return;
              }
              throw new Error("Expected completeJob to throw ChainTypeMismatchError");
            },
          }),
        );

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "first",
            input: { blockerId: blockerChain.id, otherId: otherChain.id },
          }),
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          const succeededChain = await client.awaitChain(chain, completionOptions);

          assert.deepEqual(succeededChain.output, { sum: 11 });
        });
      },
    },
    {
      name: "accepts blockers by id and resolves them from the stored chain",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          other: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          main: {
            entry: true;
            input: null;
            output: { sum: number };
            blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" | "other" }[]];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  ),
              },
              other: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  ),
              },
              main: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: {
                        sum: job.blockers.reduce((sum, blocker) => sum + blocker.output.result, 0),
                      },
                    }),
                  ),
              },
            },
          }),
        });

        const { blockerChain, otherChain } = await withCaseTransaction(
          stateAdapter,
          async (txCtx, txHooks) => ({
            blockerChain: await client.createChain({
              ...txCtx,
              txHooks,
              typeName: "blocker",
              input: { value: 1 },
            }),
            otherChain: await client.createChain({
              ...txCtx,
              txHooks,
              typeName: "other",
              input: { value: 10 },
            }),
          }),
        );

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "main",
            input: null,
            blockers: [
              { id: blockerChain.id },
              { id: otherChain.id, typeName: "other" },
              blockerChain,
            ],
          }),
        );

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
              client.createChain({
                ...txCtx,
                txHooks,
                typeName: "main",
                input: null,
                blockers: [{ id: otherChain.id, typeName: "blocker" }],
              }),
            ),
          ChainTypeMismatchError,
        );

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
              client.createChain({
                ...txCtx,
                txHooks,
                typeName: "main",
                input: null,
                blockers: [{ ...otherChain, typeName: "blocker" as const }],
              }),
            ),
          ChainTypeMismatchError,
        );

        await withWorkerRunners([await workerRunner.start()], async () => {
          const succeededChain = await client.awaitChain(chain, completionOptions);

          assert.deepEqual(succeededChain.output, { sum: 12 });
        });
      },
    },
    {
      name: "batch-creates multiple blocker chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          main: {
            entry: true;
            input: null;
            output: { finalResult: number[] };
            blockers: [{ typeName: "blocker" }, ...{ typeName: "blocker" }[]];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  ),
              },
              main: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: {
                        finalResult: job.blockers.map((blocker) => blocker.output.result),
                      },
                    }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
          const blockerChains = await client.createChains({
            ...txCtx,
            txHooks,
            items: [
              {
                typeName: "blocker",
                input: { value: 1 },
              },
              {
                typeName: "blocker",
                input: { value: 2 },
              },
              {
                typeName: "blocker",
                input: { value: 3 },
              },
              {
                typeName: "blocker",
                input: { value: 4 },
              },
              {
                typeName: "blocker",
                input: { value: 5 },
              },
            ],
          });
          return client.createChain({
            ...txCtx,
            txHooks,
            typeName: "main",
            input: null,
            blockers: blockerChains,
          });
        });

        await withWorkerRunners([await workerRunner.start()], async () => {
          const succeededChain = await client.awaitChain(chain, completionOptions);

          assert.deepEqual(succeededChain.output, {
            finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
          });
        });
      },
    },
    {
      name: "batch-creates chains with shared blocker",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          main: {
            entry: true;
            input: { label: string };
            output: { finalResult: number };
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  ),
              },
              main: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: {
                        finalResult: job.blockers[0].output.result,
                      },
                    }),
                  ),
              },
            },
          }),
        });

        const blocker = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "blocker",
            input: { value: 99 },
          }),
        );

        const [mainA, mainB] = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChains({
            ...txCtx,
            txHooks,
            items: [
              { typeName: "main", input: { label: "A" }, blockers: [blocker] },
              { typeName: "main", input: { label: "B" }, blockers: [blocker] },
            ],
          }),
        );

        assert.equal(mainA.status, "running");
        assert.equal(mainB.status, "running");

        const jobA = await client.getJob({ id: mainA.id });
        const jobB = await client.getJob({ id: mainB.id });
        assert.equal(jobA!.status, "blocked");
        assert.equal(jobB!.status, "blocked");

        await withWorkerRunners([await workerRunner.start()], async () => {
          const [resultA, resultB] = await Promise.all([
            client.awaitChain(mainA, completionOptions),
            client.awaitChain(mainB, completionOptions),
          ]);

          assert.deepEqual(resultA.output, { finalResult: 99 });
          assert.deepEqual(resultB.output, { finalResult: 99 });
        });
      },
    },
    {
      name: "handles duplicate blocker chain ids without breaking unblock",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: null;
            output: null;
          };
          main: {
            entry: true;
            input: null;
            output: { done: true };
            blockers: { typeName: "blocker" }[];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
              main: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { done: true as const } }),
                  ),
              },
            },
          }),
        });

        const blockerChain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "blocker",
            input: null,
          }),
        );

        const mainChain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "main",
            input: null,
            blockers: [blockerChain, blockerChain, blockerChain],
          }),
        );

        const mainJob = await client.getJob({ id: mainChain.id });
        assert.notEqual(mainJob, undefined);
        assert.equal(mainJob!.status, "blocked");

        await withWorkerRunners([await workerRunner.start()], async () => {
          const result = await client.awaitChain(mainChain, completionOptions);
          assert.deepEqual(result.output, { done: true });
        });
      },
    },
    {
      name: "batch-creates chains that repeat blocker ids in different positions",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          main: {
            entry: true;
            input: null;
            output: { results: number[] };
            blockers: { typeName: "blocker" }[];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 2,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: { result: job.input.value } }),
                  ),
              },
              main: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({
                      ...txCtx,
                      txHooks,
                      output: { results: job.blockers.map((blocker) => blocker.output.result) },
                    }),
                  ),
              },
            },
          }),
        });

        const [first, second] = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChains({
            ...txCtx,
            txHooks,
            items: [
              { typeName: "blocker", input: { value: 1 } },
              { typeName: "blocker", input: { value: 2 } },
            ],
          }),
        );

        const [mainA, mainB] = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChains({
            ...txCtx,
            txHooks,
            items: [
              { typeName: "main", input: null, blockers: [first, second] },
              { typeName: "main", input: null, blockers: [second, first, second] },
            ],
          }),
        );

        assert.equal((await client.getJob({ id: mainA.id }))!.status, "blocked");
        assert.equal((await client.getJob({ id: mainB.id }))!.status, "blocked");

        await withWorkerRunners([await workerRunner.start()], async () => {
          const [resultA, resultB] = await Promise.all([
            client.awaitChain(mainA, completionOptions),
            client.awaitChain(mainB, completionOptions),
          ]);
          assert.deepEqual(resultA.output, { results: [1, 2] });
          assert.deepEqual(resultB.output, { results: [2, 1, 2] });
        });
      },
    },
    {
      name: "raises scheduledAt to unblock time so blocked-since-creation jobs don't jump the queue",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: null;
            output: null;
          };
          main: {
            entry: true;
            input: null;
            output: null;
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const blockerHeld = Promise.withResolvers<void>();
        const releaseBlocker = Promise.withResolvers<void>();

        const mainChain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
          const blockerChain = await client.createChain({
            ...txCtx,
            txHooks,
            typeName: "blocker",
            input: null,
          });
          return client.createChain({
            ...txCtx,
            txHooks,
            typeName: "main",
            input: null,
            blockers: [blockerChain],
          });
        });

        const mainAtCreation = await client.getJob({ id: mainChain.id });
        assert.notEqual(mainAtCreation, undefined);
        const creationScheduledAt = mainAtCreation!.scheduledAt.getTime();

        const workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ complete }) => {
                  blockerHeld.resolve();
                  await releaseBlocker.promise;
                  return withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  );
                },
              },
              main: {
                attemptHandler: async ({ complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                    complete({ ...txCtx, txHooks, output: null }),
                  ),
              },
            },
          }),
        });

        await withWorkerRunners([await workerRunner.start()], async () => {
          await blockerHeld.promise;
          await sleep(10);
          releaseBlocker.resolve();
          await client.awaitChain(mainChain, completionOptions);
        });

        const unblockedMain = await client.getJob({ id: mainChain.id });
        assert.notEqual(unblockedMain, undefined);
        assert.ok(unblockedMain!.scheduledAt.getTime() > creationScheduledAt);
      },
    },
  ],
};

export const blockerChainsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "blocker-chains",
    cases: [
      {
        name: "unblocks all jobs when multiple shared blocker chains complete concurrently",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
          await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
          const blockerCount = 5;
          const mainCount = 5;

          const jobTypes = defineJobTypes<{
            blocker: {
              entry: true;
              input: null;
              output: null;
            };
            main: {
              entry: true;
              input: { index: number };
              output: { result: number };
              blockers: { typeName: "blocker" }[];
            };
          }>();

          const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

          let readyBlockers = 0;
          const allBlockersReady = Promise.withResolvers<void>();
          const releaseBlockers = Promise.withResolvers<void>();

          const workerRunner = createWorkerRunner({
            client,
            concurrency: blockerCount + mainCount,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, async (txCtx, txHooks) => {
                      readyBlockers++;
                      if (readyBlockers === blockerCount) allBlockersReady.resolve();
                      await releaseBlockers.promise;
                      return complete({ ...txCtx, txHooks, output: null });
                    }),
                },
                main: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                      complete({ ...txCtx, txHooks, output: { result: job.input.index } }),
                    ),
                },
              },
            }),
          });

          const blockerChains = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
            client.createChains({
              ...txCtx,
              txHooks,
              items: Array.from({ length: blockerCount }, () => ({
                typeName: "blocker",
                input: null,
              })),
            }),
          );

          const mainChains = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
            client.createChains({
              ...txCtx,
              txHooks,
              items: Array.from({ length: mainCount }, (_, i) => ({
                typeName: "main",
                input: { index: i },
                blockers: blockerChains,
              })),
            }),
          );

          for (const chain of mainChains) {
            const job = await client.getJob({ id: chain.id });
            assert.notEqual(job, undefined);
            assert.equal(job!.status, "blocked");
          }

          await withWorkerRunners([await workerRunner.start()], async () => {
            await allBlockersReady.promise;
            releaseBlockers.resolve();

            const results = await Promise.all(
              mainChains.map(async (chain) => client.awaitChain(chain, completionOptions)),
            );

            for (let i = 0; i < results.length; i++) {
              assert.deepEqual(results[i].output, { result: i });
            }
          });
        },
      },
    ],
  };
