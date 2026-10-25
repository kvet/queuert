import { describe, expect, test } from "vitest";

import { createClient } from "../client.js";
import { ChainNotFoundError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.js";
import { type BaseTxContext, type StateAdapter } from "../state-adapter/state-adapter.js";
import { createTransactionHooks, withTransactionHooks } from "../transaction-hooks.js";

const jobTypes = defineJobTypes<{
  greet: { entry: true; input: { name: string }; output: { greeting: string } };
  first: { entry: true; input: { value: number }; continueWith: { typeName: "second" } };
  second: { input: { value: number }; output: { doubled: number } };
  blocked: {
    entry: true;
    input: null;
    blockers: [{ typeName: "greet" }];
    output: { done: true };
  };
}>();

const expectDirect = <T>(value: T): T => {
  expect(value).not.toBeInstanceOf(Promise);
  return value;
};

/**
 * Exercises an adapter in sync mode: every state-touching client method, `complete` and
 * workerless `completeChain` return results directly inside the adapter's synchronous
 * transaction.
 */
export const syncModeTestSuite = ({
  createStateAdapter,
}: {
  createStateAdapter: () => Promise<{
    stateAdapter: StateAdapter<BaseTxContext, string, "sync">;
    dispose: () => Promise<void>;
  }>;
}): void => {
  const setup = async () => {
    const { stateAdapter, dispose } = await createStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
    return {
      stateAdapter,
      client,
      notifyAdapter,
      [Symbol.asyncDispose]: async () => {
        await notifyAdapter.close();
        stateAdapter.close();
        await dispose();
      },
    };
  };

  describe("sync mode", () => {
    test("writes and reads return results directly inside a sync transaction", async () => {
      await using context = await setup();
      const { stateAdapter, client } = context;

      const chain = withTransactionHooks((transactionHooks) =>
        stateAdapter.withTransaction((txCtx) => {
          const created = expectDirect(
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "greet",
              input: { name: "a" },
            }),
          );
          const [batched] = expectDirect(
            client.createChains({
              ...txCtx,
              transactionHooks,
              items: [{ typeName: "greet", input: { name: "b" } }],
            }),
          );
          expect(expectDirect(client.getChain({ ...txCtx, id: created.id }))?.id).toBe(created.id);
          expect(expectDirect(client.getJob({ ...txCtx, id: created.id }))?.status).toBe("pending");
          expectDirect(client.rescheduleJob({ ...txCtx, transactionHooks, id: created.id }));
          expect(
            expectDirect(client.deleteChain({ ...txCtx, transactionHooks, id: batched.id }))?.id,
          ).toBe(batched.id);
          return created;
        }),
      );

      expect(expectDirect(client.getChain({ id: chain.id }))?.id).toBe(chain.id);
      expect(expectDirect(client.getChains({ ids: [chain.id] }))).toHaveLength(1);
      expect(expectDirect(client.getJobs({ ids: [chain.id] }))).toHaveLength(1);
      expect(expectDirect(client.listChains({ typeName: "greet" })).items).toHaveLength(1);
      expect(expectDirect(client.listJobs({ typeName: "greet" })).items).toHaveLength(1);
      expect(expectDirect(client.listChainJobs({ chainId: chain.id })).items).toHaveLength(1);
      expect(expectDirect(client.listBlockedJobs({ chainId: chain.id })).items).toHaveLength(0);
      expect(expectDirect(client.getJobBlockers({ jobId: chain.id }))).toEqual([]);
      expect(expectDirect(client.listChainTypeNames())).toEqual(["greet"]);
      expect(expectDirect(client.listJobTypeNames())).toEqual(["greet"]);
      expect(
        expectDirect(client.countByJobTypeNames({ typeNames: ["greet"] }))[0].pending.count,
      ).toBe(1);
      expect(
        expectDirect(client.countByChainTypeNames({ typeNames: ["greet"] }))[0].running.count,
      ).toBe(1);
    });

    test("a sync throw rolls back the transaction", async () => {
      await using context = await setup();
      const { stateAdapter, client } = context;

      let createdId: string | undefined;
      expect(() =>
        stateAdapter.withTransaction((txCtx) => {
          const { transactionHooks } = createTransactionHooks();
          createdId = client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "greet",
            input: { name: "a" },
          }).id;
          return client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "blocked",
            input: null,
            blockers: [{ typeName: "greet", id: crypto.randomUUID() }],
          });
        }),
      ).toThrow(ChainNotFoundError);

      expect(createdId).toBeDefined();
      expect(client.getChain({ id: createdId! })).toBeUndefined();
    });

    test("an async callback in sync mode throws instead of returning a promise", async () => {
      await using context = await setup();
      const { stateAdapter, client } = context;

      const chain = withTransactionHooks((transactionHooks) =>
        stateAdapter.withTransaction((txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "greet",
            input: { name: "a" },
          }),
        ),
      );

      expect(() =>
        stateAdapter.withTransaction((txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks: createTransactionHooks().transactionHooks,
            typeName: "greet",
            id: chain.id,
            handler: (async () => undefined) as never,
          }),
        ),
      ).toThrow("callbacks passed in sync mode must be synchronous");
    });

    test("workerless completeChain runs synchronously", async () => {
      await using context = await setup();
      const { stateAdapter, client } = context;

      const chain = withTransactionHooks((transactionHooks) =>
        stateAdapter.withTransaction((txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "first",
            input: { value: 2 },
          }),
        ),
      );

      const completed = withTransactionHooks((transactionHooks) =>
        stateAdapter.withTransaction((txCtx) =>
          expectDirect(
            client.completeChain({
              ...txCtx,
              transactionHooks,
              typeName: "first",
              id: chain.id,
              handler: ({ job, completeJob }) => {
                if (job.typeName !== "first") return;
                const second = completeJob(job, ({ complete }) =>
                  complete({ continueWith: { typeName: "second", input: { value: 2 } } }),
                );
                return completeJob(second, ({ complete }) =>
                  complete({ output: { doubled: second.input.value * 2 } }),
                );
              },
            }),
          ),
        ),
      );

      expect(completed).toMatchObject({ status: "completed", output: { doubled: 4 } });
    });

    test("a worker completes attempts with a sync complete", async () => {
      await using context = await setup();
      const { stateAdapter, client } = context;

      let attempts = 0;
      const worker = createInProcessWorker({
        client,
        defaults: { backoffConfig: { initialDelayMs: 1, maxDelayMs: 1 } },
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            greet: {
              attemptHandler: async ({ job, complete }) => {
                attempts++;
                return withTransactionHooks((transactionHooks) =>
                  stateAdapter.withTransaction((txCtx) => {
                    const result = expectDirect(
                      complete({
                        ...txCtx,
                        transactionHooks,
                        output: { greeting: `hello ${job.input.name}` },
                      }),
                    );
                    if (attempts === 1) throw new Error("roll back the first attempt");
                    return result;
                  }),
                );
              },
            },
            first: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks((transactionHooks) =>
                  stateAdapter.withTransaction((txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      continueWith: { typeName: "second", input: { value: job.input.value } },
                    }),
                  ),
                ),
            },
            second: {
              attemptHandler: async ({ job, complete }) =>
                withTransactionHooks((transactionHooks) =>
                  stateAdapter.withTransaction((txCtx) =>
                    complete({
                      ...txCtx,
                      transactionHooks,
                      output: { doubled: job.input.value * 2 },
                    }),
                  ),
                ),
            },
          },
        }),
      });
      const stop = await worker.start();
      try {
        const [greet, first] = withTransactionHooks((transactionHooks) =>
          stateAdapter.withTransaction((txCtx) => [
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "greet",
              input: { name: "a" },
            }),
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "first",
              input: { value: 3 },
            }),
          ]),
        );

        const greeted = await client.awaitChain(greet, { timeoutMs: 5000 });
        expect(greeted.output).toEqual({ greeting: "hello a" });
        expect(attempts).toBe(2);

        const doubled = await client.awaitChain(first, { timeoutMs: 5000 });
        expect(doubled.output).toEqual({ doubled: 6 });
      } finally {
        await stop();
      }
    });
  });
};
