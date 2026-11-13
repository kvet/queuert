import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { andThen } from "@queuert/helpers/maybe-promise";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import type { AttemptMiddleware } from "../../attempt-middleware/attempt-middleware.ts";
import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { retryUntilPasses } from "../../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { Chain } from "../../entities/chain.ts";
import { JobAlreadyCompletedError, JobTakenByAnotherWorkerError } from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import {
  omitProcessors,
  pickProcessors,
} from "../../job-type-processors/pick-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createSpyStateAdapter } from "../support/spy-state-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

export const workerGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "worker",
  cases: [
    {
      name: "picks up job that was added while it was offline",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { test: boolean };
            output: { result: boolean };
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
                test: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.test } }),
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
              input: { test: true },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completedChain = yield* wait(client.awaitChain(chain, completionOptions));
        assert.deepEqual(completedChain.output, { result: true });
      }),
    },
    {
      name: "processes multiple job types with proper gauge attribution",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const processedTypes: string[] = [];

        const jobTypes = defineJobTypes<{
          email: { entry: true; input: { to: string }; output: { sent: boolean } };
          sms: { entry: true; input: { phone: string }; output: { sent: boolean } };
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
                email: {
                  attemptHandler: async ({ complete }) => {
                    processedTypes.push("email");
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { sent: true } }),
                    );
                  },
                },
                sms: {
                  attemptHandler: async ({ complete }) => {
                    processedTypes.push("sms");
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { sent: true } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const emailChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "email",
              input: { to: "test@example.com" },
            }),
          ),
        );
        const smsChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "sms",
              input: { phone: "+1234567890" },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          Promise.all([
            client.awaitChain(emailChain, completionOptions),
            client.awaitChain(smsChain, completionOptions),
          ]),
        );

        assert.ok(processedTypes.includes("email"));
        assert.ok(processedTypes.includes("sms"));
        assert.equal(processedTypes.length, 2);
      }),
    },
    {
      name: "splits registries across workers with pickProcessors and omitProcessors",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const processed: string[] = [];

        const imageJobTypes = defineJobTypes<{
          "images.resize": { entry: true; input: null; output: null };
          "images.notify": { entry: true; input: null; output: null };
        }>();
        const billingJobTypes = defineJobTypes<{
          "billing.charge": { entry: true; input: null; output: null };
        }>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes: [imageJobTypes, billingJobTypes],
        });

        const traceMiddleware: AttemptMiddleware<any, { trace: string }> = {
          wrapHandler: async ({ next }) => next({ trace: "trace-1" }),
        };
        const imageProcessors = createProcessors({
          client,
          jobTypes: imageJobTypes,
          attemptMiddleware: [traceMiddleware],
          processors: {
            "images.resize": {
              attemptHandler: async ({ job, trace, complete }) => {
                processed.push(`${job.typeName}:${trace}`);
                return withCaseTransaction(stateAdapter, (txCtx) =>
                  complete({ ...txCtx, output: null }),
                );
              },
            },
            "images.notify": {
              attemptHandler: async ({ job, trace, complete }) => {
                processed.push(`${job.typeName}:${trace}`);
                return withCaseTransaction(stateAdapter, (txCtx) =>
                  complete({ ...txCtx, output: null }),
                );
              },
            },
          },
        });
        const billingProcessors = createProcessors({
          client,
          jobTypes: billingJobTypes,
          processors: {
            "billing.charge": {
              attemptHandler: async ({ job, complete }) => {
                processed.push(job.typeName);
                return withCaseTransaction(stateAdapter, (txCtx) =>
                  complete({ ...txCtx, output: null }),
                );
              },
            },
          },
        });

        const dedicatedWorkerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: [
              pickProcessors(imageProcessors, ["images.resize"]),
              pickProcessors(billingProcessors, ["billing.charge"]),
            ],
          }),
        );
        const restWorkerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: omitProcessors(imageProcessors, ["images.resize"]),
          }),
        );

        const [resizeChain, chargeChain, notifyChain] = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            const resize = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "images.resize",
                input: null,
              }),
            );
            const charge = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "billing.charge",
                input: null,
              }),
            );
            const notify = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "images.notify",
                input: null,
              }),
            );
            return [resize, charge, notify] as const;
          }),
        );

        yield* wait(restWorkerRunner.start());
        yield* wait(client.awaitChain(notifyChain, completionOptions));
        yield* wait(restWorkerRunner.close());
        assert.deepEqual(processed, ["images.notify:trace-1"]);
        assert.equal((yield* step(client.getChain({ id: resizeChain.id })))?.status, "running");
        assert.equal((yield* step(client.getChain({ id: chargeChain.id })))?.status, "running");

        yield* wait(dedicatedWorkerRunner.start());
        yield* wait(
          Promise.all([
            client.awaitChain(resizeChain, completionOptions),
            client.awaitChain(chargeChain, completionOptions),
          ]),
        );
        yield* wait(dedicatedWorkerRunner.close());
        assert.deepEqual(processed.toSorted(), [
          "billing.charge",
          "images.notify:trace-1",
          "images.resize:trace-1",
        ]);
      }),
    },
    {
      name: "picks up job that is added while it is online",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { test: boolean };
            output: { result: boolean };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
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
                      complete({ ...txCtx, output: { result: job.input.test } }),
                    ),
                },
              },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { test: true },
            }),
          ),
        );

        const completedChain = yield* wait(client.awaitChain(chain, completionOptions));
        assert.deepEqual(completedChain.output, { result: true });
      }),
    },
    {
      name: "processes jobs in order",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const processedJobs: number[] = [];

        const jobTypes = defineJobTypes<{
          test: {
            entry: true;
            input: { jobNumber: number };
            output: { success: boolean };
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
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    processedJobs.push(job.input.jobNumber);
                    await sleep(10);

                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { success: true } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains: Chain<string, "test", { jobNumber: number }, { success: boolean }>[] = [];
        for (let i = 0; i < 5; i++) {
          chains.push(
            yield* step(
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "test",
                  input: { jobNumber: i },
                }),
              ),
            ),
          );
        }

        yield* wait(workerRunner.start());
        yield* wait(
          Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions))),
        );
        yield* wait(workerRunner.close());

        assert.deepEqual(processedJobs, [0, 1, 2, 3, 4]);
      }),
    },
    {
      name: "composes registry-level wrapHandler onion with typed ctx",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const order: string[] = [];
        const observed: { trace?: string; audit?: string; jobTypeName?: string }[] = [];

        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const traceMiddleware: AttemptMiddleware<any, { trace: string }> = {
          wrapHandler: async ({ job, next }) => {
            order.push("mw1-before");
            observed.push({ jobTypeName: job.typeName });
            const result = await next({ trace: "trace-1" });
            order.push("mw1-after");
            return result;
          },
        };
        const auditMiddleware: AttemptMiddleware<any, { audit: string }> = {
          wrapHandler: async ({ next }) => {
            order.push("mw2-before");
            const result = await next({ audit: "audit-1" });
            order.push("mw2-after");
            return result;
          },
        };
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              attemptMiddleware: [traceMiddleware, auditMiddleware],
              processors: {
                test: {
                  attemptHandler: async ({ trace, audit, complete }) => {
                    order.push("process");
                    observed.push({ trace, audit });
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
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
              typeName: "test",
              input: { value: 42 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));
        yield* wait(workerRunner.close());

        assert.deepEqual(order, ["mw1-before", "mw2-before", "process", "mw2-after", "mw1-after"]);
        assert.deepEqual(observed, [
          { jobTypeName: "test" },
          { trace: "trace-1", audit: "audit-1" },
        ]);
      }),
    },
    {
      name: "surfaces handler failures to wrapHandler",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const order: string[] = [];

        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const failureMiddleware: AttemptMiddleware<any> = {
          wrapHandler: async ({ next }) => {
            try {
              const result = await next({});
              order.push("handler-resolved");
              return result;
            } catch (error) {
              order.push(`handler-caught:${(error as Error).message}`);
              throw error;
            }
          },
        };
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              attemptMiddleware: [failureMiddleware],
              processors: {
                test: {
                  backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
                  attemptHandler: async ({ job, complete }) => {
                    if (job.attempt === 1) throw new Error("handler-failure");

                    return withCaseTransaction(stateAdapter, (txCtx) => {
                      if (job.attempt === 2) throw new Error("transaction-failure");
                      return complete({ ...txCtx, output: null });
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
              typeName: "test",
              input: { value: 1 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));
        yield* wait(workerRunner.close());

        assert.deepEqual(order, [
          "handler-caught:handler-failure",
          "handler-caught:transaction-failure",
          "handler-resolved",
        ]);
      }),
    },
    {
      name: "aborts in-flight job signal when worker stops and still allows complete",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const { promise: handlerStarted, resolve: onHandlerStarted } =
          Promise.withResolvers<void>();

        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
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
                test: {
                  attemptHandler: async ({ signal, complete }) => {
                    onHandlerStarted();
                    await new Promise<void>((resolve) => {
                      if (signal.aborted) {
                        resolve();
                        return;
                      }
                      signal.addEventListener(
                        "abort",
                        () => {
                          resolve();
                        },
                        { once: true },
                      );
                    });
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
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
              typeName: "test",
              input: null,
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(handlerStarted);
        yield* wait(workerRunner.stop());

        const completedChain = yield* wait(client.awaitChain(chain, completionOptions));
        assert.equal(completedChain.status, "completed");
      }),
    },
    {
      name: "throws from complete when the attempt is lost after the worker stops",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const handlerStarted = Promise.withResolvers<void>();
        const handlerAborted = Promise.withResolvers<void>();
        const chainCompletedExternally = Promise.withResolvers<void>();

        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { source: string } };
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
                test: {
                  attemptHandler: async ({ signal, complete }) => {
                    handlerStarted.resolve();
                    await new Promise<void>((resolve) => {
                      signal.addEventListener(
                        "abort",
                        () => {
                          resolve();
                        },
                        { once: true },
                      );
                    });
                    handlerAborted.resolve();
                    await chainCompletedExternally.promise;

                    await assertRejects(
                      () =>
                        withCaseTransaction(stateAdapter, (txCtx) =>
                          complete({ ...txCtx, output: { source: "worker" } }),
                        ),
                      JobAlreadyCompletedError,
                    );
                    throw new Error("attempt lost");
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
              typeName: "test",
              input: null,
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(handlerStarted.promise);
        const stopped = workerRunner.stop();
        yield* wait(handlerAborted.promise);

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...chain,
              handler: ({ job, completeJob }) =>
                completeJob(job, ({ complete }) => complete({ output: { source: "external" } })),
            }),
          ),
        );
        chainCompletedExternally.resolve();
        yield* wait(stopped);

        const completedChain = yield* wait(client.awaitChain(chain, completionOptions));
        assert.deepEqual(completedChain.output, { source: "external" });
      }),
    },
    {
      name: "does not poll for a start delay while every slot is busy",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          slow: {
            entry: true;
            input: null;
            output: null;
          };
        }>();

        let startAttemptDelayCalls = 0;
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            getStartAttemptDelayMs: (params) => {
              startAttemptDelayCalls++;
              return stateAdapter.getStartAttemptDelayMs(params);
            },
          },
          notifyAdapter,
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                slow: {
                  attemptHandler: async ({ complete }) => {
                    await sleep(200);
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: Array.from({ length: 3 }, () => ({ typeName: "slow" as const, input: null })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions))),
        );
        yield* wait(workerRunner.close());

        assert.ok(startAttemptDelayCalls <= 10);
      }),
    },
    {
      name: "fills every idle slot with a single acquisition",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const spyStateAdapter = createSpyStateAdapter(stateAdapter);
        const client = createClient({ stateAdapter: spyStateAdapter, notifyAdapter, jobTypes });

        const concurrency = 4;
        let startedCount = 0;
        const allStarted = Promise.withResolvers<void>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ complete }) => {
                    if (++startedCount === concurrency) allStarted.resolve();
                    await allStarted.promise;
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            const created = [];
            for (let i = 0; i < concurrency; i++) {
              created.push(
                yield* step(client.createChain({ ...txCtx, typeName: "test", input: null })),
              );
            }
            return created;
          }),
        );

        yield* wait(workerRunner.start());
        yield* wait(allStarted.promise);
        assert.equal(
          spyStateAdapter.calls.filter((call) => call.name === "startJobAttempts").length,
          1,
        );
        yield* wait(
          Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions))),
        );
      }),
    },
    {
      name: "completes an attempt that outlives the lease duration",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const leaseConfig = { durationMs: 300, heartbeatMs: 50 };
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            leaseConfig,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ signal, complete }) => {
                    await sleep(leaseConfig.durationMs * 2);
                    assert.equal(signal.aborted, false);
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: chain.id })), {
          status: "completed",
          attempt: 1,
        });
      }),
    },
    {
      name: "registers under the configured workerId",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerId = stateAdapter.config.generateWorkerId();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            workerId,
            processors: createProcessors({
              client,
              jobTypes,
              processors: { test: { attemptHandler: async () => undefined as never } },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          retryUntilPasses(async () => {
            assert.notEqual(await client.getWorker({ id: workerId }), undefined);
          }),
        );
      }),
    },
    {
      name: "registers under the state adapter's generateWorkerId by default",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const workerId = stateAdapter.config.generateWorkerId();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            config: { ...stateAdapter.config, generateWorkerId: () => workerId },
          },
          notifyAdapter,
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            processors: createProcessors({
              client,
              jobTypes,
              processors: { test: { attemptHandler: async () => undefined as never } },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          retryUntilPasses(async () => {
            assert.notEqual(await client.getWorker({ id: workerId }), undefined);
          }),
        );
      }),
    },
    {
      name: "deletes its worker row on stop",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerId = stateAdapter.config.generateWorkerId();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            workerId,
            processors: createProcessors({
              client,
              jobTypes,
              processors: { test: { attemptHandler: async () => undefined as never } },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          retryUntilPasses(async () => {
            assert.notEqual(await client.getWorker({ id: workerId }), undefined);
          }),
        );
        yield* wait(workerRunner.close());

        assert.equal(yield* step(client.getWorker({ id: workerId })), undefined);
      }),
    },
    {
      name: "reclaims the job of an expired worker with a worker of another type and rejects its late `fence` and `complete`",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
          other: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const leaseLosingClient = createClient({
          stateAdapter: { ...stateAdapter, extendWorkerLease: async () => undefined },
          notifyAdapter,
          jobTypes,
        });

        const jobStarted = Promise.withResolvers<void>();
        const handlerReleased = Promise.withResolvers<void>();
        const lateComplete = Promise.withResolvers<unknown>();

        const leaseLosingWorkerRunner = yield* resource(
          createWorkerRunner({
            client: leaseLosingClient,
            leaseConfig: { durationMs: 200, heartbeatMs: 50 },
            processors: createProcessors({
              client: leaseLosingClient,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ complete, fence }) => {
                    jobStarted.resolve();
                    await handlerReleased.promise;
                    await assertRejects(async () => {
                      await withCaseTransaction(stateAdapter, function* (txCtx) {
                        yield* step(fence({ ...txCtx }));
                      });
                    }, JobTakenByAnotherWorkerError);
                    try {
                      return await withCaseTransaction(stateAdapter, (txCtx) =>
                        complete({ ...txCtx, output: null }),
                      );
                    } catch (error) {
                      lateComplete.resolve(error);
                      throw error;
                    }
                  },
                },
                other: { attemptHandler: async () => undefined as never },
              },
            }),
          }),
        );
        const otherTypeWorkerRunner = yield* resource(
          createWorkerRunner({
            client,
            pollIntervalMs: 20,
            processors: pickProcessors(
              createProcessors({
                client,
                jobTypes,
                processors: {
                  test: { attemptHandler: async () => undefined as never },
                  other: { attemptHandler: async () => undefined as never },
                },
              }),
              ["other"],
            ),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(leaseLosingWorkerRunner.start());
        yield* wait(jobStarted.promise);
        yield* wait(otherTypeWorkerRunner.start());
        yield* wait(
          retryUntilPasses(
            async () => {
              const job = await client.getJob({ id: chain.id });
              assert.equal(job?.status, "pending");
              assert.match(String(job.lastAttemptError), /JobAttemptReclaimedError/);
            },
            { intervalMs: 20, timeoutMs: 5000 },
          ),
        );
        yield* wait(otherTypeWorkerRunner.close());
        handlerReleased.resolve();
        assert.ok((yield* wait(lateComplete.promise)) instanceof JobTakenByAnotherWorkerError);
      }),
    },
    {
      name: "aborts its attempts when it loses its lease and restarts under the same id",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const firstRenewal = new AbortController();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            extendWorkerLease: ((params) => {
              if (firstRenewal.signal.aborted) return stateAdapter.extendWorkerLease(params);
              firstRenewal.abort();
              return undefined;
            }) as EndToEndStateAdapter["extendWorkerLease"],
          },
          notifyAdapter,
          jobTypes,
        });
        const workerId = stateAdapter.config.generateWorkerId();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            workerId,
            leaseConfig: { durationMs: 200, heartbeatMs: 50 },
            recoveryBackoffConfig: { initialDelayMs: 20, multiplier: 1, maxDelayMs: 20 },
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, signal, complete }) => {
                    if (job.attempt === 1) {
                      await new Promise((resolve) => {
                        signal.addEventListener("abort", resolve, { once: true });
                      });
                      throw new Error("aborted by the lost lease");
                    }
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: chain.id })), {
          status: "completed",
          attempt: 2,
          completedBy: workerId,
        });
      }),
    },
    {
      name: "waits for a live worker holding its id to expire, then reclaims its job and starts",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const leaseLosingClient = createClient({
          stateAdapter: { ...stateAdapter, extendWorkerLease: async () => undefined },
          notifyAdapter,
          jobTypes,
        });
        const workerId = stateAdapter.config.generateWorkerId();
        const jobStarted = Promise.withResolvers<void>();
        const handlerReleased = Promise.withResolvers<void>();

        const leaseLosingWorkerRunner = yield* resource(
          createWorkerRunner({
            client: leaseLosingClient,
            workerId,
            leaseConfig: { durationMs: 200, heartbeatMs: 50 },
            processors: createProcessors({
              client: leaseLosingClient,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async () => {
                    jobStarted.resolve();
                    await handlerReleased.promise;
                    throw new Error("released after the job was reclaimed");
                  },
                },
              },
            }),
          }),
        );
        const sameIdWorkerRunner = yield* resource(
          createWorkerRunner({
            client,
            workerId,
            recoveryBackoffConfig: { initialDelayMs: 20, multiplier: 1, maxDelayMs: 20 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
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
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(leaseLosingWorkerRunner.start());
        yield* wait(jobStarted.promise);
        yield* wait(sameIdWorkerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));
        yield* wait(sameIdWorkerRunner.close());
        handlerReleased.resolve();
        yield* wait(leaseLosingWorkerRunner.close());

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: chain.id })), {
          status: "completed",
          attempt: 2,
          completedBy: workerId,
        });
      }),
    },
    {
      name: "keeps the row of the registration that replaced a frozen registration under the same id",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const frozenClient = createClient({
          stateAdapter: {
            ...stateAdapter,
            extendWorkerLease: async ({ txCtx, workerId }) =>
              (await stateAdapter.getWorkers({ txCtx, workerIds: [workerId] }))[0],
          },
          notifyAdapter,
          jobTypes,
        });
        const workerId = stateAdapter.config.generateWorkerId();
        const jobStarted = Promise.withResolvers<void>();

        const frozenWorkerRunner = yield* resource(
          createWorkerRunner({
            client: frozenClient,
            workerId,
            leaseConfig: { durationMs: 200, heartbeatMs: 50 },
            recoveryBackoffConfig: { initialDelayMs: 20, multiplier: 1, maxDelayMs: 20 },
            processors: createProcessors({
              client: frozenClient,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ signal }) => {
                    jobStarted.resolve();
                    await new Promise((resolve) => {
                      signal.addEventListener("abort", resolve, { once: true });
                    });
                    throw new Error("aborted");
                  },
                },
              },
            }),
          }),
        );
        const sameIdWorkerRunner = yield* resource(
          createWorkerRunner({
            client,
            workerId,
            recoveryBackoffConfig: { initialDelayMs: 20, multiplier: 1, maxDelayMs: 20 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
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
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(frozenWorkerRunner.start());
        yield* wait(jobStarted.promise);
        yield* wait(sameIdWorkerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));
        yield* wait(frozenWorkerRunner.stop());

        assert.partialDeepStrictEqual(yield* step(client.getWorker({ id: workerId })), {
          id: workerId,
        });

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: chain.id })), {
          status: "completed",
          attempt: 2,
          completedBy: workerId,
        });
      }),
    },
    {
      name: "reclaims its own job left running by a failed reschedule once it is idle",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const firstReschedule = new AbortController();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            rescheduleJobs: (params) => {
              if (firstReschedule.signal.aborted) return stateAdapter.rescheduleJobs(params);
              firstReschedule.abort();
              throw new Error("database unreachable");
            },
          },
          notifyAdapter,
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            pollIntervalMs: 20,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    if (job.attempt === 1) throw new Error("fails before completing");
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: chain.id })), {
          status: "completed",
          attempt: 2,
        });
      }),
    },
    {
      name: "reclaims its own job claimed by a claim that committed but threw once it is idle",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const firstClaim = new AbortController();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            startJobAttempts: (params) => {
              if (firstClaim.signal.aborted) return stateAdapter.startJobAttempts(params);
              firstClaim.abort();
              return andThen(stateAdapter.startJobAttempts(params), () => {
                throw new Error("connection lost after commit");
              });
            },
          },
          notifyAdapter,
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            pollIntervalMs: 20,
            recoveryBackoffConfig: { initialDelayMs: 10, multiplier: 1, maxDelayMs: 10 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
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
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: chain.id })), {
          status: "completed",
          attempt: 2,
        });
      }),
    },
    {
      name: "reclaims its own jobs at most once per heartbeat while idle",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const workerId = stateAdapter.config.generateWorkerId();
        let ownJobListings = 0;
        let idleIterations = 0;
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            listWorkerJobs: (params) => {
              if (params.workerId === workerId) ownJobListings += 1;
              return stateAdapter.listWorkerJobs(params);
            },
            getStartAttemptDelayMs: (params) => {
              idleIterations += 1;
              return stateAdapter.getStartAttemptDelayMs(params);
            },
          },
          notifyAdapter,
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            workerId,
            pollIntervalMs: 20,
            leaseConfig: { durationMs: 300_000, heartbeatMs: 60_000 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async () => {
                    throw new Error("not expected to run");
                  },
                },
              },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          retryUntilPasses(async () => {
            assert.ok(idleIterations >= 5);
          }),
        );
        assert.equal(ownJobListings, 1);
      }),
    },
    {
      name: "keeps a sibling slot's running attempt when an idle slot reclaims its own jobs",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { slow: boolean }; output: null };
        }>();

        const slowStarted = Promise.withResolvers<void>();
        const releaseSlow = Promise.withResolvers<void>();
        const fastCompleted = new AbortController();
        const reclaimPassed = Promise.withResolvers<void>();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            listWorkerJobs: ((params) =>
              andThen(stateAdapter.listWorkerJobs(params), (page) => {
                if (fastCompleted.signal.aborted) reclaimPassed.resolve();
                return page;
              })) as EndToEndStateAdapter["listWorkerJobs"],
          },
          notifyAdapter,
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 2,
            pollIntervalMs: 20,
            leaseConfig: { durationMs: 60_000, heartbeatMs: 20 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    if (job.input.slow) {
                      slowStarted.resolve();
                      await releaseSlow.promise;
                    }
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const slowChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: { slow: true } }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(slowStarted.promise);
        const fastChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { slow: false },
            }),
          ),
        );
        yield* wait(client.awaitChain(fastChain, completionOptions));
        fastCompleted.abort();
        yield* wait(reclaimPassed.promise);
        releaseSlow.resolve();
        yield* wait(client.awaitChain(slowChain, completionOptions));

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: slowChain.id })), {
          status: "completed",
          attempt: 1,
        });
      }),
    },
    {
      name: "keeps the running attempt of a chain recreated under the id of a chain it deleted",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { run: "deleted" | "recreated" }; output: null };
        }>();

        const deletedStarted = Promise.withResolvers<void>();
        const releaseDeleted = Promise.withResolvers<void>();
        const recreatedStarted = Promise.withResolvers<void>();
        const releaseRecreated = Promise.withResolvers<void>();
        const deletedFinished = new AbortController();
        const reclaimPassed = Promise.withResolvers<void>();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            listWorkerJobs: ((params) =>
              andThen(stateAdapter.listWorkerJobs(params), (page) => {
                if (deletedFinished.signal.aborted) reclaimPassed.resolve();
                return page;
              })) as EndToEndStateAdapter["listWorkerJobs"],
          },
          notifyAdapter,
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 2,
            pollIntervalMs: 20,
            leaseConfig: { durationMs: 60_000, heartbeatMs: 20 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    if (job.input.run === "deleted") {
                      deletedStarted.resolve();
                      await releaseDeleted.promise;
                      deletedFinished.abort();
                      throw new Error("chain was deleted");
                    }
                    recreatedStarted.resolve();
                    await releaseRecreated.promise;
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chainId = stateAdapter.config.generateJobId();
        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              id: chainId,
              input: { run: "deleted" },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(deletedStarted.promise);
        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.deleteChain({ ...txCtx, id: chainId }),
          ),
        );
        const recreatedChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              id: chainId,
              input: { run: "recreated" },
            }),
          ),
        );
        yield* wait(recreatedStarted.promise);
        releaseDeleted.resolve();
        yield* wait(reclaimPassed.promise);
        releaseRecreated.resolve();
        yield* wait(client.awaitChain(recreatedChain, completionOptions));

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: chainId })), {
          status: "completed",
          attempt: 1,
        });
      }),
    },
    {
      name: "applies the worker-level backoffConfig when the processor has none",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            pollIntervalMs: 20,
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) => {
                    if (job.attempt < 3) throw new Error("retry");
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: chain.id })), {
          status: "completed",
          attempt: 3,
        });
      }),
    },
    {
      name: "prefers the processor-level backoffConfig over the worker-level one",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            pollIntervalMs: 20,
            backoffConfig: { initialDelayMs: 60_000, multiplier: 1, maxDelayMs: 60_000 },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
                  attemptHandler: async ({ job, complete }) => {
                    if (job.attempt < 2) throw new Error("retry");
                    return withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, completionOptions));

        assert.partialDeepStrictEqual(yield* step(client.getJob({ id: chain.id })), {
          status: "completed",
          attempt: 2,
        });
      }),
    },
    {
      name: "registers with a 60s lease by default",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerId = stateAdapter.config.generateWorkerId();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            workerId,
            processors: createProcessors({
              client,
              jobTypes,
              processors: { test: { attemptHandler: async () => undefined as never } },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        yield* wait(
          retryUntilPasses(async () => {
            const registered = await client.getWorker({ id: workerId });
            assert.equal(
              registered && registered.leaseUntil.getTime() - registered.startedAt.getTime(),
              60_000,
            );
          }),
        );
      }),
    },
  ],
};
