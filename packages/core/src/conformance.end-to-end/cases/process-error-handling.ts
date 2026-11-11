import assert from "node:assert/strict";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter, EndToEndPoisonTransactionContext } from "../types.ts";

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};
const fastBackoff = { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 };

export const processErrorHandlingGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "process-error-handling",
  cases: [
    {
      name: "reschedules when handler throws before opening its transaction",
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
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                backoffConfig: fastBackoff,
                attemptHandler: async ({ job, complete }) => {
                  if (job.attempt === 1) {
                    throw new Error("Simulated handler error");
                  }
                  assert.ok(job.lastAttemptError?.includes("Error: Simulated handler error"));
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                  );
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 10 },
          }),
        );

        await workerRunner.start();
        const completed = await client.awaitChain(chain, completionOptions);
        assert.deepEqual(completed.output, { result: 20 });

        assert.equal((await client.getJob({ id: chain.id }))?.attempt, 2);
      },
    },
    {
      name: "reschedules when handler throws inside its transaction before complete",
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
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                backoffConfig: fastBackoff,
                attemptHandler: async ({ job, complete }) => {
                  if (job.attempt > 1) {
                    assert.ok(job.lastAttemptError?.includes("Error: Simulated handler error"));
                  }
                  return withCaseTransaction(stateAdapter, async (txCtx) => {
                    if (job.attempt === 1) {
                      throw new Error("Simulated handler error");
                    }
                    return complete({
                      ...txCtx,
                      output: { result: job.input.value * 2 },
                    });
                  });
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 10 },
          }),
        );

        await workerRunner.start();
        const completed = await client.awaitChain(chain, completionOptions);
        assert.deepEqual(completed.output, { result: 20 });

        assert.equal((await client.getJob({ id: chain.id }))?.attempt, 2);
      },
    },
    {
      name: "reschedules when handler throws inside its transaction after complete",
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
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                backoffConfig: fastBackoff,
                attemptHandler: async ({ job, complete }) => {
                  if (job.attempt > 1) {
                    assert.ok(job.lastAttemptError?.includes("Error: Error after complete"));
                  }
                  return withCaseTransaction(stateAdapter, async (txCtx) => {
                    const result = await complete({
                      ...txCtx,
                      output: { result: job.input.value * 2 },
                    });
                    if (job.attempt === 1) {
                      throw new Error("Error after complete");
                    }
                    return result;
                  });
                },
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 10 },
          }),
        );

        await workerRunner.start();
        const completed = await client.awaitChain(chain, completionOptions);
        assert.deepEqual(completed.output, { result: 20 });

        assert.equal((await client.getJob({ id: chain.id }))?.attempt, 2);
      },
    },
    {
      name: "reschedules when handler returns without calling complete",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: null;
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
            backoffConfig: fastBackoff,
            processors: {
              test: {
                // @ts-expect-error the handler must return what complete returned
                attemptHandler: async ({ job, complete }) => {
                  if (job.attempt === 1) {
                    return;
                  }
                  assert.ok(
                    job.lastAttemptError?.includes(
                      "Attempt handler returned without a committed `complete` call",
                    ),
                  );
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { done: true } }),
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
        await client.awaitChain(chain, completionOptions);

        assert.equal((await client.getJob({ id: chain.id }))?.attempt, 2);
      },
    },
    {
      name: "rolls back the continuation when handler throws after complete with continueWith inside its transaction",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          step1: {
            entry: true;
            input: { value: number };
            continueWith: { typeName: "step2" };
          };
          step2: {
            input: { value: number };
            output: { result: number };
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
              step1: {
                backoffConfig: fastBackoff,
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) => {
                    const result = await complete({
                      ...txCtx,
                      continueWith: { typeName: "step2", input: { value: job.input.value * 2 } },
                    });
                    if (job.attempt === 1) {
                      throw new Error("Error after complete with continueWith");
                    }
                    return result;
                  }),
              },
              step2: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: job.input.value } }),
                  ),
              },
            },
          }),
        });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "step1",
            input: { value: 10 },
          }),
        );

        await workerRunner.start();
        const completed = await client.awaitChain(chain, completionOptions);
        assert.deepEqual(completed.output, { result: 20 });

        assert.equal((await client.getJob({ id: chain.id }))?.attempt, 2);
        const jobs = await client.listChainJobs({ chainId: chain.id });
        assert.deepEqual(
          jobs.items.map((job) => job.typeName),
          ["step1", "step2"],
        );
      },
    },
    {
      name: "keeps the dependent blocked when the blocker handler throws after complete inside its transaction",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          blocker: {
            entry: true;
            input: { value: number };
            output: { done: true };
          };
          dependent: {
            entry: true;
            input: null;
            output: { result: string };
            blockers: [{ typeName: "blocker" }];
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
              blocker: {
                backoffConfig: fastBackoff,
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) => {
                    const result = await complete({
                      ...txCtx,
                      output: { done: true },
                    });
                    if (job.attempt === 1) {
                      throw new Error("Error after blocker complete");
                    }
                    return result;
                  }),
              },
              dependent: {
                attemptHandler: async ({ job, complete }) => {
                  const [blocker] = job.blockers;
                  assert.equal((await client.getJob({ id: blocker.id }))?.attempt, 2);
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: "ok" } }),
                  );
                },
              },
            },
          }),
        });

        const blockerChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "blocker",
            input: { value: 1 },
          }),
        );
        const dependentChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "dependent",
            input: null,
            blockers: [blockerChain],
          }),
        );

        await workerRunner.start();
        const completed = await client.awaitChain(dependentChain, completionOptions);
        assert.deepEqual(completed.output, { result: "ok" });
      },
    },
    {
      name: "serializes various error types in lastAttemptError",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: null;
            output: null;
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
                backoffConfig: fastBackoff,
                attemptHandler: async ({ job, complete }) => {
                  switch (job.attempt) {
                    case 1:
                      throw new Error("plain error");
                    case 2:
                      assert.ok(job.lastAttemptError?.includes("plain error"));
                      assert.match(job.lastAttemptError ?? "", /at\s/);
                      // oxlint-disable-next-line typescript/only-throw-error -- test intentionally throws non-Error values
                      throw { code: "ETIMEOUT", detail: "connection lost" };
                    case 3:
                      assert.ok(job.lastAttemptError?.includes("ETIMEOUT"));
                      assert.ok(job.lastAttemptError?.includes("connection lost"));
                      // oxlint-disable-next-line typescript/only-throw-error -- test intentionally throws non-Error values
                      throw "string error";
                    case 4:
                      assert.equal(job.lastAttemptError, "string error");
                      return withCaseTransaction(stateAdapter, async (txCtx) =>
                        complete({ ...txCtx, output: null }),
                      );
                    default:
                      throw new Error(`unexpected attempt ${job.attempt}`);
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
        await client.awaitChain(chain, completionOptions);
      },
    },
    {
      name: "completes when handler catches an error from its own transaction and then finishes",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: null;
            output: null;
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
                backoffConfig: fastBackoff,
                attemptHandler: async ({ job, complete }) => {
                  assert.equal(job.attempt, 1);
                  await assert.rejects(
                    async () =>
                      withCaseTransaction(stateAdapter, async () => {
                        throw new Error("transaction boom");
                      }),
                    /transaction boom/,
                  );
                  return withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: null }),
                  );
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
        await client.awaitChain(chain, completionOptions);
      },
    },
    {
      name: "reschedules with fractional backoff delays",
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
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              test: {
                backoffConfig: { initialDelayMs: 1.5, multiplier: 1.5, maxDelayMs: 10 },
                attemptHandler: async ({ job, complete }) => {
                  if (job.attempt < 3) {
                    throw new Error(`Simulated error on attempt ${job.attempt}`);
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
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 10 },
          }),
        );

        await workerRunner.start();
        const completed = await client.awaitChain(chain, completionOptions);
        assert.deepEqual(completed.output, { result: 20 });
      },
    },
  ],
};

export const processErrorHandlingPoisonTransactionGroup: ConformanceGroup<EndToEndPoisonTransactionContext> =
  {
    name: "process-error-handling",
    cases: [
      {
        name: "recovers when user code poisons its transaction before complete",
        run: async ({ createStateAdapter, createNotifyAdapter, poisonTransaction }) => {
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
          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  backoffConfig: fastBackoff,
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, async (txCtx) => {
                      if (job.attempt === 1) {
                        await poisonTransaction(txCtx);
                      }
                      return complete({
                        ...txCtx,
                        output: { result: job.input.value * 2 },
                      });
                    }),
                },
              },
            }),
          });

          const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 10 },
            }),
          );

          await workerRunner.start();
          const completed = await client.awaitChain(chain, completionOptions);
          assert.deepEqual(completed.output, { result: 20 });

          assert.equal((await client.getJob({ id: chain.id }))?.attempt, 2);
        },
      },
      {
        name: "recovers when user code poisons a separate transaction before complete",
        run: async ({ createStateAdapter, createNotifyAdapter, poisonTransaction }) => {
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
          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  backoffConfig: fastBackoff,
                  attemptHandler: async ({ job, complete }) => {
                    if (job.attempt === 1) {
                      await withCaseTransaction(stateAdapter, async (txCtx) => {
                        await poisonTransaction(txCtx);
                      });
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
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 10 },
            }),
          );

          await workerRunner.start();
          const completed = await client.awaitChain(chain, completionOptions);
          assert.deepEqual(completed.output, { result: 20 });
        },
      },
    ],
  };
