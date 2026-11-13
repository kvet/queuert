import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { inMode } from "../../conformance/adapters.ts";
import { retryUntilPasses } from "../../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { ChainNotFoundError } from "../../errors.ts";
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

export const createChainsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "create-chains",
  cases: [
    {
      name: "createChain > creates a single chain",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 42 },
            }),
          ),
        );

        assert.equal(chain.typeName, "test");
        assert.deepEqual(chain.input, { value: 42 });
        assert.equal(chain.status, "running");
        const initialJob = yield* step(client.getJob({ id: chain.id }));
        assert.equal(initialJob!.status, "pending");
        assert.equal(chain.deduplicated, false);
      }),
    },
    {
      name: "createChain > creates a chain with deduplication",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const first = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 1 },
              deduplication: { key: "dup-key", scope: "running" },
            }),
          ),
        );

        const second = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 2 },
              deduplication: { key: "dup-key", scope: "running" },
            }),
          ),
        );

        assert.equal(first.deduplicated, false);
        assert.equal(second.deduplicated, true);
        assert.equal(second.id, first.id);
      }),
    },
    {
      name: "createChain > creates a chain with blockers",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          dependency: { entry: true; input: null; output: null };
          main: {
            entry: true;
            input: { value: number };
            output: null;
            blockers: [{ typeName: "dependency" }];
          };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const dep = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "dependency",
              input: null,
            }),
          ),
        );

        const main = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 1 },
              blockers: [dep],
            }),
          ),
        );

        assert.equal(main.status, "running");

        const mainJob = yield* step(client.getJob({ id: main.id }));
        assert.equal(mainJob!.status, "blocked");
      }),
    },
    {
      name: "createChain > rejects a blocker id that does not name a chain head and persists nothing",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          dependency: {
            entry: true;
            input: null;
            output: null;
            continueWith: { typeName: "dependencyStep" };
          };
          dependencyStep: { input: null; output: null };
          main: {
            entry: true;
            input: null;
            output: null;
            blockers: { typeName: "dependency" }[];
          };
          start: {
            entry: true;
            input: null;
            output: null;
            continueWith: { typeName: "startStep" };
          };
          startStep: {
            input: null;
            output: null;
            blockers: [{ typeName: "dependency" }];
          };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const dep = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "dependency",
              input: null,
            }),
          ),
        );
        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...dep,
              handler: ({ job, completeJob }) =>
                job.typeName === "dependency"
                  ? completeJob(job, ({ complete }) =>
                      complete({ continueWith: { typeName: "dependencyStep", input: null } }),
                    )
                  : undefined,
            }),
          ),
        );
        const depJobs = yield* step(client.listChainJobs({ chainId: dep.id, limit: 10 }));
        const continuationId = depJobs.items[1].id;

        for (const blockerId of [crypto.randomUUID(), continuationId]) {
          yield* step(
            assertRejects(
              () =>
                withCaseTransaction(stateAdapter, (txCtx) =>
                  client.createChain({
                    ...txCtx,
                    typeName: "main",
                    input: null,
                    blockers: [{ ...dep, id: blockerId }],
                  }),
                ),
              ChainNotFoundError,
            ),
          );
        }

        const staleBlocker = { ...dep, id: crypto.randomUUID() };
        const staleBlockerError = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            try {
              yield* step(
                client.createChain({
                  ...txCtx,
                  typeName: "main",
                  input: null,
                  blockers: [dep, staleBlocker],
                }),
              );
              return undefined;
            } catch (error) {
              return error;
            }
          }),
        );
        assert.ok(staleBlockerError instanceof ChainNotFoundError);

        const mainJobs = yield* step(
          stateAdapter.listJobs({
            typeName: "main",
            orderBy: "createdAt",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(mainJobs.items, []);

        const start = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "start", input: null }),
          ),
        );
        const continuationErrors: unknown[] = [];
        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.completeChain({
              ...txCtx,
              ...start,
              handler: ({ job, completeJob }) =>
                inMode(stateAdapter, function* () {
                  if (job.typeName !== "start") return;
                  try {
                    yield* step(
                      completeJob(job, ({ complete }) =>
                        complete({
                          continueWith: {
                            typeName: "startStep",
                            input: null,
                            blockers: [staleBlocker],
                          },
                        }),
                      ),
                    );
                  } catch (error) {
                    continuationErrors.push(error);
                  }
                }),
            }),
          ),
        );
        assert.equal(continuationErrors.length, 1);
        assert.ok(continuationErrors[0] instanceof ChainNotFoundError);

        const startJobs = yield* step(client.listChainJobs({ chainId: start.id, limit: 10 }));
        assert.equal(startJobs.items.length, 1);
        assert.equal(startJobs.items[0].status, "pending");
        const blockedJobs = yield* step(
          stateAdapter.listBlockedJobs({
            chainId: dep.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(blockedJobs.items, []);
      }),
    },
    {
      name: "createChain > creates a chain with scheduling",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: null,
              schedule: { afterMs: 60_000 },
            }),
          ),
        );

        assert.equal(chain.status, "running");
        const scheduledJob = yield* step(client.getJob({ id: chain.id }));
        assert.equal(scheduledJob!.status, "pending");
      }),
    },
    {
      name: "createChain > throws when called without transaction context",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        yield* step(
          assertRejects(
            () =>
              // @ts-expect-error missing txCtx
              client.createChain({ typeName: "test", input: { value: 1 } }),
            /requires a transaction context/,
          ),
        );
      }),
    },
    {
      name: "createChain > throws when the context is not in a transaction",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        yield* step(
          assertRejects(
            () =>
              context.withNonTransactionContext((txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "test",
                  input: { value: 1 },
                }),
              ),
            /not in a transaction/,
          ),
        );

        const chains = yield* step(client.listChains({ typeName: "test" }));
        assert.equal(chains.items.length, 0);
      }),
    },
    {
      name: "createChain > uses caller-supplied id",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const userId = stateAdapter.config.generateJobId();
        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              id: userId,
              input: { value: 1 },
            }),
          ),
        );

        assert.equal(chain.id, userId);
        assert.equal(chain.deduplicated, false);
      }),
    },
    {
      name: "createChains > creates multiple chains in a single batch",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: { value: 1 } },
                { typeName: "test", input: { value: 2 } },
                { typeName: "test", input: { value: 3 } },
              ],
            }),
          ),
        );

        assert.equal(chains.length, 3);
        for (let i = 0; i < 3; i++) {
          assert.equal(chains[i].typeName, "test");
          assert.deepEqual(chains[i].input, { value: i + 1 });
          assert.equal(chains[i].status, "running");
          const initialJob = yield* step(client.getJob({ id: chains[i].id }));
          assert.equal(initialJob!.status, "pending");
          assert.equal(chains[i].deduplicated, false);
        }

        const uniqueIds = new Set(chains.map((jc) => jc.id));
        assert.equal(uniqueIds.size, 3);
      }),
    },
    {
      name: "createChains > returns empty array for empty batch",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [],
            }),
          ),
        );

        assert.deepEqual(chains, []);
      }),
    },
    {
      name: "createChains > handles deduplication in batch",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const existingChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              input: { value: 100 },
              deduplication: { key: "existing-key", scope: "running" },
            }),
          ),
        );

        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                {
                  typeName: "test",
                  input: { value: 1 },
                  deduplication: { key: "existing-key", scope: "running" },
                },
                {
                  typeName: "test",
                  input: { value: 2 },
                  deduplication: { key: "new-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(chains.length, 2);
        assert.equal(chains[0].deduplicated, true);
        assert.equal(chains[0].id, existingChain.id);
        assert.equal(chains[1].deduplicated, false);
        assert.notEqual(chains[1].id, existingChain.id);
      }),
    },
    {
      name: "createChains > handles batch with blockers",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          dependency: { entry: true; input: null; output: null };
          main: {
            entry: true;
            input: { value: number };
            output: null;
            blockers: [{ typeName: "dependency" }];
          };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const depChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "dependency",
              input: null,
            }),
          ),
        );

        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                {
                  typeName: "main",
                  input: { value: 1 },
                  blockers: [depChain],
                },
                {
                  typeName: "main",
                  input: { value: 2 },
                  blockers: [depChain],
                },
              ],
            }),
          ),
        );

        assert.equal(chains.length, 2);
        assert.equal(chains[0].status, "running");
        assert.equal(chains[1].status, "running");

        const job0 = yield* step(client.getJob({ id: chains[0].id }));
        const job1 = yield* step(client.getJob({ id: chains[1].id }));
        assert.equal(job0!.status, "blocked");
        assert.equal(job1!.status, "blocked");
      }),
    },
    {
      name: "createChains > handles batch with scheduling",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const futureDate = new Date(Date.now() + 60_000);
        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: { value: 1 }, schedule: { at: futureDate } },
                { typeName: "test", input: { value: 2 }, schedule: { afterMs: 30_000 } },
                { typeName: "test", input: { value: 3 } },
              ],
            }),
          ),
        );

        assert.equal(chains.length, 3);
        for (const jc of chains) {
          assert.equal(jc.status, "running");
          const job = yield* step(client.getJob({ id: jc.id }));
          assert.equal(job!.status, "pending");
        }
      }),
    },
    {
      name: "createChains > batch with mixed types",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          typeA: { entry: true; input: { a: number }; output: null };
          typeB: { entry: true; input: { b: string }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [chainA, chainB] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "typeA", input: { a: 1 } },
                { typeName: "typeB", input: { b: "hello" } },
              ],
            }),
          ),
        );

        assert.equal(chainA.typeName, "typeA");
        assert.deepEqual(chainA.input, { a: 1 });
        assert.equal(chainB.typeName, "typeB");
        assert.deepEqual(chainB.input, { b: "hello" });
        assert.notEqual(chainB.id, chainA.id);
      }),
    },
    {
      name: "createChains > batch with mix of blocked and unblocked chains",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          dependency: { entry: true; input: null; output: null };
          blocked: {
            entry: true;
            input: { value: number };
            output: null;
            blockers: [{ typeName: "dependency" }];
          };
          unblocked: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const dep = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "dependency",
              input: null,
            }),
          ),
        );

        const [blockedChain, unblockedChain] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "blocked", input: { value: 1 }, blockers: [dep] },
                { typeName: "unblocked", input: { value: 2 } },
              ],
            }),
          ),
        );

        assert.equal(blockedChain.status, "running");
        assert.equal(unblockedChain.status, "running");

        const blockedJob = yield* step(client.getJob({ id: blockedChain.id }));
        const unblockedJob = yield* step(client.getJob({ id: unblockedChain.id }));
        assert.equal(blockedJob!.status, "blocked");
        assert.equal(unblockedJob!.status, "pending");
      }),
    },
    {
      name: "createChains > workers unblock and process batch-created blocked chains",
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

        const blocker = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "blocker",
              input: { value: 42 },
            }),
          ),
        );

        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "main", input: { label: "A" }, blockers: [blocker] },
                { typeName: "main", input: { label: "B" }, blockers: [blocker] },
                { typeName: "main", input: { label: "C" }, blockers: [blocker] },
              ],
            }),
          ),
        );

        for (const chain of chains) {
          assert.equal(chain.status, "running");
          const job = yield* step(client.getJob({ id: chain.id }));
          assert.equal(job!.status, "blocked");
        }

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 3,
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

        yield* wait(workerRunner.start());
        const results = yield* wait(
          Promise.all(chains.map(async (jc) => client.awaitChain(jc, completionOptions))),
        );
        for (const result of results) {
          assert.deepEqual(result.output, { finalResult: 42 });
        }
      }),
    },
    {
      name: "createChains > workers process all batch-created chains",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: { value: 10 } },
                { typeName: "test", input: { value: 20 } },
                { typeName: "test", input: { value: 30 } },
              ],
            }),
          ),
        );

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 3,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    ),
                },
              },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        assert.deepEqual((yield* wait(client.awaitChain(chains[0], completionOptions))).output, {
          result: 20,
        });
        assert.deepEqual((yield* wait(client.awaitChain(chains[1], completionOptions))).output, {
          result: 40,
        });
        assert.deepEqual((yield* wait(client.awaitChain(chains[2], completionOptions))).output, {
          result: 60,
        });
      }),
    },
    {
      name: "createChains > throws when called without transaction context",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        yield* step(
          assertRejects(
            () =>
              // @ts-expect-error missing txCtx
              client.createChains({
                items: [{ typeName: "test", input: { value: 1 } }],
              }),
            /requires a transaction context/,
          ),
        );
      }),
    },
    {
      name: "createChains > throws when the context is not in a transaction",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        yield* step(
          assertRejects(
            () =>
              context.withNonTransactionContext((txCtx) =>
                client.createChains({
                  ...txCtx,
                  items: [{ typeName: "test", input: { value: 1 } }],
                }),
              ),
            /not in a transaction/,
          ),
        );

        const chains = yield* step(client.listChains({ typeName: "test" }));
        assert.equal(chains.items.length, 0);
      }),
    },
    {
      name: "createChains > uses caller-supplied ids per item",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const idA = stateAdapter.config.generateJobId();
        const idB = stateAdapter.config.generateJobId();
        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", id: idA, input: { value: 1 } },
                { typeName: "test", id: idB, input: { value: 2 } },
              ],
            }),
          ),
        );

        assert.equal(chains[0].id, idA);
        assert.equal(chains[1].id, idB);
      }),
    },
    {
      name: "createChains > rejects caller-supplied id that fails validateJobId",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            config: { ...stateAdapter.config, validateJobId: (id) => id !== "bad-id" },
          },
          notifyAdapter,
          jobTypes,
        });

        yield* step(
          assertRejects(
            () =>
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "test",
                  id: "bad-id",
                  input: null,
                }),
              ),
            /Invalid job ID "bad-id" from caller/,
          ),
        );
      }),
    },
    {
      name: "createChains > rejects generated id that fails validateJobId",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({
          stateAdapter: {
            ...stateAdapter,
            config: {
              ...stateAdapter.config,
              generateJobId: () => "bad-id",
              validateJobId: (id) => id !== "bad-id",
            },
          },
          notifyAdapter,
          jobTypes,
        });

        yield* step(
          assertRejects(
            () =>
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "test",
                  input: null,
                }),
              ),
            /Invalid job ID "bad-id" from generator/,
          ),
        );
      }),
    },
    {
      name: "createChains > duplicate caller-supplied id errors",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const sharedId = stateAdapter.config.generateJobId();
        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              id: sharedId,
              input: null,
            }),
          ),
        );

        yield* step(
          assertRejects(() =>
            withCaseTransaction(stateAdapter, (txCtx) =>
              client.createChain({
                ...txCtx,
                typeName: "test",
                id: sharedId,
                input: null,
              }),
            ),
          ),
        );
      }),
    },
  ],
};

export const createChainsNotifyGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "create-chains",
  cases: [
    {
      name: "createChain > does not notify workers about a chain created blocked",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          dependency: { entry: true; input: null; output: null };
          main: {
            entry: true;
            input: null;
            output: null;
            blockers: [{ typeName: "dependency" }];
          };
          sentinel: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const notified: string[] = [];
        const dispose = yield* step(
          notifyAdapter.listenJobScheduled(["dependency", "main", "sentinel"], (typeName) =>
            notified.push(typeName),
          ),
        );
        try {
          const dep = yield* step(
            withCaseTransaction(stateAdapter, (txCtx) =>
              client.createChain({ ...txCtx, typeName: "dependency", input: null }),
            ),
          );
          yield* step(
            withCaseTransaction(stateAdapter, (txCtx) =>
              client.createChain({
                ...txCtx,
                typeName: "main",
                input: null,
                blockers: [dep],
              }),
            ),
          );
          yield* step(
            withCaseTransaction(stateAdapter, (txCtx) =>
              client.createChain({ ...txCtx, typeName: "sentinel", input: null }),
            ),
          );
          yield* wait(
            retryUntilPasses(
              async () => {
                assert.ok(notified.includes("sentinel"));
              },
              { timeoutMs: 5000 },
            ),
          );

          assert.ok(notified.includes("dependency"));
          assert.ok(!notified.includes("main"));
        } finally {
          yield* step(dispose());
        }
      }),
    },
  ],
};
