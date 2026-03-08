import { type TestAPI, describe, expectTypeOf } from "vitest";
import {
  JobTypeMismatchError,
  createClient,
  createInProcessWorker,
  defineJobTypeProcessorRegistry,
  defineJobTypes,
  withTransactionHooks,
} from "../index.js";
import { sleep } from "../helpers/sleep.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const clientQueriesTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  const createContext = async ({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log,
    runInTransaction,
  }: Pick<
    TestSuiteContext,
    "stateAdapter" | "notifyAdapter" | "observabilityAdapter" | "log" | "runInTransaction"
  >) => {
    const registry = defineJobTypes<{
      order: {
        entry: true;
        input: { amount: number };
        output: { receipt: string };
        continueWith: { typeName: "order_fulfill" };
      };
      order_fulfill: {
        input: { orderId: string };
        output: { shipped: boolean };
      };
      notification: {
        entry: true;
        input: { message: string };
        output: { sent: boolean };
      };
      report: {
        entry: true;
        input: { type: string };
        output: { data: string };
        blockers: [{ typeName: "order" }];
      };
    }>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry,
    });

    const startChain = async (
      typeName: "order" | "notification" | "report",
      input: { amount: number } | { message: string } | { type: string },
      blockers?: [{ id: string }],
    ) =>
      withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) => {
          const base = { ...txCtx, transactionHooks };
          if (typeName === "report") {
            return client.startJobChain({
              ...base,
              typeName,
              input: input as { type: string },
              blockers: blockers! as never,
            });
          }
          if (typeName === "order") {
            return client.startJobChain({
              ...base,
              typeName,
              input: input as { amount: number },
            });
          }
          return client.startJobChain({
            ...base,
            typeName: typeName as "notification",
            input: input as { message: string },
          });
        }),
      );

    return { client, registry, startChain };
  };

  describe("getJobChain", () => {
    it("getJobChain returns undefined for nonexistent chain", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });

      const chain = await client.getJobChain({
        typeName: "order",
        id: "00000000-0000-0000-0000-000000000000",
      });

      expect(chain).toBeUndefined();
    });

    it("getJobChain returns chain by id", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const created = await startChain("order", { amount: 42 });

      const chain = await client.getJobChain({ typeName: "order", id: created.id });

      expect(chain).not.toBeNull();
      expect(chain!.id).toBe(created.id);
      expect(chain!.typeName).toBe("order");
      expect(chain!.input).toEqual({ amount: 42 });
      expect(chain!.status).toBe("pending");
    });

    it("getJobChain narrows return type by typeName", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const created = await startChain("notification", { message: "hello" });

      const chain = await client.getJobChain({ typeName: "notification", id: created.id });

      expect(chain).not.toBeNull();
      expectTypeOf(chain!.typeName).toEqualTypeOf<"notification">();
    });

    it("getJobChain returns without typeName", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const created = await startChain("order", { amount: 42 });

      const chain = await client.getJobChain({ id: created.id });

      expect(chain).not.toBeNull();
      expect(chain!.typeName).toBe("order");
    });

    it("getJobChain throws on typeName mismatch", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const created = await startChain("order", { amount: 42 });

      await expect(
        client.getJobChain({ typeName: "notification", id: created.id }),
      ).rejects.toThrow(JobTypeMismatchError);
    });
  });

  describe("getJob", () => {
    it("getJob returns undefined for nonexistent job", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });

      const job = await client.getJob({
        typeName: "order",
        id: "00000000-0000-0000-0000-000000000000",
      });

      expect(job).toBeUndefined();
    });

    it("getJob returns job by id", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain = await startChain("notification", { message: "hello" });

      const job = await client.getJob({ typeName: "notification", id: chain.id });

      expect(job).not.toBeNull();
      expect(job!.id).toBe(chain.id);
      expect(job!.typeName).toBe("notification");
      expect(job!.input).toEqual({ message: "hello" });
      expect(job!.status).toBe("pending");
    });

    it("getJob returns without typeName", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain = await startChain("notification", { message: "hello" });

      const job = await client.getJob({ id: chain.id });

      expect(job).not.toBeNull();
      expect(job!.typeName).toBe("notification");
    });

    it("getJob throws on typeName mismatch", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain = await startChain("notification", { message: "hello" });

      await expect(client.getJob({ typeName: "order", id: chain.id })).rejects.toThrow(
        JobTypeMismatchError,
      );
    });
  });

  describe("listJobChains", () => {
    it("listJobChains returns empty page when no chains exist", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });

      const page = await client.listJobChains({});

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("listJobChains returns all chains", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain1 = await startChain("order", { amount: 100 });
      const chain2 = await startChain("notification", { message: "hi" });

      const page = await client.listJobChains({});

      expect(page.items).toHaveLength(2);
      const ids = page.items.map((c) => c.id);
      expect(ids).toContain(chain1.id);
      expect(ids).toContain(chain2.id);
    });

    it("listJobChains filters by typeName", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 100 });
      const notif = await startChain("notification", { message: "hi" });

      const page = await client.listJobChains({
        filter: { typeName: ["notification"] },
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(notif.id);
      expect(page.items[0].typeName).toBe("notification");
    });

    it("listJobChains filters by id", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain1 = await startChain("order", { amount: 100 });
      await startChain("notification", { message: "hi" });

      const page = await client.listJobChains({
        filter: { id: [chain1.id] },
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(chain1.id);
    });

    it("listJobChains filters root-only (excludes blocker chains)", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      await startChain("report", { type: "summary" }, [order]);

      const allChains = await client.listJobChains({});
      const rootChains = await client.listJobChains({ filter: { root: true } });

      expect(allChains.items).toHaveLength(2);
      expect(rootChains.items).toHaveLength(1);
      expect(rootChains.items[0].typeName).toBe("report");
    });

    it("listJobChains filters by status", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      await startChain("notification", { message: "hi" });
      await startChain("report", { type: "summary" }, [order]);

      const blocked = await client.listJobChains({ filter: { status: ["blocked"] } });
      const pending = await client.listJobChains({ filter: { status: ["pending"] } });

      expect(blocked.items).toHaveLength(1);
      expect(blocked.items[0].typeName).toBe("report");
      expect(pending.items).toHaveLength(2);
    });

    it("listJobChains orders ascending", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 1 });
      await sleep(5);
      await startChain("order", { amount: 2 });

      const desc = await client.listJobChains({});
      const asc = await client.listJobChains({ orderDirection: "asc" });

      expect(desc.items).toHaveLength(2);
      expect(asc.items).toHaveLength(2);
      expect(asc.items[0].id).toBe(desc.items[1].id);
      expect(asc.items[1].id).toBe(desc.items[0].id);
    });

    it("listJobChains paginates with cursor", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 1 });
      await startChain("order", { amount: 2 });
      await startChain("order", { amount: 3 });

      const page1 = await client.listJobChains({ limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await client.listJobChains({ limit: 2, cursor: page1.nextCursor! });
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();

      const allIds = [...page1.items, ...page2.items].map((c) => c.id);
      expect(new Set(allIds).size).toBe(3);
    });

    it("listJobChains filters by date range", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 1 });
      await startChain("order", { amount: 2 });

      const page = await client.listJobChains({
        filter: { from: new Date(Date.now() - 5000), to: new Date() },
      });

      expect(page.items).toHaveLength(2);

      const empty = await client.listJobChains({
        filter: { from: new Date(Date.now() + 60_000) },
      });
      expect(empty.items).toHaveLength(0);
    });

    it("listJobChains filters by jobId", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain1 = await startChain("order", { amount: 100 });
      await startChain("notification", { message: "hi" });

      const page = await client.listJobChains({
        filter: { jobId: [chain1.id] },
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(chain1.id);
    });

    it("listJobChains returns correct chain shape", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain = await startChain("order", { amount: 42 });

      const page = await client.listJobChains({
        filter: { typeName: ["order"] },
      });

      const result = page.items[0];
      expect(result.id).toBe(chain.id);
      expect(result.typeName).toBe("order");
      expect(result.input).toEqual({ amount: 42 });
      expect(result.status).toBe("pending");
      expect(result.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("listJobs", () => {
    it("listJobs returns empty page when no jobs exist", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });

      const page = await client.listJobs({});

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("listJobs returns all jobs across chains", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 100 });
      await startChain("notification", { message: "hi" });

      const page = await client.listJobs({});

      expect(page.items).toHaveLength(2);
    });

    it("listJobs filters by typeName", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 100 });
      await startChain("notification", { message: "hi" });

      const page = await client.listJobs({
        filter: { typeName: ["notification"] },
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].typeName).toBe("notification");
    });

    it("listJobs filters by jobChainId", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain = await startChain("order", { amount: 100 });
      await startChain("notification", { message: "hi" });

      const page = await client.listJobs({
        filter: { jobChainId: [chain.id] },
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].chainId).toBe(chain.id);
    });

    it("listJobs filters by status", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      await startChain("notification", { message: "hi" });
      await startChain("report", { type: "summary" }, [order]);

      const blocked = await client.listJobs({ filter: { status: ["blocked"] } });
      const pending = await client.listJobs({ filter: { status: ["pending"] } });

      expect(blocked.items).toHaveLength(1);
      expect(blocked.items[0].typeName).toBe("report");
      expect(pending.items).toHaveLength(2);
    });

    it("listJobs orders ascending", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 1 });
      await sleep(5);
      await startChain("order", { amount: 2 });

      const desc = await client.listJobs({});
      const asc = await client.listJobs({ orderDirection: "asc" });

      expect(desc.items).toHaveLength(2);
      expect(asc.items).toHaveLength(2);
      expect(asc.items[0].id).toBe(desc.items[1].id);
      expect(asc.items[1].id).toBe(desc.items[0].id);
    });

    it("listJobs paginates with cursor", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 1 });
      await startChain("order", { amount: 2 });
      await startChain("order", { amount: 3 });

      const page1 = await client.listJobs({ limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await client.listJobs({ limit: 2, cursor: page1.nextCursor! });
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
    });

    it("listJobs filters by date range", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 1 });
      await startChain("order", { amount: 2 });

      const page = await client.listJobs({
        filter: { from: new Date(Date.now() - 5000), to: new Date() },
      });
      expect(page.items).toHaveLength(2);

      const futureOnly = await client.listJobs({
        filter: { from: new Date(Date.now() + 60_000) },
      });
      expect(futureOnly.items).toHaveLength(0);

      const pastOnly = await client.listJobs({
        filter: { to: new Date(Date.now() - 60_000) },
      });
      expect(pastOnly.items).toHaveLength(0);
    });

    it("listJobs returns correct job shape", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("notification", { message: "test" });

      const page = await client.listJobs({ filter: { typeName: ["notification"] } });
      const job = page.items[0];

      expect(job.typeName).toBe("notification");
      expect(job.input).toEqual({ message: "test" });
      expect(job.status).toBe("pending");
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.scheduledAt).toBeInstanceOf(Date);
      expect(job.chainIndex).toBe(0);
      expect(job.attempt).toBe(0);
    });
  });

  describe("listJobChainJobs", () => {
    it("listJobChainJobs returns empty page for nonexistent chain", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });

      const page = await client.listJobChainJobs({
        jobChainId: "00000000-0000-0000-0000-000000000000",
      });

      expect(page.items).toEqual([]);
    });

    it("listJobChainJobs returns jobs in chain ordered by chainIndex", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypes<{
        step: {
          entry: true;
          input: { n: number };
          output: { done: boolean };
          continueWith: { typeName: "step" };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processorRegistry: defineJobTypeProcessorRegistry(client, registry, {
          step: {
            attemptHandler: async ({ job, complete }) =>
              complete(async ({ continueWith }) =>
                job.input.n < 2
                  ? continueWith({ typeName: "step", input: { n: job.input.n + 1 } })
                  : { done: true },
              ),
          },
        }),
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({ ...txCtx, transactionHooks, typeName: "step", input: { n: 0 } }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitJobChain(chain, completionOptions);
      });

      const page = await client.listJobChainJobs({ jobChainId: chain.id });

      expect(page.items.length).toBe(3);
      expect(page.items[0].chainIndex).toBe(0);
      expect(page.items[1].chainIndex).toBe(1);
      expect(page.items[2].chainIndex).toBe(2);
      expect(page.items[0].input).toEqual({ n: 0 });
      expect(page.items[1].input).toEqual({ n: 1 });
      expect(page.items[2].input).toEqual({ n: 2 });
      for (const job of page.items) {
        expect(job.chainId).toBe(chain.id);
        expect(job.status).toBe("completed");
      }
    });

    it("listJobChainJobs orders descending", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypes<{
        step: {
          entry: true;
          input: { n: number };
          output: { done: boolean };
          continueWith: { typeName: "step" };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processorRegistry: defineJobTypeProcessorRegistry(client, registry, {
          step: {
            attemptHandler: async ({ job, complete }) =>
              complete(async ({ continueWith }) =>
                job.input.n < 1
                  ? continueWith({ typeName: "step", input: { n: job.input.n + 1 } })
                  : { done: true },
              ),
          },
        }),
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({ ...txCtx, transactionHooks, typeName: "step", input: { n: 0 } }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitJobChain(chain, completionOptions);
      });

      const asc = await client.listJobChainJobs({ jobChainId: chain.id });
      const desc = await client.listJobChainJobs({
        jobChainId: chain.id,
        orderDirection: "desc",
      });

      expect(asc.items[0].chainIndex).toBe(0);
      expect(asc.items[1].chainIndex).toBe(1);
      expect(desc.items[0].chainIndex).toBe(1);
      expect(desc.items[1].chainIndex).toBe(0);
    });

    it("listJobChainJobs paginates", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypes<{
        step: {
          entry: true;
          input: { n: number };
          output: { done: boolean };
          continueWith: { typeName: "step" };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processorRegistry: defineJobTypeProcessorRegistry(client, registry, {
          step: {
            attemptHandler: async ({ job, complete }) =>
              complete(async ({ continueWith }) =>
                job.input.n < 2
                  ? continueWith({ typeName: "step", input: { n: job.input.n + 1 } })
                  : { done: true },
              ),
          },
        }),
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({ ...txCtx, transactionHooks, typeName: "step", input: { n: 0 } }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitJobChain(chain, completionOptions);
      });

      const page1 = await client.listJobChainJobs({ jobChainId: chain.id, limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      expect(page1.items[0].chainIndex).toBe(0);
      expect(page1.items[1].chainIndex).toBe(1);

      const page2 = await client.listJobChainJobs({
        jobChainId: chain.id,
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
      expect(page2.items[0].chainIndex).toBe(2);
    });

    it("listJobChainJobs only returns jobs from the specified chain", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain1 = await startChain("order", { amount: 1 });
      await startChain("notification", { message: "hi" });

      const page = await client.listJobChainJobs({ jobChainId: chain1.id });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].chainId).toBe(chain1.id);
    });

    it("listJobChainJobs narrows return type when typeName is provided", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain = await startChain("order", { amount: 42 });

      const page = await client.listJobChainJobs({ jobChainId: chain.id, typeName: "order" });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].typeName).toBe("order");
      expectTypeOf(page.items[0].typeName).toEqualTypeOf<"order" | "order_fulfill">();
      expectTypeOf(page.items[0].input).toEqualTypeOf<{ amount: number } | { orderId: string }>();
    });

    it("listJobChainJobs throws on typeName mismatch", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain = await startChain("order", { amount: 42 });

      await expect(
        client.listJobChainJobs({ jobChainId: chain.id, typeName: "notification" }),
      ).rejects.toThrow(JobTypeMismatchError);
    });
  });

  describe("getJobBlockers", () => {
    it("getJobBlockers returns empty array when job has no blockers", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain = await startChain("order", { amount: 100 });

      const blockers = await client.getJobBlockers({ jobId: chain.id });

      expect(blockers).toEqual([]);
    });

    it("getJobBlockers returns blocker chains", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      const report = await startChain("report", { type: "summary" }, [order]);

      const blockers = await client.getJobBlockers({ jobId: report.id });

      expect(blockers).toHaveLength(1);
      expect(blockers[0].id).toBe(order.id);
      expect(blockers[0].typeName).toBe("order");
      expect(blockers[0].input).toEqual({ amount: 50 });
    });

    it("getJobBlockers resolves typed blockers when typeName is provided", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      const report = await startChain("report", { type: "summary" }, [order]);

      const blockers = await client.getJobBlockers({
        jobId: report.id,
        typeName: "report",
      });

      expect(blockers).toHaveLength(1);
      expect(blockers[0].typeName).toBe("order");
      expect(blockers[0].input).toEqual({ amount: 50 });

      expectTypeOf(blockers[0].typeName).toEqualTypeOf<"order">();
    });

    it("getJobBlockers throws on typeName mismatch", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      const report = await startChain("report", { type: "summary" }, [order]);

      await expect(client.getJobBlockers({ jobId: report.id, typeName: "order" })).rejects.toThrow(
        JobTypeMismatchError,
      );
    });

    it("getJobBlockers reflects blocker completion status", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypes<{
        dep: {
          entry: true;
          input: { v: number };
          output: { ok: boolean };
        };
        main: {
          entry: true;
          input: { start: boolean };
          output: { result: string };
          blockers: [{ typeName: "dep" }];
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processorRegistry: defineJobTypeProcessorRegistry(client, registry, {
          dep: {
            attemptHandler: async ({ complete }) => complete(async () => ({ ok: true })),
          },
          main: {
            attemptHandler: async ({ complete }) => complete(async () => ({ result: "done" })),
          },
        }),
      });

      const { mainChain } = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) => {
          const depChain = await client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "dep",
            input: { v: 1 },
          });
          const mainChain = await client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            input: { start: true },
            blockers: [depChain],
          });
          return { depChain, mainChain };
        }),
      );

      const blockersBefore = await client.getJobBlockers({ jobId: mainChain.id });
      expect(blockersBefore[0].status).not.toBe("completed");

      await withWorkers([await worker.start()], async () => {
        await client.awaitJobChain(mainChain, completionOptions);
      });

      const blockersAfter = await client.getJobBlockers({ jobId: mainChain.id });
      expect(blockersAfter[0].status).toBe("completed");
    });
  });

  describe("listBlockedJobs", () => {
    it("listBlockedJobs returns empty page when chain has no dependents", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const chain = await startChain("order", { amount: 100 });

      const page = await client.listBlockedJobs({ jobChainId: chain.id });

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("listBlockedJobs returns jobs blocked by chain", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      const report = await startChain("report", { type: "summary" }, [order]);

      const page = await client.listBlockedJobs({ jobChainId: order.id });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(report.id);
      expect(page.items[0].typeName).toBe("report");
      expect(page.items[0].status).toBe("blocked");
    });

    it("listBlockedJobs paginates", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      await startChain("report", { type: "a" }, [order]);
      await startChain("report", { type: "b" }, [order]);
      await startChain("report", { type: "c" }, [order]);

      const page1 = await client.listBlockedJobs({ jobChainId: order.id, limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await client.listBlockedJobs({
        jobChainId: order.id,
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
    });

    it("listBlockedJobs narrows return type when typeName is provided", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      const report = await startChain("report", { type: "summary" }, [order]);

      const page = await client.listBlockedJobs({
        jobChainId: order.id,
        typeName: "order",
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(report.id);
      expect(page.items[0].typeName).toBe("report");

      expectTypeOf(page.items[0].typeName).toEqualTypeOf<"report">();
      expectTypeOf(page.items[0].input).toEqualTypeOf<{ type: string }>();
    });

    it("listBlockedJobs throws on typeName mismatch", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      await startChain("report", { type: "summary" }, [order]);

      await expect(
        client.listBlockedJobs({ jobChainId: order.id, typeName: "notification" }),
      ).rejects.toThrow(JobTypeMismatchError);
    });

    it("listBlockedJobs orders ascending", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      const order = await startChain("order", { amount: 50 });
      await startChain("report", { type: "a" }, [order]);
      await sleep(5);
      await startChain("report", { type: "b" }, [order]);

      const desc = await client.listBlockedJobs({ jobChainId: order.id });
      const asc = await client.listBlockedJobs({ jobChainId: order.id, orderDirection: "asc" });

      expect(desc.items).toHaveLength(2);
      expect(asc.items).toHaveLength(2);
      expect(asc.items[0].id).toBe(desc.items[1].id);
      expect(asc.items[1].id).toBe(desc.items[0].id);
    });
  });

  describe("cross-method integration", () => {
    it("query methods return consistent data after chain completion", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypes<{
        task: {
          entry: true;
          input: { n: number };
          output: { result: number };
          continueWith: { typeName: "task_next" };
        };
        task_next: {
          input: { n: number };
          output: { final: number };
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processorRegistry: defineJobTypeProcessorRegistry(client, registry, {
          task: {
            attemptHandler: async ({ job, complete }) =>
              complete(async ({ continueWith }) =>
                continueWith({ typeName: "task_next", input: { n: job.input.n + 1 } }),
              ),
          },
          task_next: {
            attemptHandler: async ({ job, complete }) =>
              complete(async () => ({ final: job.input.n * 10 })),
          },
        }),
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) =>
          client.startJobChain({ ...txCtx, transactionHooks, typeName: "task", input: { n: 1 } }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitJobChain(chain, completionOptions);
      });

      const rootJob = await client.getJob({ typeName: "task", id: chain.id });
      expect(rootJob).not.toBeNull();
      expect(rootJob!.status).toBe("completed");

      const chains = await client.listJobChains({ filter: { typeName: ["task"] } });
      expect(chains.items).toHaveLength(1);
      const completedChain = chains.items[0];
      expect(completedChain.status).toBe("completed");
      expect((completedChain as { output: unknown }).output).toEqual({ final: 20 });

      const jobs = await client.listJobs({ filter: { jobChainId: [chain.id] } });
      expect(jobs.items).toHaveLength(2);
      expect(jobs.items.every((j) => j.status === "completed")).toBe(true);

      const chainJobs = await client.listJobChainJobs({ jobChainId: chain.id });
      expect(chainJobs.items).toHaveLength(2);
      expect(chainJobs.items[0].typeName).toBe("task");
      expect(chainJobs.items[1].typeName).toBe("task_next");
    });

    it("query methods work with blockers across chains", async ({
      stateAdapter,
      notifyAdapter,
      runInTransaction,
      withWorkers,
      observabilityAdapter,
      log,
      expect,
    }) => {
      const registry = defineJobTypes<{
        dep: {
          entry: true;
          input: { v: number };
          output: { ok: boolean };
        };
        main: {
          entry: true;
          input: { start: boolean };
          output: { result: string };
          blockers: [{ typeName: "dep" }];
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        registry,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processorRegistry: defineJobTypeProcessorRegistry(client, registry, {
          dep: {
            attemptHandler: async ({ complete }) => complete(async () => ({ ok: true })),
          },
          main: {
            attemptHandler: async ({ complete }) => complete(async () => ({ result: "done" })),
          },
        }),
      });

      const { depChain, mainChain } = await withTransactionHooks(async (transactionHooks) =>
        runInTransaction(async (txCtx) => {
          const depChain = await client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "dep",
            input: { v: 1 },
          });
          const mainChain = await client.startJobChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            input: { start: true },
            blockers: [depChain],
          });
          return { depChain, mainChain };
        }),
      );

      const mainJob = await client.getJob({ typeName: "main", id: mainChain.id });
      expect(mainJob!.status).toBe("blocked");

      const blocked = await client.listBlockedJobs({ jobChainId: depChain.id });
      expect(blocked.items).toHaveLength(1);
      expect(blocked.items[0].id).toBe(mainChain.id);

      const blockers = await client.getJobBlockers({ jobId: mainChain.id });
      expect(blockers).toHaveLength(1);
      expect(blockers[0].id).toBe(depChain.id);

      await withWorkers([await worker.start()], async () => {
        await client.awaitJobChain(mainChain, completionOptions);
      });

      const completedMain = await client.getJob({ typeName: "main", id: mainChain.id });
      expect(completedMain!.status).toBe("completed");

      const completedDep = await client.getJob({ typeName: "dep", id: depChain.id });
      expect(completedDep!.status).toBe("completed");
    });

    it("default limit is applied when not specified", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      runInTransaction,
      expect,
    }) => {
      const { client, startChain } = await createContext({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        runInTransaction,
      });
      await startChain("order", { amount: 1 });

      const chains = await client.listJobChains({});
      const jobs = await client.listJobs({});

      expect(chains.items).toHaveLength(1);
      expect(jobs.items).toHaveLength(1);
    });
  });
};
