import { type TestAPI } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { createClient, defineJobTypes } from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const deduplicationTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("deduplicates job chains with same deduplication key", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });

    const [chain1, chain2, chain3] = await client.withNotify(async () =>
      runInTransaction(async (txContext) => [
        await client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "same-key" },
        }),
        await client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "same-key" },
        }),
        await client.startJobChain({
          ...txContext,
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

    const completed1 = await runInTransaction(async (txContext) =>
      client.completeJobChain({
        ...txContext,
        ...chain1,
        complete: async ({ job, complete }) => {
          return complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    const completed3 = await runInTransaction(async (txContext) =>
      client.completeJobChain({
        ...txContext,
        ...chain3,
        complete: async ({ job, complete }) => {
          return complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    expect(completed1.output).toEqual({ result: 1 });
    expect(completed3.output).toEqual({ result: 3 });

    // chain2 was deduplicated to chain1, so it should have the same output
    const fetched2 = await runInTransaction(async (txContext) =>
      client.getJobChain({ ...txContext, ...chain2 }),
    );
    expect("output" in fetched2! && fetched2.output).toEqual({ result: 1 });
  });

  it("deduplication scopes: 'any' vs 'incomplete'", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    log,
    observabilityAdapter,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });

    // Test 'any' scope - deduplicates against completed jobs
    const allChain1 = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "all-key", scope: "any" },
        }),
      ),
    );

    await runInTransaction(async (txContext) =>
      client.completeJobChain({
        ...txContext,
        ...allChain1,
        complete: async ({ job, complete }) => {
          await complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    const allChain2 = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "all-key", scope: "any" },
        }),
      ),
    );

    expect(allChain2.deduplicated).toBe(true);
    expect(allChain2.id).toBe(allChain1.id);

    // Test 'incomplete' scope - does NOT deduplicate against completed jobs
    const completedChain1 = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "completed-key", scope: "incomplete" },
        }),
      ),
    );

    await runInTransaction(async (txContext) =>
      client.completeJobChain({
        ...txContext,
        ...completedChain1,
        complete: async ({ job, complete }) => {
          await complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    const completedChain2 = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 4 },
          deduplication: { key: "completed-key", scope: "incomplete" },
        }),
      ),
    );

    expect(completedChain2.deduplicated).toBe(false);
    expect(completedChain2.id).not.toBe(completedChain1.id);

    const completed2 = await runInTransaction(async (txContext) =>
      client.completeJobChain({
        ...txContext,
        ...completedChain2,
        complete: async ({ job, complete }) => {
          return complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );
    expect(completed2.output).toEqual({ result: 4 });
  });

  it("deduplication with windowMs respects time window", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const registry = defineJobTypes<{
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
      registry,
    });

    // Test 'any' scope with windowMs
    const allChain1 = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "all-key", scope: "any", windowMs: 50 },
        }),
      ),
    );

    expect(allChain1.deduplicated).toBe(false);

    await sleep(100);

    const allChain2 = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "all-key", scope: "any", windowMs: 50 },
        }),
      ),
    );

    expect(allChain2.deduplicated).toBe(false);
    expect(allChain2.id).not.toBe(allChain1.id);

    // Test 'incomplete' scope with windowMs
    const completedChain1 = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 3 },
          deduplication: { key: "completed-key", scope: "incomplete", windowMs: 50 },
        }),
      ),
    );

    await runInTransaction(async (txContext) =>
      client.completeJobChain({
        ...txContext,
        ...completedChain1,
        complete: async ({ job, complete }) => {
          await complete(job, async () => ({ result: job.input.value }));
        },
      }),
    );

    await sleep(100);

    const completedChain2 = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "test",
          input: { value: 4 },
          deduplication: { key: "completed-key", scope: "incomplete", windowMs: 50 },
        }),
      ),
    );

    expect(completedChain2.deduplicated).toBe(false);
    expect(completedChain2.id).not.toBe(completedChain1.id);
  });
};
