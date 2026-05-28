import { type TestAPI } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { sleep } from "../helpers/sleep.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const deduplicationTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("deduplicates chains with same deduplication key", async ({
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
        await client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "same-key" },
        }),
        await client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "same-key" },
        }),
        await client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "different-key" },
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

  it("deduplication scopes: 'any' vs 'incomplete'", async ({
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

    // Test 'any' scope - deduplicates against completed jobs
    const allChain1 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "all-key", scope: "any" },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...allChain1,
          complete: async ({ job, complete }) => {
            await complete(job, async () => ({ result: job.input.value }));
          },
        }),
      ),
    );

    const allChain2 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "all-key", scope: "any" },
        }),
      ),
    );

    expect(allChain2.deduplicated).toBe(true);
    expect(allChain2.id).toBe(allChain1.id);

    // Test 'incomplete' scope - does NOT deduplicate against completed jobs
    const completedChain1 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "completed-key", scope: "open" },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...completedChain1,
          complete: async ({ job, complete }) => {
            await complete(job, async () => ({ result: job.input.value }));
          },
        }),
      ),
    );

    const completedChain2 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 4 },
          deduplication: { key: "completed-key", scope: "open" },
        }),
      ),
    );

    expect(completedChain2.deduplicated).toBe(false);
    expect(completedChain2.id).not.toBe(completedChain1.id);

    const completed2 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...completedChain2,
          complete: async ({ job, complete }) => {
            return complete(job, async () => ({ result: job.input.value }));
          },
        }),
      ),
    );
    expect(completed2.output).toEqual({ result: 4 });
  });

  it("deduplication with windowMs respects time window", async ({
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

    // Test 'any' scope with windowMs
    const allChain1 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "all-key", scope: "any", windowMs: 50 },
        }),
      ),
    );

    expect(allChain1.deduplicated).toBe(false);

    await sleep(100);

    const allChain2 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "all-key", scope: "any", windowMs: 50 },
        }),
      ),
    );

    expect(allChain2.deduplicated).toBe(false);
    expect(allChain2.id).not.toBe(allChain1.id);

    // Test 'incomplete' scope with windowMs
    const completedChain1 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "completed-key", scope: "open", windowMs: 50 },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...completedChain1,
          complete: async ({ job, complete }) => {
            await complete(job, async () => ({ result: job.input.value }));
          },
        }),
      ),
    );

    await sleep(100);

    const completedChain2 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 4 },
          deduplication: { key: "completed-key", scope: "open", windowMs: 50 },
        }),
      ),
    );

    expect(completedChain2.deduplicated).toBe(false);
    expect(completedChain2.id).not.toBe(completedChain1.id);
  });

  it("does not deduplicate across different chain types with the same key", async ({
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
        await client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "typeA",
          input: { value: 1 },
          deduplication: { key: "shared-key" },
        }),
        await client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "typeB",
          input: { value: 2 },
          deduplication: { key: "shared-key" },
        }),
      ]),
    );

    expect(chainA.deduplicated).toBe(false);
    expect(chainB.deduplicated).toBe(false);
    expect(chainB.id).not.toBe(chainA.id);
  });

  it("deduplicates within a batch", async ({
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
      withTransaction(async (txCtx) =>
        client.startChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "test", input: { value: 1 }, deduplication: { key: "same-key" } },
            { typeName: "test", input: { value: 2 }, deduplication: { key: "same-key" } },
            { typeName: "test", input: { value: 3 }, deduplication: { key: "different-key" } },
          ],
        }),
      ),
    );

    expect(chain1.deduplicated).toBe(false);
    expect(chain2.deduplicated).toBe(true);
    expect(chain2.id).toBe(chain1.id);
    expect(chain3.deduplicated).toBe(false);
    expect(chain3.id).not.toBe(chain1.id);
  });

  it("deduplicates against pre-existing chains", async ({
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
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 100 },
          deduplication: { key: "existing-key" },
        }),
      ),
    );

    const [chain1, chain2] = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "test", input: { value: 1 }, deduplication: { key: "existing-key" } },
            { typeName: "test", input: { value: 2 }, deduplication: { key: "fresh-key" } },
          ],
        }),
      ),
    );

    expect(chain1.deduplicated).toBe(true);
    expect(chain1.id).toBe(existing.id);
    expect(chain2.deduplicated).toBe(false);
    expect(chain2.id).not.toBe(existing.id);
  });

  it("deduplication scopes: 'any' vs 'incomplete'", async ({
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

    // Create and complete a chain with 'any' scope key
    const anyChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
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

    // Create and complete a chain with 'incomplete' scope key
    const incompleteChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "incomplete-key", scope: "open" },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...incompleteChain,
          complete: async ({ job, complete }) => {
            await complete(job, async () => ({ result: job.input.value }));
          },
        }),
      ),
    );

    // Batch: 'any' should dedup against completed, 'incomplete' should not
    const [anyResult, incompleteResult] = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChains({
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
              deduplication: { key: "incomplete-key", scope: "open" },
            },
          ],
        }),
      ),
    );

    expect(anyResult.deduplicated).toBe(true);
    expect(anyResult.id).toBe(anyChain.id);
    expect(incompleteResult.deduplicated).toBe(false);
    expect(incompleteResult.id).not.toBe(incompleteChain.id);
  });

  it("deduplication with windowMs respects time window", async ({
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

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "window-key", scope: "any", windowMs: 50 },
        }),
      ),
    );

    await sleep(100);

    const [chain1, chain2] = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChains({
          ...txCtx,
          transactionHooks,
          items: [
            {
              typeName: "test",
              input: { value: 2 },
              deduplication: { key: "window-key", scope: "any", windowMs: 50 },
            },
            {
              typeName: "test",
              input: { value: 3 },
              deduplication: { key: "window-key", scope: "any", windowMs: 50 },
            },
          ],
        }),
      ),
    );

    // Outside window — not deduplicated against existing
    expect(chain1.deduplicated).toBe(false);
    // Within same batch — deduplicated against chain1
    expect(chain2.deduplicated).toBe(true);
    expect(chain2.id).toBe(chain1.id);
  });

  it("excludeChainIds skips specified chains during deduplication", async ({
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
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "exclude-key" },
        }),
      ),
    );

    expect(chain1.deduplicated).toBe(false);

    // Without excludeChainIds — deduplicates against chain1
    const chain2 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "exclude-key" },
        }),
      ),
    );

    expect(chain2.deduplicated).toBe(true);
    expect(chain2.id).toBe(chain1.id);

    // With excludeChainIds — skips chain1, creates new chain
    const chain3 = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "exclude-key", excludeChainIds: [chain1.id] },
        }),
      ),
    );

    expect(chain3.deduplicated).toBe(false);
    expect(chain3.id).not.toBe(chain1.id);
  });

  it("does not deduplicate across different chain types with the same key", async ({
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
        client.startChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "typeA", input: { value: 1 }, deduplication: { key: "shared-key" } },
            { typeName: "typeB", input: { value: 2 }, deduplication: { key: "shared-key" } },
          ],
        }),
      ),
    );

    expect(chainA.deduplicated).toBe(false);
    expect(chainB.deduplicated).toBe(false);
    expect(chainB.id).not.toBe(chainA.id);
  });
};
