import { type TestAPI, describe } from "vitest";
import {
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const startChainsTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  describe("startJobChain", () => {
    it("creates a single job chain", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const jobChain = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 42 },
          }),
        ),
      );

      expect(jobChain.typeName).toBe("test");
      expect(jobChain.input).toEqual({ value: 42 });
      expect(jobChain.status).toBe("pending");
      expect(jobChain.deduplicated).toBe(false);
    });

    it("creates a chain with deduplication", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const first = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 1 },
            deduplication: { key: "dup-key" },
          }),
        ),
      );

      const second = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 2 },
            deduplication: { key: "dup-key" },
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
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
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
        registry,
      });

      const dep = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "dependency",
            input: null,
          }),
        ),
      );

      const main = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            input: { value: 1 },
            blockers: [dep],
          }),
        ),
      );

      expect(main.status).toBe("blocked");
    });

    it("creates a chain with scheduling", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
        test: { entry: true; input: null; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const jobChain = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: null,
            schedule: { afterMs: 60_000 },
          }),
        ),
      );

      expect(jobChain.status).toBe("pending");
    });
  });

  describe("startJobChains", () => {
    it("creates multiple job chains in a single batch", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
        test: { entry: true; input: { value: number }; output: { result: number } };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
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

      expect(jobChains).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(jobChains[i].typeName).toBe("test");
        expect(jobChains[i].input).toEqual({ value: i + 1 });
        expect(jobChains[i].status).toBe("pending");
        expect(jobChains[i].deduplicated).toBe(false);
      }

      const uniqueIds = new Set(jobChains.map((jc) => jc.id));
      expect(uniqueIds.size).toBe(3);
    });

    it("returns empty array for empty batch", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
            ...txCtx,
            transactionHooks,
            items: [],
          }),
        ),
      );

      expect(jobChains).toEqual([]);
    });

    it("handles deduplication in batch", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const existingJobChain = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            input: { value: 100 },
            deduplication: { key: "existing-key" },
          }),
        ),
      );

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "test",
                input: { value: 1 },
                deduplication: { key: "existing-key" },
              },
              {
                typeName: "test",
                input: { value: 2 },
                deduplication: { key: "new-key" },
              },
            ],
          }),
        ),
      );

      expect(jobChains).toHaveLength(2);
      expect(jobChains[0].deduplicated).toBe(true);
      expect(jobChains[0].id).toBe(existingJobChain.id);
      expect(jobChains[1].deduplicated).toBe(false);
      expect(jobChains[1].id).not.toBe(existingJobChain.id);
    });

    it("handles batch with blockers", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
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
        registry,
      });

      const depJobChain = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "dependency",
            input: null,
          }),
        ),
      );

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
            ...txCtx,
            transactionHooks,
            items: [
              {
                typeName: "main",
                input: { value: 1 },
                blockers: [depJobChain],
              },
              {
                typeName: "main",
                input: { value: 2 },
                blockers: [depJobChain],
              },
            ],
          }),
        ),
      );

      expect(jobChains).toHaveLength(2);
      expect(jobChains[0].status).toBe("blocked");
      expect(jobChains[1].status).toBe("blocked");
    });

    it("handles batch with scheduling", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
        test: { entry: true; input: { value: number }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const futureDate = new Date(Date.now() + 60_000);
      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
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

      expect(jobChains).toHaveLength(3);
      for (const jc of jobChains) {
        expect(jc.status).toBe("pending");
      }
    });

    it("batch with mixed types", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
        typeA: { entry: true; input: { a: number }; output: null };
        typeB: { entry: true; input: { b: string }; output: null };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const [chainA, chainB] = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
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
      runInTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
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
        registry,
      });

      const dep = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "dependency",
            input: null,
          }),
        ),
      );

      const [blockedChain, unblockedChain] = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
            ...txCtx,
            transactionHooks,
            items: [
              { typeName: "blocked", input: { value: 1 }, blockers: [dep] },
              { typeName: "unblocked", input: { value: 2 } },
            ],
          }),
        ),
      );

      expect(blockedChain.status).toBe("blocked");
      expect(unblockedChain.status).toBe("pending");
    });

    it("workers unblock and process batch-created blocked chains", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
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
        registry,
      });

      const blocker = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "blocker",
            input: { value: 42 },
          }),
        ),
      );

      const chains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
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
        expect(chain.status).toBe("blocked");
      }

      const worker = await createInProcessWorker({
        client,
        concurrency: 3,
        processorRegistry: createJobTypeProcessorRegistry(client, registry, {
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
        }),
      });

      await withWorkers([await worker.start()], async () => {
        const results = await Promise.all(
          chains.map(async (jc) => client.awaitJobChain(jc, completionOptions)),
        );

        for (const result of results) {
          expect(result.output).toEqual({ finalResult: 42 });
        }
      });
    });

    it("workers process all batch-created chains", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypeRegistry<{
        test: { entry: true; input: { value: number }; output: { result: number } };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const jobChains = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChains({
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
        processorRegistry: createJobTypeProcessorRegistry(client, registry, {
          test: {
            attemptHandler: async ({ job, complete }) => {
              return complete(async () => ({ result: job.input.value * 2 }));
            },
          },
        }),
      });

      await withWorkers([await worker.start()], async () => {
        const results = await Promise.all(
          jobChains.map(async (jc) => client.awaitJobChain(jc, completionOptions)),
        );

        expect(results[0].output).toEqual({ result: 20 });
        expect(results[1].output).toEqual({ result: 40 });
        expect(results[2].output).toEqual({ result: 60 });
      });
    });
  });
};
