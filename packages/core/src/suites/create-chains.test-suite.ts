import { type TestAPI, describe, onTestFinished, vi } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { ChainNotFoundError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.js";
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

      const chain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 42 },
        }),
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

      const first = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 1 },
          deduplication: { key: "dup-key", scope: "running" },
        }),
      );

      const second = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 2 },
          deduplication: { key: "dup-key", scope: "running" },
        }),
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

      const dep = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependency",
          input: null,
        }),
      );

      const main = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 1 },
          blockers: [dep],
        }),
      );

      expect(main.status).toBe("running");

      const mainJob = await client.getJob({ id: main.id });
      expect(mainJob!.status).toBe("blocked");
    });

    it("does not notify workers about a chain created blocked", async ({
      stateAdapter,
      notifyAdapter: fixtureNotifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const notifyAdapter = fixtureNotifyAdapter ?? (await createInProcessNotifyAdapter());
      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const notified: string[] = [];
      const dispose = await notifyAdapter.listenJobScheduled(
        ["dependency", "main", "sentinel"],
        (typeName) => notified.push(typeName),
      );
      onTestFinished(dispose);

      const dep = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "dependency", input: null }),
      );
      await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: null,
          blockers: [dep],
        }),
      );
      // Notifications arrive in commit order, so once the sentinel's lands, any for `main` would have too.
      await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "sentinel", input: null }),
      );
      await vi.waitFor(
        () => {
          expect(notified).toContain("sentinel");
        },
        { timeout: 5000 },
      );

      expect(notified).toContain("dependency");
      expect(notified).not.toContain("main");
    });

    it("rejects a blocker id that does not name a chain head and persists nothing", async ({
      stateAdapter,
      notifyAdapter,
      withTransaction,
      observabilityAdapter,
      log,
      expect,
    }) => {
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

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const dep = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependency",
          input: null,
        }),
      );
      await withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...dep,
          handler: async ({ job, completeJob }) => {
            if (job.typeName === "dependency") {
              await completeJob(job, async ({ finish }) =>
                finish({ continueWith: { typeName: "dependencyStep", input: null } }),
              );
            }
          },
        }),
      );
      const depJobs = await client.listChainJobs({ chainId: dep.id, limit: 10 });
      const continuationId = depJobs.items[1].id;

      for (const blockerId of [crypto.randomUUID(), continuationId]) {
        await expect(
          withTransaction(async (txCtx, transactionHooks) =>
            client.createChain({
              ...txCtx,
              transactionHooks,
              typeName: "main",
              input: null,
              blockers: [{ ...dep, id: blockerId }],
            }),
          ),
        ).rejects.toThrow(ChainNotFoundError);
      }

      const staleBlocker = { ...dep, id: crypto.randomUUID() };
      await withTransaction(async (txCtx, transactionHooks) => {
        await expect(
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            input: null,
            blockers: [dep, staleBlocker],
          }),
        ).rejects.toThrow(ChainNotFoundError);
      });

      const mainJobs = await stateAdapter.listJobs({
        typeName: "main",
        orderBy: "createdAt",
        orderDirection: "asc",
        page: { limit: 10 },
      });
      expect(mainJobs.items).toEqual([]);

      const start = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({ ...txCtx, transactionHooks, typeName: "start", input: null }),
      );
      await withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...start,
          handler: async ({ job, completeJob }) => {
            if (job.typeName !== "start") return;
            await expect(
              completeJob(job, async ({ finish }) =>
                finish({
                  continueWith: {
                    typeName: "startStep",
                    input: null,
                    blockers: [staleBlocker],
                  },
                }),
              ),
            ).rejects.toThrow(ChainNotFoundError);
          },
        }),
      );

      const startJobs = await client.listChainJobs({ chainId: start.id, limit: 10 });
      expect(startJobs.items).toHaveLength(1);
      expect(startJobs.items[0].status).toBe("pending");
      const blockedJobs = await stateAdapter.listBlockedJobs({
        chainId: dep.id,
        orderDirection: "asc",
        page: { limit: 10 },
      });
      expect(blockedJobs.items).toEqual([]);
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

      const chain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: null,
          schedule: { afterMs: 60_000 },
        }),
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
        // @ts-expect-error missing txCtx
        client.createChain({ typeName: "test", input: { value: 1 } }),
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

      void withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          // @ts-expect-error wrong input type
          input: { wrong: "field" },
        }),
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

      void withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          // @ts-expect-error non-existent type
          typeName: "nonexistent",
          input: { value: 0 },
        }),
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

      void withTransaction(async (txCtx, transactionHooks) =>
        // @ts-expect-error missing required blockers
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "withBlocker",
          input: { value: 1 },
        }),
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
      const chain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          id: userId,
          input: { value: 1 },
        }),
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

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "test", input: { value: 1 } },
            { typeName: "test", input: { value: 2 } },
            { typeName: "test", input: { value: 3 } },
          ],
        }),
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

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [],
        }),
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

      const existingChain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          input: { value: 100 },
          deduplication: { key: "existing-key", scope: "running" },
        }),
      );

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
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

      const depChain = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependency",
          input: null,
        }),
      );

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
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
      );

      expect(chains).toHaveLength(2);
      expect(chains[0].status).toBe("running");
      expect(chains[1].status).toBe("running");

      const job0 = await client.getJob({ id: chains[0].id });
      const job1 = await client.getJob({ id: chains[1].id });
      expect(job0!.status).toBe("blocked");
      expect(job1!.status).toBe("blocked");
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
      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "test", input: { value: 1 }, schedule: { at: futureDate } },
            { typeName: "test", input: { value: 2 }, schedule: { afterMs: 30_000 } },
            { typeName: "test", input: { value: 3 } },
          ],
        }),
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

      const [chainA, chainB] = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "typeA", input: { a: 1 } },
            { typeName: "typeB", input: { b: "hello" } },
          ],
        }),
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

      const dep = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "dependency",
          input: null,
        }),
      );

      const [blockedChain, unblockedChain] = await withTransaction(
        async (txCtx, transactionHooks) =>
          client.createChains({
            ...txCtx,
            transactionHooks,
            items: [
              { typeName: "blocked", input: { value: 1 }, blockers: [dep] },
              { typeName: "unblocked", input: { value: 2 } },
            ],
          }),
      );

      expect(blockedChain.status).toBe("running");
      expect(unblockedChain.status).toBe("running");

      const blockedJob = await client.getJob({ id: blockedChain.id });
      const unblockedJob = await client.getJob({ id: unblockedChain.id });
      expect(blockedJob!.status).toBe("blocked");
      expect(unblockedJob!.status).toBe("pending");
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

      const blocker = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "blocker",
          input: { value: 42 },
        }),
      );

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "main", input: { label: "A" }, blockers: [blocker] },
            { typeName: "main", input: { label: "B" }, blockers: [blocker] },
            { typeName: "main", input: { label: "C" }, blockers: [blocker] },
          ],
        }),
      );

      for (const chain of chains) {
        expect(chain.status).toBe("running");
        const job = await client.getJob({ id: chain.id });
        expect(job!.status).toBe("blocked");
      }

      const worker = await createInProcessWorker({
        client,
        concurrency: 3,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            blocker: {
              attemptHandler: async ({ job, finish }) => {
                return withTransaction(async (txCtx, transactionHooks) =>
                  finish({ ...txCtx, transactionHooks, output: { result: job.input.value } }),
                );
              },
            },
            main: {
              attemptHandler: async ({ getBlockers, finish }) => {
                const blockers = await getBlockers();
                return withTransaction(async (txCtx, transactionHooks) =>
                  finish({
                    ...txCtx,
                    transactionHooks,
                    output: {
                      finalResult: blockers[0].output.result,
                    },
                  }),
                );
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

      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "test", input: { value: 10 } },
            { typeName: "test", input: { value: 20 } },
            { typeName: "test", input: { value: 30 } },
          ],
        }),
      );

      const worker = await createInProcessWorker({
        client,
        concurrency: 3,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            test: {
              attemptHandler: async ({ job, finish }) => {
                return withTransaction(async (txCtx, transactionHooks) =>
                  finish({ ...txCtx, transactionHooks, output: { result: job.input.value * 2 } }),
                );
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
        // @ts-expect-error missing txCtx
        client.createChains({
          items: [{ typeName: "test", input: { value: 1 } }],
        }),
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

      void withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            // @ts-expect-error non-existent type
            { typeName: "nonexistent", input: { value: 0 } },
          ],
        }),
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

      void withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            // @ts-expect-error wrong input for test
            { typeName: "test", input: { wrong: "field" } },
          ],
        }),
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

      void withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            // @ts-expect-error missing required blockers for withBlocker
            { typeName: "withBlocker", input: { value: 1 } },
          ],
        }),
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
      const chains = await withTransaction(async (txCtx, transactionHooks) =>
        client.createChains({
          ...txCtx,
          transactionHooks,
          items: [
            { typeName: "test", id: idA, input: { value: 1 } },
            { typeName: "test", id: idB, input: { value: 2 } },
          ],
        }),
      );

      expect(chains[0].id).toBe(idA);
      expect(chains[1].id).toBe(idB);
    });

    it("duplicate caller-supplied id errors", async ({
      stateAdapter,
      generateId,
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

      const sharedId = generateId();
      await withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "test",
          id: sharedId,
          input: null,
        }),
      );

      await expect(
        withTransaction(async (txCtx, transactionHooks) =>
          client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "test",
            id: sharedId,
            input: null,
          }),
        ),
      ).rejects.toThrow();
    });
  });
};
