import { type TestAPI, describe } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { sleep } from "../helpers/sleep.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const deduplicationTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  describe("createChain", () => {
    it("deduplicates chains with the same key and keeps different keys apart", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [chain1, chain2, chain3] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) => [
          await client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "same-key", scope: "running" },
          }),
          await client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "same-key", scope: "running" },
          }),
          await client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 3 },
            deduplication: { key: "different-key", scope: "running" },
          }),
        ]),
      );

      expect(chain1.deduplicated).toBe(false);
      expect(chain2.deduplicated).toBe(true);
      expect(chain2.id).toBe(chain1.id);
      expect(chain3.deduplicated).toBe(false);
      expect(chain3.id).not.toBe(chain1.id);

      const completed1 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...chain1,
            complete: async ({ job, complete }) => {
              return complete(job, async () => ({ result: job.input.value }));
            },
          }),
        ),
      );

      const completed3 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...chain3,
            complete: async ({ job, complete }) => {
              return complete(job, async () => ({ result: job.input.value }));
            },
          }),
        ),
      );

      expect(completed1.output).toEqual({ result: 1 });
      expect(completed3.output).toEqual({ result: 3 });

      // chain2 was deduplicated to chain1, so it should have the same output
      const fetched2 = await withTransaction(async (txCtx) =>
        client.getChain({ ...txCtx, ...chain2 }),
      );
      expect("output" in fetched2! && fetched2.output).toEqual({ result: 1 });
    });

    it("does not deduplicate across chain types with the same key", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [chainA, chainB] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) => [
          await client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "typeA",
            input: { value: 1 },
            deduplication: { key: "shared-key", scope: "running" },
          }),
          await client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "typeB",
            input: { value: 2 },
            deduplication: { key: "shared-key", scope: "running" },
          }),
        ]),
      );

      expect(chainA.deduplicated).toBe(false);
      expect(chainB.deduplicated).toBe(false);
      expect(chainB.id).not.toBe(chainA.id);
    });

    it("scope 'any' matches completed chains while 'running' does not", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      log,
      observabilityAdapter,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const anyChain1 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "any-key", scope: "any" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...anyChain1,
            complete: async ({ job, complete }) => {
              await complete(job, async () => ({ result: job.input.value }));
            },
          }),
        ),
      );

      const anyChain2 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "any-key", scope: "any" },
          }),
        ),
      );

      expect(anyChain2.deduplicated).toBe(true);
      expect(anyChain2.id).toBe(anyChain1.id);

      const runningChain1 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 3 },
            deduplication: { key: "running-key", scope: "running" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...runningChain1,
            complete: async ({ job, complete }) => {
              await complete(job, async () => ({ result: job.input.value }));
            },
          }),
        ),
      );

      const runningChain2 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 4 },
            deduplication: { key: "running-key", scope: "running" },
          }),
        ),
      );

      expect(runningChain2.deduplicated).toBe(false);
      expect(runningChain2.id).not.toBe(runningChain1.id);
    });

    it("scope 'running' matches multi-step chains that have continued", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      log,
      observabilityAdapter,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const chain1 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "step1",
            input: { value: 1 },
            deduplication: { key: "multi-step-key", scope: "running" },
          }),
        ),
      );

      expect(chain1.deduplicated).toBe(false);

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...chain1,
            complete: async ({ job, complete }) => {
              if (job.typeName === "step1") {
                await complete(job, async ({ continueWith }) =>
                  continueWith({ typeName: "step2", input: { continued: true } }),
                );
              }
            },
          }),
        ),
      );

      const chain2 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "step1",
            input: { value: 2 },
            deduplication: { key: "multi-step-key", scope: "running" },
          }),
        ),
      );

      expect(chain2.deduplicated).toBe(true);
      expect(chain2.id).toBe(chain1.id);

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...chain1,
            complete: async ({ job, complete }) => {
              if (job.typeName === "step2") {
                return complete(job, async () => ({ result: 42 }));
              }
            },
          }),
        ),
      );

      const chain3 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "step1",
            input: { value: 3 },
            deduplication: { key: "multi-step-key", scope: "running" },
          }),
        ),
      );

      expect(chain3.deduplicated).toBe(false);
      expect(chain3.id).not.toBe(chain1.id);
    });

    it("scope 'running' picks the running chain when a completed one exists under the same key", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      log,
      observabilityAdapter,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const chain1 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "coexist-key", scope: "running" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...chain1,
            complete: async ({ job, complete }) => {
              return complete(job, async () => ({ result: 1 }));
            },
          }),
        ),
      );

      const chain2 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "coexist-key", scope: "running" },
          }),
        ),
      );

      expect(chain2.deduplicated).toBe(false);
      expect(chain2.id).not.toBe(chain1.id);

      const chain3 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 3 },
            deduplication: { key: "coexist-key", scope: "running" },
          }),
        ),
      );

      expect(chain3.deduplicated).toBe(true);
      expect(chain3.id).toBe(chain2.id);
    });

    it("windowMs limits deduplication to recent chains", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const anyChain1 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "any-key", scope: "any", windowMs: 50 },
          }),
        ),
      );

      expect(anyChain1.deduplicated).toBe(false);

      await sleep(100);

      const anyChain2 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "any-key", scope: "any", windowMs: 50 },
          }),
        ),
      );

      // Outside the window — the older occurrence is invisible.
      expect(anyChain2.deduplicated).toBe(false);
      expect(anyChain2.id).not.toBe(anyChain1.id);

      const anyChain3 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 3 },
            deduplication: { key: "any-key", scope: "any", windowMs: 60_000 },
          }),
        ),
      );

      // Inside a wide window — the newest occurrence is matched.
      expect(anyChain3.deduplicated).toBe(true);
      expect(anyChain3.id).toBe(anyChain2.id);

      const runningChain1 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 4 },
            deduplication: { key: "running-key", scope: "running", windowMs: 50 },
          }),
        ),
      );

      await sleep(100);

      const runningChain2 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 5 },
            deduplication: { key: "running-key", scope: "running", windowMs: 50 },
          }),
        ),
      );

      // Still running, but outside the window.
      expect(runningChain2.deduplicated).toBe(false);
      expect(runningChain2.id).not.toBe(runningChain1.id);
    });

    it("excludeChainIds skips the specified chains", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const chain1 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "exclude-key", scope: "running" },
          }),
        ),
      );

      expect(chain1.deduplicated).toBe(false);

      // Without excludeChainIds — deduplicates against chain1
      const chain2 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "exclude-key", scope: "running" },
          }),
        ),
      );

      expect(chain2.deduplicated).toBe(true);
      expect(chain2.id).toBe(chain1.id);

      // With excludeChainIds — skips chain1, creates new chain
      const chain3 = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 3 },
            deduplication: { key: "exclude-key", scope: "running", excludeChainIds: [chain1.id] },
          }),
        ),
      );

      expect(chain3.deduplicated).toBe(false);
      expect(chain3.id).not.toBe(chain1.id);
    });
  });

  describe("createChains", () => {
    it("deduplicates within a batch, against pre-existing chains, and keeps different keys apart", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const existing = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 100 },
            deduplication: { key: "existing-key", scope: "running" },
          }),
        ),
      );

      const [chain1, chain2, chain3, chain4] = await withTransactionHooks(
        async (transactionHooks) =>
          withTransaction(async (txCtx) =>
            client.createChains({
              ...txCtx,
              transactionHooks,
              items: [
                {
                  typeName: "test",
                  input: { value: 1 },
                  deduplication: { key: "existing-key", scope: "running" },
                },
                {
                  typeName: "test",
                  input: { value: 2 },
                  deduplication: { key: "same-key", scope: "running" },
                },
                {
                  typeName: "test",
                  input: { value: 3 },
                  deduplication: { key: "same-key", scope: "running" },
                },
                {
                  typeName: "test",
                  input: { value: 4 },
                  deduplication: { key: "different-key", scope: "running" },
                },
              ],
            }),
          ),
      );

      // Pre-existing chain.
      expect(chain1.deduplicated).toBe(true);
      expect(chain1.id).toBe(existing.id);
      // Fresh key within the batch.
      expect(chain2.deduplicated).toBe(false);
      expect(chain2.id).not.toBe(existing.id);
      // Same key as an earlier entry of the same batch.
      expect(chain3.deduplicated).toBe(true);
      expect(chain3.id).toBe(chain2.id);
      // Different key — untouched by the rest of the batch.
      expect(chain4.deduplicated).toBe(false);
      expect(chain4.id).not.toBe(chain2.id);
    });

    it("does not deduplicate across chain types with the same key", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [chainA, chainB, chainA2] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
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
              {
                typeName: "typeA",
                input: { value: 3 },
                deduplication: { key: "shared-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      expect(chainA.deduplicated).toBe(false);
      expect(chainB.deduplicated).toBe(false);
      expect(chainB.id).not.toBe(chainA.id);
      // The third entry collapses onto its own type's earlier entry, not onto typeB.
      expect(chainA2.deduplicated).toBe(true);
      expect(chainA2.id).toBe(chainA.id);
    });

    it("applies each entry's own scope", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      log,
      observabilityAdapter,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const anyChain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "any-key", scope: "any" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...anyChain,
            complete: async ({ job, complete }) => {
              await complete(job, async () => ({ result: job.input.value }));
            },
          }),
        ),
      );

      const runningChain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "running-key", scope: "running" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...runningChain,
            complete: async ({ job, complete }) => {
              await complete(job, async () => ({ result: job.input.value }));
            },
          }),
        ),
      );

      // Both keys point at completed chains: 'any' collapses, 'running' does not.
      const [anyResult, runningResult] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 3 },
                deduplication: { key: "any-key", scope: "any" },
              },
              {
                typeName: "test",
                input: { value: 4 },
                deduplication: { key: "running-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      expect(anyResult.deduplicated).toBe(true);
      expect(anyResult.id).toBe(anyChain.id);
      expect(runningResult.deduplicated).toBe(false);
      expect(runningResult.id).not.toBe(runningChain.id);
    });

    it("scope 'running' matches multi-step chains that have continued", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      log,
      observabilityAdapter,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [continued, plain] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "step1",
                input: { value: 1 },
                deduplication: { key: "multi-step-key", scope: "running" },
              },
              {
                typeName: "step1",
                input: { value: 2 },
                deduplication: { key: "single-step-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...continued,
            complete: async ({ job, complete }) => {
              if (job.typeName === "step1") {
                await complete(job, async ({ continueWith }) =>
                  continueWith({ typeName: "step2", input: { continued: true } }),
                );
              }
            },
          }),
        ),
      );

      const [onContinued, onPlain] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "step1",
                input: { value: 3 },
                deduplication: { key: "multi-step-key", scope: "running" },
              },
              {
                typeName: "step1",
                input: { value: 4 },
                deduplication: { key: "single-step-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      // A chain that moved on to its next step is still running.
      expect(onContinued.deduplicated).toBe(true);
      expect(onContinued.id).toBe(continued.id);
      expect(onPlain.deduplicated).toBe(true);
      expect(onPlain.id).toBe(plain.id);

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...continued,
            complete: async ({ job, complete }) => {
              if (job.typeName === "step2") {
                return complete(job, async () => ({ result: 42 }));
              }
            },
          }),
        ),
      );

      const [afterCompletion] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "step1",
                input: { value: 5 },
                deduplication: { key: "multi-step-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      expect(afterCompletion.deduplicated).toBe(false);
      expect(afterCompletion.id).not.toBe(continued.id);
    });

    it("scope 'running' picks the running chain when a completed one exists under the same key", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      log,
      observabilityAdapter,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const completedChain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "coexist-key", scope: "running" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...completedChain,
            complete: async ({ job, complete }) => {
              return complete(job, async () => ({ result: 1 }));
            },
          }),
        ),
      );

      const [fresh, onFresh] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "coexist-key", scope: "running" },
              },
              {
                typeName: "test",
                input: { value: 3 },
                deduplication: { key: "coexist-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      // The completed occurrence is invisible, the one created in this batch is not.
      expect(fresh.deduplicated).toBe(false);
      expect(fresh.id).not.toBe(completedChain.id);
      expect(onFresh.deduplicated).toBe(true);
      expect(onFresh.id).toBe(fresh.id);

      const [later] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 4 },
                deduplication: { key: "coexist-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      expect(later.deduplicated).toBe(true);
      expect(later.id).toBe(fresh.id);
    });

    it("applies each entry's own windowMs", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [oldNarrow, oldWide] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 1 },
                deduplication: { key: "narrow-key", scope: "any" },
              },
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "wide-key", scope: "any" },
              },
            ],
          }),
        ),
      );

      await sleep(100);

      const [narrow1, narrow2, wide] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 3 },
                deduplication: { key: "narrow-key", scope: "any", windowMs: 50 },
              },
              {
                typeName: "test",
                input: { value: 4 },
                deduplication: { key: "narrow-key", scope: "any", windowMs: 50 },
              },
              {
                typeName: "test",
                input: { value: 5 },
                deduplication: { key: "wide-key", scope: "any", windowMs: 60_000 },
              },
            ],
          }),
        ),
      );

      // Outside its own narrow window — the pre-existing chain is invisible.
      expect(narrow1.deduplicated).toBe(false);
      expect(narrow1.id).not.toBe(oldNarrow.id);
      // Same batch, same narrow window — collapses onto the entry just created.
      expect(narrow2.deduplicated).toBe(true);
      expect(narrow2.id).toBe(narrow1.id);
      // A wider window on a sibling entry still sees the pre-existing chain.
      expect(wide.deduplicated).toBe(true);
      expect(wide.id).toBe(oldWide.id);
    });

    it("applies each entry's own excludeChainIds", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const existing = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "exclude-key", scope: "running" },
          }),
        ),
      );

      const [included, excluded, sibling] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "exclude-key", scope: "running" },
              },
              {
                typeName: "test",
                input: { value: 3 },
                deduplication: {
                  key: "exclude-key",
                  scope: "running",
                  excludeChainIds: [existing.id],
                },
              },
              {
                typeName: "test",
                input: { value: 4 },
                deduplication: {
                  key: "exclude-key",
                  scope: "running",
                  excludeChainIds: [existing.id],
                },
              },
            ],
          }),
        ),
      );

      // No exclusion — collapses onto the pre-existing chain.
      expect(included.deduplicated).toBe(true);
      expect(included.id).toBe(existing.id);
      // Excluding it forces a new chain, even though a sibling entry matched it.
      expect(excluded.deduplicated).toBe(false);
      expect(excluded.id).not.toBe(existing.id);
      // The exclusion does not hide chains created earlier in the same batch.
      expect(sibling.deduplicated).toBe(true);
      expect(sibling.id).toBe(excluded.id);
    });
  });

  describe("getChain", () => {
    it("resolves the chain a create would collapse onto and nothing for an unknown key", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      expect(
        await client.getChain({
          typeName: "test",
          deduplication: { key: "read-key", scope: "running" },
        }),
      ).toBeUndefined();

      const created = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "read-key", scope: "running" },
          }),
        ),
      );

      const resolved = await client.getChain({
        typeName: "test",
        deduplication: { key: "read-key", scope: "running" },
      });
      expect(resolved?.id).toBe(created.id);
      expect(resolved?.input).toEqual({ value: 1 });

      // The read agrees with what a create would do.
      const deduplicated = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "read-key", scope: "running" },
          }),
        ),
      );
      expect(deduplicated.deduplicated).toBe(true);
      expect(deduplicated.id).toBe(resolved?.id);

      expect(
        await client.getChain({
          typeName: "test",
          deduplication: { key: "unknown-key", scope: "running" },
        }),
      ).toBeUndefined();
    });

    it("does not resolve across chain types with the same key", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const chainA = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "typeA",
            input: { value: 1 },
            deduplication: { key: "shared-key", scope: "running" },
          }),
        ),
      );

      expect(
        (
          await client.getChain({
            typeName: "typeA",
            deduplication: { key: "shared-key", scope: "running" },
          })
        )?.id,
      ).toBe(chainA.id);

      // The same key under another chain type is a different singleton.
      expect(
        await client.getChain({
          typeName: "typeB",
          deduplication: { key: "shared-key", scope: "running" },
        }),
      ).toBeUndefined();
    });

    it("scope 'any' matches completed chains while 'running' does not", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const created = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "scope-key", scope: "running" },
          }),
        ),
      );

      expect(
        (
          await client.getChain({
            typeName: "test",
            deduplication: { key: "scope-key", scope: "running" },
          })
        )?.id,
      ).toBe(created.id);

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...created,
            complete: async ({ job, complete }) =>
              complete(job, async () => ({ result: job.input.value })),
          }),
        ),
      );

      expect(
        await client.getChain({
          typeName: "test",
          deduplication: { key: "scope-key", scope: "running" },
        }),
      ).toBeUndefined();

      expect(
        (
          await client.getChain({
            typeName: "test",
            deduplication: { key: "scope-key", scope: "any" },
          })
        )?.id,
      ).toBe(created.id);
    });

    it("scope 'running' matches multi-step chains that have continued", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const created = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "step1",
            input: { value: 1 },
            deduplication: { key: "multi-step-key", scope: "running" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...created,
            complete: async ({ job, complete }) => {
              if (job.typeName === "step1") {
                await complete(job, async ({ continueWith }) =>
                  continueWith({ typeName: "step2", input: { continued: true } }),
                );
              }
            },
          }),
        ),
      );

      expect(
        (
          await client.getChain({
            typeName: "step1",
            deduplication: { key: "multi-step-key", scope: "running" },
          })
        )?.id,
      ).toBe(created.id);

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...created,
            complete: async ({ job, complete }) => {
              if (job.typeName === "step2") {
                return complete(job, async () => ({ result: 42 }));
              }
            },
          }),
        ),
      );

      expect(
        await client.getChain({
          typeName: "step1",
          deduplication: { key: "multi-step-key", scope: "running" },
        }),
      ).toBeUndefined();
    });

    it("resolves the newest occurrence", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const first = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "recurring-key", scope: "running" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...first,
            complete: async ({ job, complete }) =>
              complete(job, async () => ({ result: job.input.value })),
          }),
        ),
      );

      await sleep(100);

      const second = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "recurring-key", scope: "running" },
          }),
        ),
      );
      expect(second.id).not.toBe(first.id);

      const newest = await client.getChain({
        typeName: "test",
        deduplication: { key: "recurring-key", scope: "any" },
      });
      expect(newest?.id).toBe(second.id);
      expect(newest?.input).toEqual({ value: 2 });
    });

    it("windowMs limits the match to recent chains", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const created = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "window-key", scope: "running" },
          }),
        ),
      );

      expect(
        (
          await client.getChain({
            typeName: "test",
            deduplication: { key: "window-key", scope: "running", windowMs: 60_000 },
          })
        )?.id,
      ).toBe(created.id);

      await sleep(100);

      expect(
        await client.getChain({
          typeName: "test",
          deduplication: { key: "window-key", scope: "running", windowMs: 50 },
        }),
      ).toBeUndefined();
    });

    it("excludeChainIds skips the specified chains", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const first = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "exclude-key", scope: "running" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...first,
            complete: async ({ job, complete }) =>
              complete(job, async () => ({ result: job.input.value })),
          }),
        ),
      );

      const second = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "exclude-key", scope: "running" },
          }),
        ),
      );

      // Excluding the newest falls through to the older occurrence.
      expect(
        (
          await client.getChain({
            typeName: "test",
            deduplication: { key: "exclude-key", scope: "any", excludeChainIds: [second.id] },
          })
        )?.id,
      ).toBe(first.id);

      expect(
        await client.getChain({
          typeName: "test",
          deduplication: {
            key: "exclude-key",
            scope: "any",
            excludeChainIds: [first.id, second.id],
          },
        }),
      ).toBeUndefined();

      // The remaining match is completed, so 'running' sees nothing.
      expect(
        await client.getChain({
          typeName: "test",
          deduplication: { key: "exclude-key", scope: "running", excludeChainIds: [second.id] },
        }),
      ).toBeUndefined();
    });

    it("composes with lock", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const created = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "locked-key", scope: "running" },
          }),
        ),
      );

      await withTransaction(async (txCtx) => {
        const locked = await client.getChain({
          ...txCtx,
          typeName: "test",
          deduplication: { key: "locked-key", scope: "running" },
          lock: true,
        });
        expect(locked?.id).toBe(created.id);
        expect(locked?.input).toEqual({ value: 1 });

        // Matching nothing locks nothing.
        expect(
          await client.getChain({
            ...txCtx,
            typeName: "test",
            deduplication: { key: "absent-key", scope: "running" },
            lock: true,
          }),
        ).toBeUndefined();
      });
    });
  });

  describe("getChains", () => {
    it("resolves one chain per entry, positionally", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      expect(await client.getChains({ typeName: "test", deduplications: [] })).toEqual([]);

      const [alpha, beta] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 1 },
                deduplication: { key: "alpha", scope: "running" },
              },
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "beta", scope: "running" },
              },
            ],
          }),
        ),
      );

      const resolved = await client.getChains({
        typeName: "test",
        deduplications: [
          { key: "beta", scope: "running" },
          { key: "missing", scope: "running" },
          { key: "alpha", scope: "running" },
          { key: "beta", scope: "any" },
        ],
      });

      expect(resolved.map((chain) => chain?.id)).toEqual([beta.id, undefined, alpha.id, beta.id]);
      expect(resolved[0]?.input).toEqual({ value: 2 });
      expect(resolved[2]?.input).toEqual({ value: 1 });
    });

    it("does not resolve across chain types with the same key", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [chainA, chainB] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "typeA",
                input: { value: 1 },
                deduplication: { key: "shared-key", scope: "running" },
              },
              {
                typeName: "typeB",
                input: { value: 2 },
                deduplication: { key: "only-b-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      expect(
        (
          await client.getChains({
            typeName: "typeA",
            deduplications: [
              { key: "shared-key", scope: "running" },
              { key: "only-b-key", scope: "running" },
            ],
          })
        ).map((chain) => chain?.id),
      ).toEqual([chainA.id, undefined]);

      expect(
        (
          await client.getChains({
            typeName: "typeB",
            deduplications: [
              { key: "shared-key", scope: "running" },
              { key: "only-b-key", scope: "running" },
            ],
          })
        ).map((chain) => chain?.id),
      ).toEqual([undefined, chainB.id]);
    });

    it("applies each entry's own scope", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [completed, running] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 1 },
                deduplication: { key: "completed-key", scope: "running" },
              },
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "running-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...completed,
            complete: async ({ job, complete }) =>
              complete(job, async () => ({ result: job.input.value })),
          }),
        ),
      );

      const resolved = await client.getChains({
        typeName: "test",
        deduplications: [
          { key: "completed-key", scope: "running" },
          { key: "completed-key", scope: "any" },
          { key: "running-key", scope: "running" },
          { key: "running-key", scope: "any" },
        ],
      });

      expect(resolved.map((chain) => chain?.id)).toEqual([
        undefined, // running: the only occurrence is completed
        completed.id, // any: still matches
        running.id,
        running.id,
      ]);
    });

    it("scope 'running' matches multi-step chains that have continued", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [continued, plain] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "step1",
                input: { value: 1 },
                deduplication: { key: "multi-step-key", scope: "running" },
              },
              {
                typeName: "step1",
                input: { value: 2 },
                deduplication: { key: "single-step-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...continued,
            complete: async ({ job, complete }) => {
              if (job.typeName === "step1") {
                await complete(job, async ({ continueWith }) =>
                  continueWith({ typeName: "step2", input: { continued: true } }),
                );
              }
            },
          }),
        ),
      );

      expect(
        (
          await client.getChains({
            typeName: "step1",
            deduplications: [
              { key: "multi-step-key", scope: "running" },
              { key: "single-step-key", scope: "running" },
            ],
          })
        ).map((chain) => chain?.id),
      ).toEqual([continued.id, plain.id]);

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...continued,
            complete: async ({ job, complete }) => {
              if (job.typeName === "step2") {
                return complete(job, async () => ({ result: 42 }));
              }
            },
          }),
        ),
      );

      expect(
        (
          await client.getChains({
            typeName: "step1",
            deduplications: [
              { key: "multi-step-key", scope: "running" },
              { key: "multi-step-key", scope: "any" },
              { key: "single-step-key", scope: "running" },
            ],
          })
        ).map((chain) => chain?.id),
      ).toEqual([undefined, continued.id, plain.id]);
    });

    it("resolves the newest occurrence per entry", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [firstAlpha, firstBeta] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 1 },
                deduplication: { key: "alpha", scope: "running" },
              },
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "beta", scope: "running" },
              },
            ],
          }),
        ),
      );

      for (const chain of [firstAlpha, firstBeta]) {
        await withTransactionHooks(async (transactionHooks) =>
          withTransaction(async (txCtx) =>
            client.completeChain({
              ...txCtx,
              transactionHooks,
              ...chain,
              complete: async ({ job, complete }) =>
                complete(job, async () => ({ result: job.input.value })),
            }),
          ),
        );
      }

      await sleep(100);

      const [secondAlpha, secondBeta] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 3 },
                deduplication: { key: "alpha", scope: "running" },
              },
              {
                typeName: "test",
                input: { value: 4 },
                deduplication: { key: "beta", scope: "running" },
              },
            ],
          }),
        ),
      );

      expect(secondAlpha.id).not.toBe(firstAlpha.id);
      expect(secondBeta.id).not.toBe(firstBeta.id);

      expect(
        (
          await client.getChains({
            typeName: "test",
            deduplications: [
              { key: "alpha", scope: "any" },
              { key: "beta", scope: "any" },
            ],
          })
        ).map((chain) => chain?.id),
      ).toEqual([secondAlpha.id, secondBeta.id]);
    });

    it("applies each entry's own windowMs", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [older] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 1 },
                deduplication: { key: "old-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      await sleep(150);

      const [newer] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "new-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      // Every entry carries its own window, so a client that reused one entry's
      // window for the whole batch would answer at least one of these wrongly.
      const resolved = await client.getChains({
        typeName: "test",
        deduplications: [
          { key: "old-key", scope: "any", windowMs: 100 },
          { key: "old-key", scope: "any", windowMs: 60_000 },
          { key: "new-key", scope: "any", windowMs: 100 },
          { key: "new-key", scope: "any" },
        ],
      });

      expect(resolved.map((chain) => chain?.id)).toEqual([
        undefined, // outside the narrow window
        older.id,
        newer.id, // well inside the narrow window
        newer.id,
      ]);
    });

    it("applies each entry's own excludeChainIds", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const older = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "batch-opts", scope: "running" },
          }),
        ),
      );

      await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...older,
            complete: async ({ job, complete }) =>
              complete(job, async () => ({ result: job.input.value })),
          }),
        ),
      );

      await sleep(100);

      const newer = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "batch-opts", scope: "running" },
          }),
        ),
      );
      expect(newer.id).not.toBe(older.id);

      const resolved = await client.getChains({
        typeName: "test",
        deduplications: [
          { key: "batch-opts", scope: "any" },
          { key: "batch-opts", scope: "any", excludeChainIds: [newer.id] },
          { key: "batch-opts", scope: "any", excludeChainIds: [older.id, newer.id] },
          { key: "batch-opts", scope: "running", excludeChainIds: [newer.id] },
          { key: "batch-opts-absent", scope: "any" },
        ],
      });

      expect(resolved.map((chain) => chain?.id)).toEqual([
        newer.id, // nothing excluded: newest overall
        older.id, // newest excluded: falls through to the completed one
        undefined, // both excluded
        undefined, // running, newest excluded: the remaining match is completed
        undefined, // no such key
      ]);
    });

    it("composes with lock across multiple entries", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: {
          entry: true;
          input: { value: number };
          output: { result: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const [first, second] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 1 },
                deduplication: { key: "batch-lock-a", scope: "running" },
              },
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "batch-lock-b", scope: "running" },
              },
            ],
          }),
        ),
      );

      await withTransaction(async (txCtx) => {
        const locked = await client.getChains({
          ...txCtx,
          typeName: "test",
          deduplications: [
            { key: "batch-lock-b", scope: "running" },
            { key: "batch-lock-absent", scope: "running" },
            { key: "batch-lock-a", scope: "running" },
          ],
          lock: true,
        });

        expect(locked.map((chain) => chain?.id)).toEqual([second.id, undefined, first.id]);
        expect(locked[0]?.input).toEqual({ value: 2 });
      });
    });
  });
};
