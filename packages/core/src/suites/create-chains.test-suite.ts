import { type TestAPI, describe } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const createChainsTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  describe("createChain", () => {
    it("creates a single chain", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 42 },
          }),
        ),
      );

      expect(chain.typeName).toBe("test");
      expect(chain.input).toEqual({ value: 42 });
      expect(chain.status).toBe("running");
      const initialJob = await client.getJob({ id: chain.id });
      expect(initialJob!.status).toBe("pending");
      expect(chain.deduplicated).toBe(false);
    });

    it("creates a chain with deduplication", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
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
            deduplication: { key: "dup-key", scope: "running" },
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
            deduplication: { key: "dup-key", scope: "running" },
          }),
        ),
      );

      expect(first.deduplicated).toBe(false);
      expect(second.deduplicated).toBe(true);
      expect(second.id).toBe(first.id);
    });

    it("creates a chain with blockers", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        dependency: { entry: true; input: null; output: null };
        main: {
          entry: true;
          input: { value: number };
          output: null;
          blockers: [{ typeName: "dependency" }];
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const dep = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "dependency",
            input: null,
          }),
        ),
      );

      const main = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            input: { value: 1 },
            blockers: [dep],
          }),
        ),
      );

      expect(main.status).toBe("running");

      const mainJob = await client.getJob({ id: main.id });
      expect(mainJob!.status === "pending" && mainJob!.blocked).toBe(true);
    });

    it("creates a chain with scheduling", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: null; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: null,
            schedule: { afterMs: 60_000 },
          }),
        ),
      );

      expect(chain.status).toBe("running");
      const scheduledJob = await client.getJob({ id: chain.id });
      expect(scheduledJob!.status).toBe("pending");
    });

    it("throws when called without transaction context", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      await expect(
        withTransactionHooks(async (transactionHooks) =>
          // @ts-expect-error missing txCtx
          client.createChain({ transactionHooks, typeName: "test", input: { value: 1 } }),
        ),
      ).rejects.toThrow("requires a transaction context");
    });

    it("rejects wrong input type at compile time", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      void withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            // @ts-expect-error wrong input type
            input: { wrong: "field" },
          }),
        ),
      );
    });

    it("rejects non-entry type name at compile time", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      void withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            // @ts-expect-error non-existent type
            typeName: "nonexistent",
            input: { value: 0 },
          }),
        ),
      );
    });

    it("requires blockers when defined at compile time", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
    }) => {
      const jobTypes = defineJobTypes<{
        dep: { entry: true; input: null; output: null };
        withBlocker: {
          entry: true;
          input: { value: number };
          output: null;
          blockers: [{ typeName: "dep" }];
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      void withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          // @ts-expect-error missing required blockers
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "withBlocker",
            input: { value: 1 },
          }),
        ),
      );
    });

    it("uses caller-supplied id", async ({
      stateAdapter,
      generateId,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const userId = generateId();
      const chain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            id: userId,
            input: { value: 1 },
          }),
        ),
      );

      expect(chain.id).toBe(userId);
      expect(chain.deduplicated).toBe(false);
    });
  });

  describe("createChains", () => {
    it("creates multiple chains in a single batch", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: { result: number } };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              { typeName: "test", input: { value: 1 } },
              { typeName: "test", input: { value: 2 } },
              { typeName: "test", input: { value: 3 } },
            ],
          }),
        ),
      );

      expect(chains).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(chains[i].typeName).toBe("test");
        expect(chains[i].input).toEqual({ value: i + 1 });
        expect(chains[i].status).toBe("running");
        const initialJob = await client.getJob({ id: chains[i].id });
        expect(initialJob!.status).toBe("pending");
        expect(chains[i].deduplicated).toBe(false);
      }

      const uniqueIds = new Set(chains.map((jc) => jc.id));
      expect(uniqueIds.size).toBe(3);
    });

    it("returns empty array for empty batch", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [],
          }),
        ),
      );

      expect(chains).toEqual([]);
    });

    it("handles deduplication in batch", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const existingChain = await withTransactionHooks(async (transactionHooks) =>
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

      const chains = await withTransactionHooks(async (transactionHooks) =>
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
                deduplication: { key: "new-key", scope: "running" },
              },
            ],
          }),
        ),
      );

      expect(chains).toHaveLength(2);
      expect(chains[0].deduplicated).toBe(true);
      expect(chains[0].id).toBe(existingChain.id);
      expect(chains[1].deduplicated).toBe(false);
      expect(chains[1].id).not.toBe(existingChain.id);
    });

    it("handles batch with blockers", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        dependency: { entry: true; input: null; output: null };
        main: {
          entry: true;
          input: { value: number };
          output: null;
          blockers: [{ typeName: "dependency" }];
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const depChain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "dependency",
            input: null,
          }),
        ),
      );

      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
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

      expect(chains).toHaveLength(2);
      expect(chains[0].status).toBe("running");
      expect(chains[1].status).toBe("running");

      const job0 = await client.getJob({ id: chains[0].id });
      const job1 = await client.getJob({ id: chains[1].id });
      expect(job0!.status === "pending" && job0!.blocked).toBe(true);
      expect(job1!.status === "pending" && job1!.blocked).toBe(true);
    });

    it("handles batch with scheduling", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const futureDate = new Date(Date.now() + 60_000);
      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              { typeName: "test", input: { value: 1 }, schedule: { at: futureDate } },
              { typeName: "test", input: { value: 2 }, schedule: { afterMs: 30_000 } },
              { typeName: "test", input: { value: 3 } },
            ],
          }),
        ),
      );

      expect(chains).toHaveLength(3);
      for (const jc of chains) {
        expect(jc.status).toBe("running");
        const job = await client.getJob({ id: jc.id });
        expect(job!.status).toBe("pending");
      }
    });

    it("batch with mixed types", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        typeA: { entry: true; input: { a: number }; output: null };
        typeB: { entry: true; input: { b: string }; output: null };
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
              { typeName: "typeA", input: { a: 1 } },
              { typeName: "typeB", input: { b: "hello" } },
            ],
          }),
        ),
      );

      expect(chainA.typeName).toBe("typeA");
      expect(chainA.input).toEqual({ a: 1 });
      expect(chainB.typeName).toBe("typeB");
      expect(chainB.input).toEqual({ b: "hello" });
      expect(chainB.id).not.toBe(chainA.id);
    });

    it("batch with mix of blocked and unblocked chains", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const dep = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "dependency",
            input: null,
          }),
        ),
      );

      const [blockedChain, unblockedChain] = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              { typeName: "blocked", input: { value: 1 }, blockers: [dep] },
              { typeName: "unblocked", input: { value: 2 } },
            ],
          }),
        ),
      );

      expect(blockedChain.status).toBe("running");
      expect(unblockedChain.status).toBe("running");

      const blockedJob = await client.getJob({ id: blockedChain.id });
      const unblockedJob = await client.getJob({ id: unblockedChain.id });
      expect(blockedJob!.status === "pending" && blockedJob!.blocked).toBe(true);
      expect(unblockedJob!.status === "pending" && unblockedJob!.blocked).toBe(false);
    });

    it("workers unblock and process batch-created blocked chains", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const blocker = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "blocker",
            input: { value: 42 },
          }),
        ),
      );

      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              { typeName: "main", input: { label: "A" }, blockers: [blocker] },
              { typeName: "main", input: { label: "B" }, blockers: [blocker] },
              { typeName: "main", input: { label: "C" }, blockers: [blocker] },
            ],
          }),
        ),
      );

      for (const chain of chains) {
        expect(chain.status).toBe("running");
        const job = await client.getJob({ id: chain.id });
        expect(job!.status === "pending" && job!.blocked).toBe(true);
      }

      const worker = await createInProcessWorker({
        client,
        concurrency: 3,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            blocker: {
              attemptHandler: async ({ job, complete }) => {
                return complete(async () => ({ result: job.input.value }));
              },
            },
            main: {
              attemptHandler: async ({ job, complete }) => {
                return complete(async () => ({
                  finalResult: job.blockers[0].output.result,
                }));
              },
            },
          },
        }),
      });

      await withWorkers([await worker.start()], async () => {
        const results = await Promise.all(
          chains.map(async (jc) => client.awaitChain(jc, completionOptions)),
        );

        for (const result of results) {
          expect(result.output).toEqual({ finalResult: 42 });
        }
      });
    });

    it("workers process all batch-created chains", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: { result: number } };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              { typeName: "test", input: { value: 10 } },
              { typeName: "test", input: { value: 20 } },
              { typeName: "test", input: { value: 30 } },
            ],
          }),
        ),
      );

      const worker = await createInProcessWorker({
        client,
        concurrency: 3,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            test: {
              attemptHandler: async ({ job, complete }) => {
                return complete(async () => ({ result: job.input.value * 2 }));
              },
            },
          },
        }),
      });

      await withWorkers([await worker.start()], async () => {
        const results = await Promise.all(
          chains.map(async (jc) => client.awaitChain(jc, completionOptions)),
        );

        expect(results[0].output).toEqual({ result: 20 });
        expect(results[1].output).toEqual({ result: 40 });
        expect(results[2].output).toEqual({ result: 60 });
      });
    });

    it("throws when called without transaction context", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      await expect(
        withTransactionHooks(async (transactionHooks) =>
          // @ts-expect-error missing txCtx
          client.createChains({
            transactionHooks,
            items: [{ typeName: "test", input: { value: 1 } }],
          }),
        ),
      ).rejects.toThrow("requires a transaction context");
    });

    it("rejects non-entry type name in batch at compile time", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      void withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              // @ts-expect-error non-existent type
              { typeName: "nonexistent", input: { value: 0 } },
            ],
          }),
        ),
      );
    });

    it("rejects wrong input type in batch at compile time", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      void withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              // @ts-expect-error wrong input for test
              { typeName: "test", input: { wrong: "field" } },
            ],
          }),
        ),
      );
    });

    it("rejects missing blockers in batch at compile time", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
    }) => {
      const jobTypes = defineJobTypes<{
        dep: { entry: true; input: null; output: null };
        withBlocker: {
          entry: true;
          input: { value: number };
          output: null;
          blockers: [{ typeName: "dep" }];
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      void withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              // @ts-expect-error missing required blockers for withBlocker
              { typeName: "withBlocker", input: { value: 1 } },
            ],
          }),
        ),
      );
    });

    it("uses caller-supplied ids per item", async ({
      stateAdapter,
      generateId,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const idA = generateId();
      const idB = generateId();
      const chains = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              { typeName: "test", id: idA, input: { value: 1 } },
              { typeName: "test", id: idB, input: { value: 2 } },
            ],
          }),
        ),
      );

      expect(chains[0].id).toBe(idA);
      expect(chains[1].id).toBe(idB);
    });
  });
};
