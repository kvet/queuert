import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { retryUntilPasses } from "../../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { InvalidJobIdError } from "../../errors.ts";
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

export const chainsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "chains",
  cases: [
    {
      name: "handles chained jobs",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          linear: {
            entry: true;
            input: { value: number };
            continueWith: { typeName: "linear_next" };
          };
          linear_next: {
            input: { valueNext: number };
            continueWith: { typeName: "linear_next_next" };
          };
          linear_next_next: {
            input: { valueNextNext: number };
            output: { result: number };
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
                linear: {
                  attemptHandler: async ({ job, complete }) => {
                    assert.deepEqual(job.id, chain.id);
                    assert.deepEqual(job.chainId, chain.id);

                    return withCaseTransaction(stateAdapter, function* (txCtx) {
                      const completedJob = yield* step(
                        complete({
                          ...txCtx,
                          continueWith: {
                            typeName: "linear_next",
                            input: { valueNext: job.input.value + 1 },
                          },
                        }),
                      );
                      assert.equal(completedJob.continuedTo.typeName, "linear_next");
                      assert.equal(completedJob.continuedTo.status, "pending");
                      assert.deepEqual(completedJob.continuedTo.chainId, chain.id);
                      assert.equal(completedJob.status, "completed");
                      assert.equal(completedJob.continuedToId, completedJob.continuedTo.id);
                      return completedJob;
                    });
                  },
                },
                linear_next: {
                  attemptHandler: async ({ job, complete }) => {
                    assert.notDeepEqual(job.id, chain.id);
                    assert.deepEqual(job.chainId, chain.id);

                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: {
                          typeName: "linear_next_next",
                          input: { valueNextNext: job.input.valueNext + 1 },
                        },
                      }),
                    );
                  },
                },
                linear_next_next: {
                  attemptHandler: async ({ job, complete }) => {
                    assert.notDeepEqual(job.id, chain.id);
                    assert.deepEqual(job.chainId, chain.id);

                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          result: job.input.valueNextNext,
                        },
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
              typeName: "linear",
              input: { value: 1 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const finishedChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(finishedChain.output, { result: 3 });
      }),
    },
    {
      name: "handles branched chains",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          main: {
            entry: true;
            input: { value: number };
            continueWith: { typeName: "branch1" | "branch2" };
          };
          branch1: {
            input: { valueBranched: number };
            output: { result1: number };
          };
          branch2: {
            input: { valueBranched: number };
            output: { result2: number };
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
                main: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: {
                          typeName: job.input.value % 2 === 0 ? "branch1" : "branch2",
                          input: { valueBranched: job.input.value },
                        },
                      }),
                    ),
                },
                branch1: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          result1: job.input.valueBranched,
                        },
                      }),
                    ),
                },
                branch2: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          result2: job.input.valueBranched,
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const evenChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 2 },
            }),
          ),
        );
        const oddChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 3 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const [succeededJobEven, succeededJobOdd] = yield* wait(
          Promise.all([
            client.awaitChain(evenChain, completionOptions),
            client.awaitChain(oddChain, completionOptions),
          ]),
        );

        assert.deepEqual(succeededJobEven.output, { result1: 2 });
        assert.deepEqual(succeededJobOdd.output, { result2: 3 });
      }),
    },
    {
      name: "handles branched chains with different inputs",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          main: {
            entry: true;
            input: { value: number };
            continueWith: { typeName: "branch1" | "branch2" };
          };
          branch1: {
            input: { valueBranched1: number };
            output: { result: number };
          };
          branch2: {
            input: { valueBranched2: number };
            output: { result: number };
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
                main: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) => {
                      if (job.input.value % 2 === 0) {
                        return complete({
                          ...txCtx,
                          continueWith: {
                            typeName: "branch1",
                            input: { valueBranched1: job.input.value },
                          },
                        });
                      }
                      return complete({
                        ...txCtx,
                        continueWith: {
                          typeName: "branch2",
                          input: { valueBranched2: job.input.value },
                        },
                      });
                    }),
                },
                branch1: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          result: job.input.valueBranched1,
                        },
                      }),
                    ),
                },
                branch2: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          result: job.input.valueBranched2,
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const evenChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 2 },
            }),
          ),
        );
        const oddChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 3 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const [succeededJobEven, succeededJobOdd] = yield* wait(
          Promise.all([
            client.awaitChain(evenChain, completionOptions),
            client.awaitChain(oddChain, completionOptions),
          ]),
        );

        assert.deepEqual(succeededJobEven.output, { result: 2 });
        assert.deepEqual(succeededJobOdd.output, { result: 3 });
      }),
    },
    {
      name: "handles loops",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          loop: {
            entry: true;
            input: { counter: number };
            output: { done: true };
            continueWith: { typeName: "loop" };
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
                loop: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      job.input.counter < 3
                        ? complete({
                            ...txCtx,
                            continueWith: {
                              typeName: "loop",
                              input: { counter: job.input.counter + 1 },
                            },
                          })
                        : complete({ ...txCtx, output: { done: true } }),
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
              typeName: "loop",
              input: { counter: 0 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain(chain, completionOptions));
        assert.deepEqual(succeededChain.output, { done: true });
      }),
    },
    {
      name: "handles go-to",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          start: {
            entry: true;
            input: { value: number };
            continueWith: { typeName: "end" };
          };
          end: {
            input: { result: number };
            output: { finalResult: number };
            continueWith: { typeName: "start" };
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
                start: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: {
                          typeName: "end",
                          input: { result: job.input.value + 1 },
                        },
                      }),
                    ),
                },
                end: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) => {
                      if (job.input.result < 3) {
                        return complete({
                          ...txCtx,
                          continueWith: {
                            typeName: "start",
                            input: { value: job.input.result },
                          },
                        });
                      } else {
                        return complete({
                          ...txCtx,
                          output: { finalResult: job.input.result },
                        });
                      }
                    }),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "start",
              input: { value: 0 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain(chain, completionOptions));

        assert.deepEqual(succeededChain.output, { finalResult: 3 });
      }),
    },
    {
      name: "correctly types chainTypeName for jobs reachable from multiple chains",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          entryA: { entry: true; input: { fromA: true }; continueWith: { typeName: "shared" } };
          entryB: { entry: true; input: { fromB: true }; continueWith: { typeName: "shared" } };
          shared: { input: { data: number }; output: { done: true } };
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
                entryA: {
                  attemptHandler: async ({ job, complete }) => {
                    assert.equal(job.chainTypeName, "entryA");
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: { typeName: "shared", input: { data: 1 } },
                      }),
                    );
                  },
                },
                entryB: {
                  attemptHandler: async ({ job, complete }) => {
                    assert.equal(job.chainTypeName, "entryB");
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: { typeName: "shared", input: { data: 2 } },
                      }),
                    );
                  },
                },
                shared: {
                  attemptHandler: async ({ job, complete }) => {
                    assert.ok(["entryA", "entryB"].includes(job.chainTypeName));
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { done: true } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chainA = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "entryA",
              input: { fromA: true },
            }),
          ),
        );
        const chainB = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "entryB",
              input: { fromB: true },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const [resultA, resultB] = yield* wait(
          Promise.all([
            client.awaitChain(chainA, { pollIntervalMs: 100, timeoutMs: 5000 }),
            client.awaitChain(chainB, { pollIntervalMs: 100, timeoutMs: 5000 }),
          ]),
        );
        assert.deepEqual(resultA.output, { done: true });
        assert.deepEqual(resultB.output, { done: true });
      }),
    },
    {
      name: "independent chains created during job processing do not inherit context",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          parent: {
            entry: true;
            input: { value: number };
            output: { childChainId: string };
          };
          independent: {
            entry: true;
            input: { fromParent: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const independentChainCreated = Promise.withResolvers<string>();

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                parent: {
                  attemptHandler: async ({ job, complete }) => {
                    const independentChain = await withCaseTransaction(stateAdapter, (txCtx) =>
                      client.createChain({
                        ...txCtx,
                        typeName: "independent",
                        input: { fromParent: job.input.value },
                      }),
                    );

                    independentChainCreated.resolve(independentChain.id);

                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          childChainId: independentChain.id,
                        },
                      }),
                    );
                  },
                },
                independent: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        output: {
                          result: job.input.fromParent * 2,
                        },
                      }),
                    ),
                },
              },
            }),
          }),
        );

        const parentChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "parent",
              input: { value: 42 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const [completedParent] = yield* wait(
          Promise.all([
            client.awaitChain(parentChain, completionOptions),
            (async () =>
              client.awaitChain(
                { id: await independentChainCreated.promise, typeName: "independent" },
                completionOptions,
              ))(),
          ]),
        );

        assert.equal(
          completedParent.output.childChainId,
          yield* wait(independentChainCreated.promise),
        );
      }),
    },
    {
      name: "continueWith accepts caller-supplied id",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          step1: { entry: true; input: null; continueWith: { typeName: "step2" } };
          step2: { input: null; output: { id: string } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const userId = stateAdapter.config.generateJobId();

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                step1: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({
                        ...txCtx,
                        continueWith: { typeName: "step2", id: userId, input: null },
                      }),
                    ),
                },
                step2: {
                  attemptHandler: async ({ job, complete }) => {
                    assert.equal(job.id, userId);
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { id: job.id } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "step1", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        const finished = yield* wait(client.awaitChain(chain, completionOptions));
        assert.deepEqual(finished.output, { id: userId });
      }),
    },
    {
      name: "continueWith rejects caller-supplied id that fails validateJobId",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          step1: { entry: true; input: null; continueWith: { typeName: "step2" } };
          step2: { input: null; output: null };
        }>();

        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            config: { ...stateAdapter.config, validateJobId: (id) => id !== "bad-id" },
          },
          notifyAdapter,
          jobTypes,
        });

        let continueWithError: unknown;
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                step1: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, function* (txCtx) {
                      try {
                        return yield* step(
                          complete({
                            ...txCtx,
                            continueWith: { typeName: "step2", id: "bad-id", input: null },
                          }),
                        );
                      } catch (err) {
                        continueWithError = err;
                        throw err;
                      }
                    }),
                },
                step2: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
              },
            }),
          }),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "step1", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          retryUntilPasses(
            async () => {
              assert.ok(continueWithError instanceof InvalidJobIdError);
            },
            { timeoutMs: 5000, intervalMs: 25 },
          ),
        );

        assert.ok(continueWithError instanceof InvalidJobIdError);
        assert.equal(continueWithError.source, "caller");
        assert.equal(continueWithError.id, "bad-id");
      }),
    },
    {
      name: "continueWith duplicate caller-supplied id errors",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          step1: { entry: true; input: null; continueWith: { typeName: "step2" } };
          step2: { input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const sharedId = stateAdapter.config.generateJobId();
        let collisionOccurred = false;

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                step1: {
                  backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) => {
                      if (job.attempt > 1) {
                        collisionOccurred = true;
                        return complete({
                          ...txCtx,
                          continueWith: { typeName: "step2", input: null },
                        });
                      }
                      return complete({
                        ...txCtx,
                        continueWith: { typeName: "step2", id: sharedId, input: null },
                      });
                    }),
                },
                step2: {
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    ),
                },
              },
            }),
          }),
        );

        const chain1 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "step1", input: null }),
          ),
        );

        const chain2 = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "step1", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain1, completionOptions));
        yield* wait(client.awaitChain(chain2, completionOptions));

        assert.equal(collisionOccurred, true);
      }),
    },
  ],
};
