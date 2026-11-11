import assert from "node:assert/strict";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { retryUntilPasses } from "../../conformance/retry-until-passes.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { ChainNotFoundError } from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker-runner.ts";
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
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 42 },
          }),
        );

        assert.equal(chain.typeName, "test");
        assert.deepEqual(chain.input, { value: 42 });
        assert.equal(chain.status, "running");
        const initialJob = await client.getJob({ id: chain.id });
        assert.equal(initialJob!.status, "pending");
        assert.equal(chain.deduplicated, false);
      },
    },
    {
      name: "createChain > creates a chain with deduplication",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const first = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "dup-key", scope: "running" },
          }),
        );

        const second = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "dup-key", scope: "running" },
          }),
        );

        assert.equal(first.deduplicated, false);
        assert.equal(second.deduplicated, true);
        assert.equal(second.id, first.id);
      },
    },
    {
      name: "createChain > creates a chain with blockers",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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

        const dep = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "dependency",
            input: null,
          }),
        );

        const main = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "main",
            input: { value: 1 },
            blockers: [dep],
          }),
        );

        assert.equal(main.status, "running");

        const mainJob = await client.getJob({ id: main.id });
        assert.equal(mainJob!.status, "blocked");
      },
    },
    {
      name: "createChain > rejects a blocker id that does not name a chain head and persists nothing",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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

        const dep = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "dependency",
            input: null,
          }),
        );
        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...dep,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "dependency") {
                await completeJob(job, async ({ complete }) =>
                  complete({ continueWith: { typeName: "dependencyStep", input: null } }),
                );
              }
            },
          }),
        );
        const depJobs = await client.listChainJobs({ chainId: dep.id, limit: 10 });
        const continuationId = depJobs.items[1].id;

        for (const blockerId of [crypto.randomUUID(), continuationId]) {
          await assert.rejects(
            async () =>
              withCaseTransaction(stateAdapter, async (txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "main",
                  input: null,
                  blockers: [{ ...dep, id: blockerId }],
                }),
              ),
            ChainNotFoundError,
          );
        }

        const staleBlocker = { ...dep, id: crypto.randomUUID() };
        const staleBlockerError = await withCaseTransaction(stateAdapter, async (txCtx) => {
          try {
            await client.createChain({
              ...txCtx,
              typeName: "main",
              input: null,
              blockers: [dep, staleBlocker],
            });
            return undefined;
          } catch (error) {
            return error;
          }
        });
        assert.ok(staleBlockerError instanceof ChainNotFoundError);

        const mainJobs = await stateAdapter.listJobs({
          typeName: "main",
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        assert.deepEqual(mainJobs.items, []);

        const start = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({ ...txCtx, typeName: "start", input: null }),
        );
        const continuationErrors: unknown[] = [];
        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.completeChain({
            ...txCtx,
            ...start,
            handler: async ({ job, completeJob }) => {
              if (job.typeName !== "start") return;
              try {
                await completeJob(job, async ({ complete }) =>
                  complete({
                    continueWith: {
                      typeName: "startStep",
                      input: null,
                      blockers: [staleBlocker],
                    },
                  }),
                );
              } catch (error) {
                continuationErrors.push(error);
              }
            },
          }),
        );
        assert.equal(continuationErrors.length, 1);
        assert.ok(continuationErrors[0] instanceof ChainNotFoundError);

        const startJobs = await client.listChainJobs({ chainId: start.id, limit: 10 });
        assert.equal(startJobs.items.length, 1);
        assert.equal(startJobs.items[0].status, "pending");
        const blockedJobs = await stateAdapter.listBlockedJobs({
          chainId: dep.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        assert.deepEqual(blockedJobs.items, []);
      },
    },
    {
      name: "createChain > creates a chain with scheduling",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: null,
            schedule: { afterMs: 60_000 },
          }),
        );

        assert.equal(chain.status, "running");
        const scheduledJob = await client.getJob({ id: chain.id });
        assert.equal(scheduledJob!.status, "pending");
      },
    },
    {
      name: "createChain > throws when called without transaction context",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        await assert.rejects(
          async () =>
            // @ts-expect-error missing txCtx
            client.createChain({ typeName: "test", input: { value: 1 } }),
          /requires a transaction context/,
        );
      },
    },
    {
      name: "createChain > throws when the context is not in a transaction",
      run: async ({ createStateAdapter, createNotifyAdapter, withNonTransactionContext }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        await assert.rejects(
          async () =>
            withNonTransactionContext(async (txCtx) =>
              client.createChain({
                ...txCtx,
                typeName: "test",
                input: { value: 1 },
              }),
            ),
          /not in a transaction/,
        );

        const chains = await client.listChains({ typeName: "test" });
        assert.equal(chains.items.length, 0);
      },
    },
    {
      name: "createChain > uses caller-supplied id",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const userId = stateAdapter.config.generateJobId();
        const chain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            id: userId,
            input: { value: 1 },
          }),
        );

        assert.equal(chain.id, userId);
        assert.equal(chain.deduplicated, false);
      },
    },
    {
      name: "createChains > creates multiple chains in a single batch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "test", input: { value: 1 } },
              { typeName: "test", input: { value: 2 } },
              { typeName: "test", input: { value: 3 } },
            ],
          }),
        );

        assert.equal(chains.length, 3);
        for (let i = 0; i < 3; i++) {
          assert.equal(chains[i].typeName, "test");
          assert.deepEqual(chains[i].input, { value: i + 1 });
          assert.equal(chains[i].status, "running");
          const initialJob = await client.getJob({ id: chains[i].id });
          assert.equal(initialJob!.status, "pending");
          assert.equal(chains[i].deduplicated, false);
        }

        const uniqueIds = new Set(chains.map((jc) => jc.id));
        assert.equal(uniqueIds.size, 3);
      },
    },
    {
      name: "createChains > returns empty array for empty batch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [],
          }),
        );

        assert.deepEqual(chains, []);
      },
    },
    {
      name: "createChains > handles deduplication in batch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const existingChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            input: { value: 100 },
            deduplication: { key: "existing-key", scope: "running" },
          }),
        );

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
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
        );

        assert.equal(chains.length, 2);
        assert.equal(chains[0].deduplicated, true);
        assert.equal(chains[0].id, existingChain.id);
        assert.equal(chains[1].deduplicated, false);
        assert.notEqual(chains[1].id, existingChain.id);
      },
    },
    {
      name: "createChains > handles batch with blockers",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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

        const depChain = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "dependency",
            input: null,
          }),
        );

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
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
        );

        assert.equal(chains.length, 2);
        assert.equal(chains[0].status, "running");
        assert.equal(chains[1].status, "running");

        const job0 = await client.getJob({ id: chains[0].id });
        const job1 = await client.getJob({ id: chains[1].id });
        assert.equal(job0!.status, "blocked");
        assert.equal(job1!.status, "blocked");
      },
    },
    {
      name: "createChains > handles batch with scheduling",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const futureDate = new Date(Date.now() + 60_000);
        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "test", input: { value: 1 }, schedule: { at: futureDate } },
              { typeName: "test", input: { value: 2 }, schedule: { afterMs: 30_000 } },
              { typeName: "test", input: { value: 3 } },
            ],
          }),
        );

        assert.equal(chains.length, 3);
        for (const jc of chains) {
          assert.equal(jc.status, "running");
          const job = await client.getJob({ id: jc.id });
          assert.equal(job!.status, "pending");
        }
      },
    },
    {
      name: "createChains > batch with mixed types",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          typeA: { entry: true; input: { a: number }; output: null };
          typeB: { entry: true; input: { b: string }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [chainA, chainB] = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "typeA", input: { a: 1 } },
              { typeName: "typeB", input: { b: "hello" } },
            ],
          }),
        );

        assert.equal(chainA.typeName, "typeA");
        assert.deepEqual(chainA.input, { a: 1 });
        assert.equal(chainB.typeName, "typeB");
        assert.deepEqual(chainB.input, { b: "hello" });
        assert.notEqual(chainB.id, chainA.id);
      },
    },
    {
      name: "createChains > batch with mix of blocked and unblocked chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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

        const dep = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "dependency",
            input: null,
          }),
        );

        const [blockedChain, unblockedChain] = await withCaseTransaction(
          stateAdapter,
          async (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "blocked", input: { value: 1 }, blockers: [dep] },
                { typeName: "unblocked", input: { value: 2 } },
              ],
            }),
        );

        assert.equal(blockedChain.status, "running");
        assert.equal(unblockedChain.status, "running");

        const blockedJob = await client.getJob({ id: blockedChain.id });
        const unblockedJob = await client.getJob({ id: unblockedChain.id });
        assert.equal(blockedJob!.status, "blocked");
        assert.equal(unblockedJob!.status, "pending");
      },
    },
    {
      name: "createChains > workers unblock and process batch-created blocked chains",
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

        const blocker = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "blocker",
            input: { value: 42 },
          }),
        );

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "main", input: { label: "A" }, blockers: [blocker] },
              { typeName: "main", input: { label: "B" }, blockers: [blocker] },
              { typeName: "main", input: { label: "C" }, blockers: [blocker] },
            ],
          }),
        );

        for (const chain of chains) {
          assert.equal(chain.status, "running");
          const job = await client.getJob({ id: chain.id });
          assert.equal(job!.status, "blocked");
        }

        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 3,
          processors: createProcessors({
            client,
            jobTypes,
            processors: {
              blocker: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: job.input.value } }),
                  ),
              },
              main: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
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
        });

        await workerRunner.start();
        const results = await Promise.all(
          chains.map(async (jc) => client.awaitChain(jc, completionOptions)),
        );
        for (const result of results) {
          assert.deepEqual(result.output, { finalResult: 42 });
        }
      },
    },
    {
      name: "createChains > workers process all batch-created chains",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "test", input: { value: 10 } },
              { typeName: "test", input: { value: 20 } },
              { typeName: "test", input: { value: 30 } },
            ],
          }),
        );

        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 3,
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

        await workerRunner.start();
        assert.deepEqual((await client.awaitChain(chains[0], completionOptions)).output, {
          result: 20,
        });
        assert.deepEqual((await client.awaitChain(chains[1], completionOptions)).output, {
          result: 40,
        });
        assert.deepEqual((await client.awaitChain(chains[2], completionOptions)).output, {
          result: 60,
        });
      },
    },
    {
      name: "createChains > throws when called without transaction context",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        await assert.rejects(
          async () =>
            // @ts-expect-error missing txCtx
            client.createChains({
              items: [{ typeName: "test", input: { value: 1 } }],
            }),
          /requires a transaction context/,
        );
      },
    },
    {
      name: "createChains > throws when the context is not in a transaction",
      run: async ({ createStateAdapter, createNotifyAdapter, withNonTransactionContext }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        await assert.rejects(
          async () =>
            withNonTransactionContext(async (txCtx) =>
              client.createChains({
                ...txCtx,
                items: [{ typeName: "test", input: { value: 1 } }],
              }),
            ),
          /not in a transaction/,
        );

        const chains = await client.listChains({ typeName: "test" });
        assert.equal(chains.items.length, 0);
      },
    },
    {
      name: "createChains > uses caller-supplied ids per item",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const idA = stateAdapter.config.generateJobId();
        const idB = stateAdapter.config.generateJobId();
        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: [
              { typeName: "test", id: idA, input: { value: 1 } },
              { typeName: "test", id: idB, input: { value: 2 } },
            ],
          }),
        );

        assert.equal(chains[0].id, idA);
        assert.equal(chains[1].id, idB);
      },
    },
    {
      name: "createChains > rejects caller-supplied id that fails validateJobId",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx) =>
              client.createChain({
                ...txCtx,
                typeName: "test",
                id: "bad-id",
                input: null,
              }),
            ),
          /Invalid job ID "bad-id" from caller/,
        );
      },
    },
    {
      name: "createChains > rejects generated id that fails validateJobId",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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

        await assert.rejects(
          async () =>
            withCaseTransaction(stateAdapter, async (txCtx) =>
              client.createChain({
                ...txCtx,
                typeName: "test",
                input: null,
              }),
            ),
          /Invalid job ID "bad-id" from generator/,
        );
      },
    },
    {
      name: "createChains > duplicate caller-supplied id errors",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const sharedId = stateAdapter.config.generateJobId();
        await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChain({
            ...txCtx,
            typeName: "test",
            id: sharedId,
            input: null,
          }),
        );

        await assert.rejects(async () =>
          withCaseTransaction(stateAdapter, async (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "test",
              id: sharedId,
              input: null,
            }),
          ),
        );
      },
    },
  ],
};

export const createChainsNotifyGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "create-chains",
  cases: [
    {
      name: "createChain > does not notify workers about a chain created blocked",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
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
        const dispose = await notifyAdapter.listenJobScheduled(
          ["dependency", "main", "sentinel"],
          (typeName) => notified.push(typeName),
        );
        try {
          const dep = await withCaseTransaction(stateAdapter, async (txCtx) =>
            client.createChain({ ...txCtx, typeName: "dependency", input: null }),
          );
          await withCaseTransaction(stateAdapter, async (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: null,
              blockers: [dep],
            }),
          );
          await withCaseTransaction(stateAdapter, async (txCtx) =>
            client.createChain({ ...txCtx, typeName: "sentinel", input: null }),
          );
          await retryUntilPasses(
            async () => {
              assert.ok(notified.includes("sentinel"));
            },
            { timeoutMs: 5000 },
          );

          assert.ok(notified.includes("dependency"));
          assert.ok(!notified.includes("main"));
        } finally {
          await dispose();
        }
      },
    },
  ],
};
