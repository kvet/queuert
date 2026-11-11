import assert from "node:assert/strict";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

export const deduplicationGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "deduplication",
  cases: [
    {
      name: "deduplicates chains with same deduplication key",
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

        const [chain1, chain2, chain3] = await withCaseTransaction(
          stateAdapter,
          async (txCtx, txHooks) => [
            await client.createChain({
              ...txCtx,
              txHooks,
              typeName: "test",
              input: { value: 1 },
              deduplication: { key: "same-key", scope: "running" },
            }),
            await client.createChain({
              ...txCtx,
              txHooks,
              typeName: "test",
              input: { value: 2 },
              deduplication: { key: "same-key", scope: "running" },
            }),
            await client.createChain({
              ...txCtx,
              txHooks,
              typeName: "test",
              input: { value: 3 },
              deduplication: { key: "different-key", scope: "running" },
            }),
          ],
        );

        assert.equal(chain1.deduplicated, false);
        assert.equal(chain2.deduplicated, true);
        assert.equal(chain2.id, chain1.id);
        assert.equal(chain3.deduplicated, false);
        assert.notEqual(chain3.id, chain1.id);

        const completed1 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...chain1,
            handler: async ({ job, completeJob }) => {
              return completeJob(job, async ({ complete }) =>
                complete({ output: { result: job.input.value } }),
              );
            },
          }),
        );

        const completed3 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...chain3,
            handler: async ({ job, completeJob }) => {
              return completeJob(job, async ({ complete }) =>
                complete({ output: { result: job.input.value } }),
              );
            },
          }),
        );

        assert.equal(completed1.status, "completed");
        assert.equal(completed3.status, "completed");
        assert.deepEqual(completed1.output, { result: 1 });
        assert.deepEqual(completed3.output, { result: 3 });

        const fetched2 = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.getChain({ ...txCtx, ...chain2 }),
        );
        assert.deepEqual("output" in fetched2! && fetched2.output, { result: 1 });
      },
    },
    {
      name: "scope 'running' deduplicates against multi-step chains that have continued",
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
            input: { continued: boolean };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain1 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "step1",
            input: { value: 1 },
            deduplication: { key: "multi-step-key", scope: "running" },
          }),
        );

        assert.equal(chain1.deduplicated, false);

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...chain1,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "step1") {
                await completeJob(job, async ({ complete }) =>
                  complete({ continueWith: { typeName: "step2", input: { continued: true } } }),
                );
              }
            },
          }),
        );

        const chain2 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "step1",
            input: { value: 2 },
            deduplication: { key: "multi-step-key", scope: "running" },
          }),
        );

        assert.equal(chain2.deduplicated, true);
        assert.equal(chain2.id, chain1.id);

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...chain1,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "step2") {
                return completeJob(job, async ({ complete }) =>
                  complete({ output: { result: 42 } }),
                );
              }
            },
          }),
        );

        const chain3 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "step1",
            input: { value: 3 },
            deduplication: { key: "multi-step-key", scope: "running" },
          }),
        );

        assert.equal(chain3.deduplicated, false);
        assert.notEqual(chain3.id, chain1.id);
      },
    },
    {
      name: "scope 'any' returns the output of a completed multi-step chain it matches",
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

        const chain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "step1",
            input: { value: 1 },
            deduplication: { key: "any-multi-step-key", scope: "any" },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...chain,
            handler: async ({ job, completeJob }) => {
              if (job.typeName === "step1") {
                job = await completeJob(job, async ({ complete }) =>
                  complete({ continueWith: { typeName: "step2", input: { value: 42 } } }),
                );
              }
              if (job.typeName === "step2") {
                return completeJob(job, async ({ complete }) =>
                  complete({ output: { result: job.input.value } }),
                );
              }
            },
          }),
        );

        const matched = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "step1",
            input: { value: 2 },
            deduplication: { key: "any-multi-step-key", scope: "any" },
          }),
        );

        assert.equal(matched.deduplicated, true);
        assert.equal(matched.id, chain.id);
        assert.equal(matched.status, "completed");
        assert.deepEqual("output" in matched && matched.output, { result: 42 });
      },
    },
    {
      name: "scope 'running' picks running chain when completed chain exists with same key",
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

        const chain1 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "coexist-key", scope: "running" },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...chain1,
            handler: async ({ job, completeJob }) => {
              return completeJob(job, async ({ complete }) => complete({ output: { result: 1 } }));
            },
          }),
        );

        const chain2 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "coexist-key", scope: "running" },
          }),
        );

        assert.equal(chain2.deduplicated, false);
        assert.notEqual(chain2.id, chain1.id);

        const chain3 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 3 },
            deduplication: { key: "coexist-key", scope: "running" },
          }),
        );

        assert.equal(chain3.deduplicated, true);
        assert.equal(chain3.id, chain2.id);
      },
    },
    {
      name: "deduplication scopes: 'any' vs 'running'",
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

        const allChain1 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "all-key", scope: "any" },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...allChain1,
            handler: async ({ job, completeJob }) => {
              await completeJob(job, async ({ complete }) =>
                complete({ output: { result: job.input.value } }),
              );
            },
          }),
        );

        const allChain2 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "all-key", scope: "any" },
          }),
        );

        assert.equal(allChain2.deduplicated, true);
        assert.equal(allChain2.id, allChain1.id);

        const completedChain1 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 3 },
            deduplication: { key: "completed-key", scope: "running" },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...completedChain1,
            handler: async ({ job, completeJob }) => {
              await completeJob(job, async ({ complete }) =>
                complete({ output: { result: job.input.value } }),
              );
            },
          }),
        );

        const completedChain2 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 4 },
            deduplication: { key: "completed-key", scope: "running" },
          }),
        );

        assert.equal(completedChain2.deduplicated, false);
        assert.notEqual(completedChain2.id, completedChain1.id);

        const completed2 = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...completedChain2,
            handler: async ({ job, completeJob }) => {
              return completeJob(job, async ({ complete }) =>
                complete({ output: { result: job.input.value } }),
              );
            },
          }),
        );
        assert.equal(completed2.status, "completed");
        assert.deepEqual(completed2.output, { result: 4 });
      },
    },
    {
      name: "does not deduplicate across different chain types with the same key",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          typeA: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          typeB: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [chainA, chainB] = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) => [
          await client.createChain({
            ...txCtx,
            txHooks,
            typeName: "typeA",
            input: { value: 1 },
            deduplication: { key: "shared-key", scope: "running" },
          }),
          await client.createChain({
            ...txCtx,
            txHooks,
            typeName: "typeB",
            input: { value: 2 },
            deduplication: { key: "shared-key", scope: "running" },
          }),
        ]);

        assert.equal(chainA.deduplicated, false);
        assert.equal(chainB.deduplicated, false);
        assert.notEqual(chainB.id, chainA.id);
      },
    },
    {
      name: "deduplicates within a batch",
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

        const [chain1, chain2, chain3] = await withCaseTransaction(
          stateAdapter,
          async (txCtx, txHooks) =>
            client.createChains({
              ...txCtx,
              txHooks,
              items: [
                {
                  typeName: "test",
                  input: { value: 1 },
                  deduplication: { key: "same-key", scope: "running" },
                },
                {
                  typeName: "test",
                  input: { value: 2 },
                  deduplication: { key: "same-key", scope: "running" },
                },
                {
                  typeName: "test",
                  input: { value: 3 },
                  deduplication: { key: "different-key", scope: "running" },
                },
              ],
            }),
        );

        assert.equal(chain1.deduplicated, false);
        assert.equal(chain2.deduplicated, true);
        assert.equal(chain2.id, chain1.id);
        assert.equal(chain3.deduplicated, false);
        assert.notEqual(chain3.id, chain1.id);
      },
    },
    {
      name: "deduplicates against pre-existing chains",
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

        const existing = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 100 },
            deduplication: { key: "existing-key", scope: "running" },
          }),
        );

        const [chain1, chain2] = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChains({
            ...txCtx,
            txHooks,
            items: [
              {
                typeName: "test",
                input: { value: 1 },
                deduplication: { key: "existing-key", scope: "running" },
              },
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "fresh-key", scope: "running" },
              },
            ],
          }),
        );

        assert.equal(chain1.deduplicated, true);
        assert.equal(chain1.id, existing.id);
        assert.equal(chain2.deduplicated, false);
        assert.notEqual(chain2.id, existing.id);
      },
    },
    {
      name: "deduplication scopes: 'any' vs 'running' in a createChains batch",
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

        const anyChain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "any-key", scope: "any" },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...anyChain,
            handler: async ({ job, completeJob }) => {
              await completeJob(job, async ({ complete }) =>
                complete({ output: { result: job.input.value } }),
              );
            },
          }),
        );

        const incompleteChain = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChain({
            ...txCtx,
            txHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "incomplete-key", scope: "running" },
          }),
        );

        await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.completeChain({
            ...txCtx,
            txHooks,
            ...incompleteChain,
            handler: async ({ job, completeJob }) => {
              await completeJob(job, async ({ complete }) =>
                complete({ output: { result: job.input.value } }),
              );
            },
          }),
        );

        const [anyResult, incompleteResult] = await withCaseTransaction(
          stateAdapter,
          async (txCtx, txHooks) =>
            client.createChains({
              ...txCtx,
              txHooks,
              items: [
                {
                  typeName: "test",
                  input: { value: 3 },
                  deduplication: { key: "any-key", scope: "any" },
                },
                {
                  typeName: "test",
                  input: { value: 4 },
                  deduplication: { key: "incomplete-key", scope: "running" },
                },
              ],
            }),
        );

        assert.equal(anyResult.deduplicated, true);
        assert.equal(anyResult.id, anyChain.id);
        assert.equal(incompleteResult.deduplicated, false);
        assert.notEqual(incompleteResult.id, incompleteChain.id);
      },
    },
    {
      name: "does not deduplicate across different chain types with the same key in a createChains batch",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          typeA: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
          typeB: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [chainA, chainB] = await withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
          client.createChains({
            ...txCtx,
            txHooks,
            items: [
              {
                typeName: "typeA",
                input: { value: 1 },
                deduplication: { key: "shared-key", scope: "running" },
              },
              {
                typeName: "typeB",
                input: { value: 2 },
                deduplication: { key: "shared-key", scope: "running" },
              },
            ],
          }),
        );

        assert.equal(chainA.deduplicated, false);
        assert.equal(chainB.deduplicated, false);
        assert.notEqual(chainB.id, chainA.id);
      },
    },
    {
      name: "rejects a missing or unknown deduplication scope",
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

        for (const deduplication of [{ key: "k" }, { key: "k", scope: "incomplete" }]) {
          await assert.rejects(
            async () =>
              withCaseTransaction(stateAdapter, async (txCtx, txHooks) =>
                client.createChain({
                  ...txCtx,
                  txHooks,
                  typeName: "test",
                  input: null,
                  deduplication: deduplication as any,
                }),
              ),
            /Invalid deduplication scope/,
          );
        }
      },
    },
  ],
};
