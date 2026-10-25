import { unwrap } from "@queuert/helpers";
import { type TestAPI, assert, expect } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const deduplicationTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("deduplicates chains with same deduplication key", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const [chain1, chain2, chain3] = await withTransactionOperation(
      function* (txCtx, transactionHooks) {
        return [
          yield* unwrap(
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "test",
              input: { value: 1 },
              deduplication: { key: "same-key", scope: "running" },
            }),
          ),
          yield* unwrap(
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "test",
              input: { value: 2 },
              deduplication: { key: "same-key", scope: "running" },
            }),
          ),
          yield* unwrap(
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "test",
              input: { value: 3 },
              deduplication: { key: "different-key", scope: "running" },
            }),
          ),
        ];
      },
    );

    expect(chain1.deduplicated).toBe(false);
    expect(chain2.deduplicated).toBe(true);
    expect(chain2.id).toBe(chain1.id);
    expect(chain3.deduplicated).toBe(false);
    expect(chain3.id).not.toBe(chain1.id);

    const completed1 = await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain1,
        handler: ({ job, completeJob }) => {
          return completeJob(job, ({ complete }) =>
            complete({ output: { result: job.input.value } }),
          );
        },
      }),
    );

    const completed3 = await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain3,
        handler: ({ job, completeJob }) => {
          return completeJob(job, ({ complete }) =>
            complete({ output: { result: job.input.value } }),
          );
        },
      }),
    );

    assert(completed1.status === "completed");
    assert(completed3.status === "completed");
    expect(completed1.output).toEqual({ result: 1 });
    expect(completed3.output).toEqual({ result: 3 });

    // chain2 was deduplicated to chain1, so it should have the same output
    const fetched2 = await withTransaction((txCtx) => client.getChain({ ...txCtx, ...chain2 }));
    expect("output" in fetched2! && fetched2.output).toEqual({ result: 1 });
  });

  it("scope 'running' deduplicates against multi-step chains that have continued", async ({
    runInMode,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    log,
    observabilityAdapter,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain1 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "step1",
        input: { value: 1 },
        deduplication: { key: "multi-step-key", scope: "running" },
      }),
    );

    expect(chain1.deduplicated).toBe(false);

    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain1,
        handler: ({ job, completeJob }) =>
          runInMode(function* () {
            if (job.typeName === "step1") {
              yield* unwrap(
                completeJob(job, ({ complete }) =>
                  complete({ continueWith: { typeName: "step2", input: { continued: true } } }),
                ),
              );
            }
          }),
      }),
    );

    const chain2 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "step1",
        input: { value: 2 },
        deduplication: { key: "multi-step-key", scope: "running" },
      }),
    );

    expect(chain2.deduplicated).toBe(true);
    expect(chain2.id).toBe(chain1.id);

    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain1,
        handler: ({ job, completeJob }) => {
          if (job.typeName === "step2") {
            return completeJob(job, ({ complete }) => complete({ output: { result: 42 } }));
          }
        },
      }),
    );

    const chain3 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "step1",
        input: { value: 3 },
        deduplication: { key: "multi-step-key", scope: "running" },
      }),
    );

    expect(chain3.deduplicated).toBe(false);
    expect(chain3.id).not.toBe(chain1.id);
  });

  it("scope 'running' picks running chain when completed chain exists with same key", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    log,
    observabilityAdapter,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const chain1 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 1 },
        deduplication: { key: "coexist-key", scope: "running" },
      }),
    );

    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain1,
        handler: ({ job, completeJob }) => {
          return completeJob(job, ({ complete }) => complete({ output: { result: 1 } }));
        },
      }),
    );

    const chain2 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 2 },
        deduplication: { key: "coexist-key", scope: "running" },
      }),
    );

    expect(chain2.deduplicated).toBe(false);
    expect(chain2.id).not.toBe(chain1.id);

    const chain3 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 3 },
        deduplication: { key: "coexist-key", scope: "running" },
      }),
    );

    expect(chain3.deduplicated).toBe(true);
    expect(chain3.id).toBe(chain2.id);
  });

  it("deduplication scopes: 'any' vs 'running'", async ({
    runInMode,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    log,
    observabilityAdapter,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    // Test 'any' scope - deduplicates against completed jobs
    const allChain1 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 1 },
        deduplication: { key: "all-key", scope: "any" },
      }),
    );

    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...allChain1,
        handler: ({ job, completeJob }) =>
          runInMode(function* () {
            yield* unwrap(
              completeJob(job, ({ complete }) => complete({ output: { result: job.input.value } })),
            );
          }),
      }),
    );

    const allChain2 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 2 },
        deduplication: { key: "all-key", scope: "any" },
      }),
    );

    expect(allChain2.deduplicated).toBe(true);
    expect(allChain2.id).toBe(allChain1.id);

    // Test 'running' scope - does NOT deduplicate against completed jobs
    const completedChain1 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 3 },
        deduplication: { key: "completed-key", scope: "running" },
      }),
    );

    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...completedChain1,
        handler: ({ job, completeJob }) =>
          runInMode(function* () {
            yield* unwrap(
              completeJob(job, ({ complete }) => complete({ output: { result: job.input.value } })),
            );
          }),
      }),
    );

    const completedChain2 = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 4 },
        deduplication: { key: "completed-key", scope: "running" },
      }),
    );

    expect(completedChain2.deduplicated).toBe(false);
    expect(completedChain2.id).not.toBe(completedChain1.id);

    const completed2 = await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...completedChain2,
        handler: ({ job, completeJob }) => {
          return completeJob(job, ({ complete }) =>
            complete({ output: { result: job.input.value } }),
          );
        },
      }),
    );
    assert(completed2.status === "completed");
    expect(completed2.output).toEqual({ result: 4 });
  });

  it("does not deduplicate across different chain types with the same key", async ({
    withTransactionOperation,
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const [chainA, chainB] = await withTransactionOperation(function* (txCtx, transactionHooks) {
      return [
        yield* unwrap(
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "typeA",
            input: { value: 1 },
            deduplication: { key: "shared-key", scope: "running" },
          }),
        ),
        yield* unwrap(
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "typeB",
            input: { value: 2 },
            deduplication: { key: "shared-key", scope: "running" },
          }),
        ),
      ];
    });

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
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const [chain1, chain2, chain3] = await withTransaction((txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
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
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const existing = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 100 },
        deduplication: { key: "existing-key", scope: "running" },
      }),
    );

    const [chain1, chain2] = await withTransaction((txCtx, transactionHooks) =>
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
            deduplication: { key: "fresh-key", scope: "running" },
          },
        ],
      }),
    );

    expect(chain1.deduplicated).toBe(true);
    expect(chain1.id).toBe(existing.id);
    expect(chain2.deduplicated).toBe(false);
    expect(chain2.id).not.toBe(existing.id);
  });

  it("deduplication scopes: 'any' vs 'running'", async ({
    runInMode,
    stateAdapter,
    notifyAdapter,
    withTransaction,
    log,
    observabilityAdapter,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: { value: number };
        output: { result: number };
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    // Create and complete a chain with 'any' scope key
    const anyChain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 1 },
        deduplication: { key: "any-key", scope: "any" },
      }),
    );

    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...anyChain,
        handler: ({ job, completeJob }) =>
          runInMode(function* () {
            yield* unwrap(
              completeJob(job, ({ complete }) => complete({ output: { result: job.input.value } })),
            );
          }),
      }),
    );

    // Create and complete a chain with 'running' scope key
    const incompleteChain = await withTransaction((txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "test",
        input: { value: 2 },
        deduplication: { key: "incomplete-key", scope: "running" },
      }),
    );

    await withTransaction((txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...incompleteChain,
        handler: ({ job, completeJob }) =>
          runInMode(function* () {
            yield* unwrap(
              completeJob(job, ({ complete }) => complete({ output: { result: job.input.value } })),
            );
          }),
      }),
    );

    // Batch: 'any' should dedup against completed, 'running' should not
    const [anyResult, incompleteResult] = await withTransaction((txCtx, transactionHooks) =>
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
            deduplication: { key: "incomplete-key", scope: "running" },
          },
        ],
      }),
    );

    expect(anyResult.deduplicated).toBe(true);
    expect(anyResult.id).toBe(anyChain.id);
    expect(incompleteResult.deduplicated).toBe(false);
    expect(incompleteResult.id).not.toBe(incompleteChain.id);
  });

  it("does not deduplicate across different chain types with the same key", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
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

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    const [chainA, chainB] = await withTransaction((txCtx, transactionHooks) =>
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
        ],
      }),
    );

    expect(chainA.deduplicated).toBe(false);
    expect(chainB.deduplicated).toBe(false);
    expect(chainB.id).not.toBe(chainA.id);
  });

  it("rejects a missing or unknown deduplication scope", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const jobTypes = defineJobTypes<{
      test: {
        entry: true;
        input: null;
        output: null;
      };
    }>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    for (const deduplication of [{ key: "k" }, { key: "k", scope: "incomplete" }]) {
      await expect(
        withTransaction((txCtx, transactionHooks) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: null,
            deduplication: deduplication as any,
          }),
        ),
      ).rejects.toThrow(/Invalid deduplication scope/);
    }
  });
};
