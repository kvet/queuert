import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { inMode } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { Chain } from "../../entities/chain.ts";
import { BlockerLimitExceededError, ChainTypeMismatchError } from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
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
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, complete }) => {
                    assert.deepEqual(job.chainId, blockerChainId);

                    return withCaseTransaction(stateAdapter, function* (txCtx) {
                      if (job.input.value < 1) {
                        return yield* step(
                          complete({
                            ...txCtx,
                            continueWith: {
                              typeName: "blocker",
                              input: { value: job.input.value + 1 },
                            },
                          }),
                        );
                      }
                      return yield* step(complete({ ...txCtx, output: { done: true } }));
                    });
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
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          finalResult: (blocker.output.done ? 1 : 0) + (input.start ? 1 : 0),
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            const dependencyChain = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "blocker",
                input: { value: 0 },
              }),
            );
            blockerChainId = dependencyChain.id;

            const chain = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "main",
                input: { start: true },
                blockers: [dependencyChain],
              }),
            );

            return chain;
          }),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(succeededChain.output, { finalResult: 2 });
      }),
    },
    {
      name: "handles completed blocker chains",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
                main: {
                  attemptHandler: async ({ job, complete }) => {
                    const [blocker] = job.blockers;

                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          finalResult: blocker.output.result,
                        },
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const blockerChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: { value: 1 },
            }),
          ),
        );
        const completedBlockerChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...blockerChain,
              handler: ({ job, completeJob }) =>
                completeJob(job, ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                ),
            }),
          ),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: null,
              blockers: [completedBlockerChain],
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(succeededChain.output, {
          finalResult: completedBlockerChain.output.result,
        });
      }),
    },
    {
      name: "rejects createChain declaring more blockers than the limit",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const blockerChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: null,
            }),
          ),
        );

        let error: unknown;
        try {
          yield* step(
            withCaseTransaction(stateAdapter, (txCtx) =>
              client.createChain({
                ...txCtx,
                typeName: "main",
                input: null,
                blockers: Array.from(
                  { length: stateAdapter.config.maxBlockersPerJob + 1 },
                  () => blockerChain,
                ),
              }),
            ),
          );
        } catch (caught) {
          error = caught;
        }
        assert.ok(error instanceof BlockerLimitExceededError);
        assert.equal(error.count, stateAdapter.config.maxBlockersPerJob + 1);
        assert.equal(error.limit, stateAdapter.config.maxBlockersPerJob);
        assert.equal(error.typeName, "main");
      }),
    },
    {
      name: "rejects continueWith declaring more blockers than the limit",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const blockerChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: null,
            }),
          ),
        );

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
                starter: {
                  backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
                  attemptHandler: async ({ job, complete }) => {
                    if (job.attempt === 1) {
                      return withCaseTransaction(stateAdapter, (txCtx) =>
                        complete({
                          ...txCtx,
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
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
                next: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "starter",
              input: null,
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));
      }),
    },
    {
      name: "independent chains spawned during processing do not inherit context",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                inner: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
                outer: {
                  attemptHandler: async ({ complete }) => {
                    await withCaseTransaction(stateAdapter, function* (txCtx) {
                      childChains.push(
                        yield* step(
                          client.createChain({
                            ...txCtx,
                            typeName: "inner",
                            input: null,
                          }),
                        ),
                      );
                    });

                    return withCaseTransaction(stateAdapter, function* (txCtx) {
                      childChains.push(
                        yield* step(
                          client.createChain({
                            ...txCtx,
                            typeName: "inner",
                            input: null,
                          }),
                        ),
                      );

                      return yield* step(complete({ ...txCtx, output: null }));
                    });
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "outer",
              input: null,
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));

        const succeededChildChains = yield* wait(
          Promise.all(
            childChains.map(async (chain) => client.awaitChain(chain, completionOptions)),
          ),
        );

        assert.equal(succeededChildChains.length, 2);
      }),
    },
    {
      name: "handles chains that are distributed across workers",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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
        const workerRunner1 = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 100,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: {
                          typeName: "finish",
                          input: { valueNext: job.input.value + 1 },
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );
        const workerRunner2 = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 100,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                finish: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: { result: job.input.valueNext + 1 },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
            }),
          ),
        );

        yield* wait(workerRunner1.start());
        yield* wait(workerRunner2.start());
        const finishedChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(finishedChain.output, { result: 3 });
      }),
    },
    {
      name: "handles multiple blocker chains",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
                main: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          finalResult: job.blockers.map((blocker) => blocker.output.result),
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            const blockerChains = yield* step(
              client.createChains({
                ...txCtx,
                items: Array.from({ length: 5 }, (_, i) => ({
                  typeName: "blocker",
                  input: { value: i + 1 },
                })),
              }),
            );
            return yield* step(
              client.createChain({
                ...txCtx,
                typeName: "main",
                input: null,
                blockers: blockerChains,
              }),
            );
          }),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(succeededChain.output, {
          finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
        });
      }),
    },
    {
      name: "continueWith supports blockers",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 10 } }),
                    ),
                },
                first: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, function* (txCtx) {
                      const blockerChain = yield* step(
                        client.createChain({
                          ...txCtx,
                          typeName: "blocker",
                          input: { value: 5 },
                        }),
                      );
                      return yield* step(
                        complete({
                          ...txCtx,
                          continueWith: {
                            typeName: "second",
                            input: { fromFirst: job.input.id },
                            blockers: [blockerChain],
                          },
                        }),
                      );
                    }),
                },
                second: {
                  attemptHandler: async ({ job, complete }) => {
                    const [blocker] = job.blockers;
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: { finalResult: blocker.output.result },
                      }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "first",
              input: { id: "test-123" },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(succeededChain.output, { finalResult: 50 });
      }),
    },
    {
      name: "continueWith accepts blockers by id and resolves them from the stored chain",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
                other: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
                first: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
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
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          sum: job.blockers.reduce(
                            (sum, blocker) => sum + blocker.output.result,
                            0,
                          ),
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const { blockerChain, otherChain } = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            const blockerChain = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "blocker",
                input: { value: 1 },
              }),
            );
            const otherChain = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "other",
                input: { value: 10 },
              }),
            );
            return { blockerChain, otherChain };
          }),
        );

        const mismatchChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "first",
              input: { blockerId: blockerChain.id, otherId: otherChain.id },
            }),
          ),
        );
        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...mismatchChain,
              handler: ({ job, completeJob }) =>
                inMode(stateAdapter, function* () {
                  if (job.typeName !== "first") return;
                  try {
                    yield* step(
                      completeJob(job, ({ complete }) => {
                        return complete({
                          continueWith: {
                            typeName: "second",
                            input: null,
                            blockers: [{ id: otherChain.id, typeName: "blocker" }],
                          },
                        });
                      }),
                    );
                  } catch (error) {
                    assert.ok(error instanceof ChainTypeMismatchError);
                    return;
                  }
                  throw new Error("Expected completeJob to throw ChainTypeMismatchError");
                }),
            }),
          ),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "first",
              input: { blockerId: blockerChain.id, otherId: otherChain.id },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(succeededChain.output, { sum: 11 });
      }),
    },
    {
      name: "accepts blockers by id and resolves them from the stored chain",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
                other: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
                main: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          sum: job.blockers.reduce(
                            (sum, blocker) => sum + blocker.output.result,
                            0,
                          ),
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const { blockerChain, otherChain } = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            const blockerChain = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "blocker",
                input: { value: 1 },
              }),
            );
            const otherChain = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "other",
                input: { value: 10 },
              }),
            );
            return { blockerChain, otherChain };
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: null,
              blockers: [
                { id: blockerChain.id },
                { id: otherChain.id, typeName: "other" },
                blockerChain,
              ],
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "main",
                  input: null,
                  blockers: [{ id: otherChain.id, typeName: "blocker" }],
                }),
              ),
            ChainTypeMismatchError,
          ),
        );

        yield* step(
          assertRejects(
            () =>
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "main",
                  input: null,
                  blockers: [{ ...otherChain, typeName: "blocker" as const }],
                }),
              ),
            ChainTypeMismatchError,
          ),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(succeededChain.output, { sum: 12 });
      }),
    },
    {
      name: "batch-creates multiple blocker chains",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
                main: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          finalResult: job.blockers.map((blocker) => blocker.output.result),
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            const blockerChains = yield* step(
              client.createChains({
                ...txCtx,
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
              }),
            );
            return yield* step(
              client.createChain({
                ...txCtx,
                typeName: "main",
                input: null,
                blockers: blockerChains,
              }),
            );
          }),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(succeededChain.output, {
          finalResult: Array.from({ length: 5 }, (_, i) => i + 1),
        });
      }),
    },
    {
      name: "batch-creates chains with shared blocker",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 2,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
                main: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          finalResult: job.blockers[0].output.result,
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const blocker = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: { value: 99 },
            }),
          ),
        );

        const [mainA, mainB] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "main", input: { label: "A" }, blockers: [blocker] },
                { typeName: "main", input: { label: "B" }, blockers: [blocker] },
              ],
            }),
          ),
        );

        assert.equal(mainA.status, "running");
        assert.equal(mainB.status, "running");

        const jobA = yield* step(client.getJob({ id: mainA.id }));
        const jobB = yield* step(client.getJob({ id: mainB.id }));
        assert.equal(jobA!.status, "blocked");
        assert.equal(jobB!.status, "blocked");

        yield* wait(workerRunner.start());
        const [resultA, resultB] = yield* wait(
          Promise.all([
            client.awaitChain(mainA, completionOptions),
            client.awaitChain(mainB, completionOptions),
          ]),
        );

        assert.deepEqual(resultA.output, { finalResult: 99 });
        assert.deepEqual(resultB.output, { finalResult: 99 });
      }),
    },
    {
      name: "handles duplicate blocker chain ids without breaking unblock",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 2,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
                main: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { done: true as const } }),
                    ),
                },
              },
            }),
          }),
        );

        const blockerChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: null,
            }),
          ),
        );

        const mainChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: null,
              blockers: [blockerChain, blockerChain, blockerChain],
            }),
          ),
        );

        const mainJob = yield* step(client.getJob({ id: mainChain.id }));
        assert.notEqual(mainJob, undefined);
        assert.equal(mainJob!.status, "blocked");

        yield* wait(workerRunner.start());
        const result = yield* wait(client.awaitChain(mainChain, completionOptions));
        assert.deepEqual(result.output, { done: true });
      }),
    },
    {
      name: "batch-creates chains that repeat blocker ids in different positions",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 2,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value } }),
                    ),
                },
                main: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: { results: job.blockers.map((blocker) => blocker.output.result) },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const [first, second] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "blocker", input: { value: 1 } },
                { typeName: "blocker", input: { value: 2 } },
              ],
            }),
          ),
        );

        const [mainA, mainB] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "main", input: null, blockers: [first, second] },
                { typeName: "main", input: null, blockers: [second, first, second] },
              ],
            }),
          ),
        );

        assert.equal((yield* step(client.getJob({ id: mainA.id })))!.status, "blocked");
        assert.equal((yield* step(client.getJob({ id: mainB.id })))!.status, "blocked");

        yield* wait(workerRunner.start());
        const [resultA, resultB] = yield* wait(
          Promise.all([
            client.awaitChain(mainA, completionOptions),
            client.awaitChain(mainB, completionOptions),
          ]),
        );
        assert.deepEqual(resultA.output, { results: [1, 2] });
        assert.deepEqual(resultB.output, { results: [2, 1, 2] });
      }),
    },
    {
      name: "raises scheduledAt to unblock time so blocked-since-creation jobs don't jump the queue",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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

        const mainChain = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            const blockerChain = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "blocker",
                input: null,
              }),
            );
            return yield* step(
              client.createChain({
                ...txCtx,
                typeName: "main",
                input: null,
                blockers: [blockerChain],
              }),
            );
          }),
        );

        const mainAtCreation = yield* step(client.getJob({ id: mainChain.id }));
        assert.notEqual(mainAtCreation, undefined);
        const creationScheduledAt = mainAtCreation!.scheduledAt.getTime();

        const workerRunner = yield* resource(
          createWorkerRunner({
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
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
                main: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
              },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        yield* wait(blockerHeld.promise);
        yield* wait(sleep(10));
        releaseBlocker.resolve();
        yield* wait(client.awaitChain(mainChain, completionOptions));

        const unblockedMain = yield* step(client.getJob({ id: mainChain.id }));
        assert.notEqual(unblockedMain, undefined);
        assert.ok(unblockedMain!.scheduledAt.getTime() > creationScheduledAt);
      }),
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
          await using stateAdapter = (await createStateAdapter()) as EndToEndStateAdapter;
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
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

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: blockerCount + mainCount,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                blocker: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, function* (txCtx) {
                      readyBlockers++;
                      if (readyBlockers === blockerCount) allBlockersReady.resolve();
                      yield* step(releaseBlockers.promise);
                      return complete({ ...txCtx, output: null });
                    }),
                },
                main: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.index } }),
                    ),
                },
              },
            }),
          });

          const blockerChains = await withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: Array.from({ length: blockerCount }, () => ({
                typeName: "blocker",
                input: null,
              })),
            }),
          );

          const mainChains = await withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
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

          await workerRunner.start();
          await allBlockersReady.promise;
          releaseBlockers.resolve();

          const results = await Promise.all(
            mainChains.map(async (chain) => client.awaitChain(chain, completionOptions)),
          );

          for (let i = 0; i < results.length; i++) {
            assert.deepEqual(results[i].output, { result: i });
          }
        },
      },
    ],
  };
