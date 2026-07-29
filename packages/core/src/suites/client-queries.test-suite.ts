import { type TestAPI, describe, expect, expectTypeOf } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import {
  ChainTypeMismatchError,
  JobTypeMismatchError,
  TransactionContextRequiredError,
} from "../errors.js";
import { sleep } from "../helpers/sleep.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "../worker/create-processors.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

export const clientQueriesTestSuite = ({ it: baseIt }: { it: TestAPI<TestSuiteContext> }): void => {
  const completionOptions = {
    pollIntervalMs: 100,
    timeoutMs: 5000,
  };

  const it = baseIt
    .extend(
      "createContext",
      async ({ stateAdapter, notifyAdapter, observabilityAdapter, log, withTransaction }) =>
        async () => {
          const jobTypes = defineJobTypes<{
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
            jobTypes,
          });

          const createChain = async (
            typeName: "order" | "notification" | "report",
            input: { amount: number } | { message: string } | { type: string },
            blockers?: [{ id: string }],
          ) =>
            withTransactionHooks(async (transactionHooks) =>
              withTransaction(async (txCtx) => {
                const base = { ...txCtx, transactionHooks };
                if (typeName === "report") {
                  return client.createChain({
                    ...base,
                    typeName,
                    input: input as { type: string },
                    blockers: blockers! as never,
                  });
                }
                if (typeName === "order") {
                  return client.createChain({
                    ...base,
                    typeName,
                    input: input as { amount: number },
                  });
                }
                return client.createChain({
                  ...base,
                  typeName: typeName as "notification",
                  input: input as { message: string },
                });
              }),
            );

          return { client, createChain };
        },
    )
    .extend("runLockContention", async ({ stateAdapter, withTransaction, skip, createContext }) => {
      type Scenario = (
        client: Awaited<ReturnType<typeof createContext>>["client"],
        txCtx: { $test: true },
        ids: [string, string],
      ) => Promise<unknown>;
      return async ({ holder, waiter }: { holder: Scenario; waiter: Scenario }) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          skip();
          return;
        }

        const { client, createChain } = await createContext();
        const first = await createChain("order", { amount: 9 });
        const second = await createChain("notification", { message: "second" });
        const ids: [string, string] = [first.id, second.id];

        let releaseHolder: (() => void) | undefined;
        const holderGate = new Promise<void>((resolve) => {
          releaseHolder = resolve;
        });
        let signalHeld: (() => void) | undefined;
        const lockHeld = new Promise<void>((resolve) => {
          signalHeld = resolve;
        });

        const holderTx = withTransaction(async (txCtx) => {
          await holder(client, txCtx, ids);
          signalHeld!();
          await holderGate;
        });

        await lockHeld;

        let waiterResolved = false;
        const waiterTx = withTransaction(async (txCtx) => waiter(client, txCtx, ids)).then(
          (result) => {
            waiterResolved = true;
            return result;
          },
        );

        await sleep(200);
        expect(waiterResolved).toBe(false);

        releaseHolder!();
        await holderTx;
        await waiterTx;
        expect(waiterResolved).toBe(true);
      };
    });

  describe("getChain", () => {
    it("getChain returns undefined for nonexistent chain", async ({ createContext, expect }) => {
      const { client } = await createContext();

      const chain = await client.getChain({
        typeName: "order",
        id: "00000000-0000-0000-0000-000000000000",
      });

      expect(chain).toBeUndefined();
    });

    it("getChain returns chain by id", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 42 });

      const chain = await client.getChain({ id: created.id });

      expect(chain).not.toBeNull();
      expect(chain!.id).toBe(created.id);
      expect(chain!.typeName).toBe("order");
      expect(chain!.input).toEqual({ amount: 42 });
      expect(chain!.status).toBe("running");
    });

    it("getChain narrows return type by typeName", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("notification", { message: "hello" });

      const chain = await client.getChain({ typeName: "notification", id: created.id });

      expect(chain).not.toBeNull();
      expectTypeOf(chain!.typeName).toEqualTypeOf<"notification">();
    });

    it("getChain returns without typeName", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 42 });

      const chain = await client.getChain({ id: created.id });

      expect(chain).not.toBeNull();
      expect(chain!.typeName).toBe("order");
    });

    it("getChain throws on typeName mismatch", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 42 });

      await expect(client.getChain({ typeName: "notification", id: created.id })).rejects.toThrow(
        ChainTypeMismatchError,
      );
    });

    it("getChain supports lock: true only with a transaction context (type level)", async ({
      createContext,
    }) => {
      const { client } = await createContext();
      expectTypeOf(client.getChain).toBeCallableWith({ id: "x" });
      expectTypeOf(client.getChain).toBeCallableWith({ id: "x", lock: false });
      expectTypeOf(client.getChain).toBeCallableWith({ id: "x", lock: true, $test: true });
    });

    it("getChain returns the row under lock inside a transaction", async ({
      createContext,
      withTransaction,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 7 });

      await withTransaction(async (txCtx) => {
        const chain = await client.getChain({ ...txCtx, id: created.id, lock: true });
        expect(chain!.id).toBe(created.id);
      });
    });

    it("getChain lock: true without a transaction context throws TransactionContextRequiredError", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 3 });

      await expect(
        // @ts-expect-error lock: true without a transaction context does not compile.
        client.getChain({ id: created.id, lock: true }),
      ).rejects.toBeInstanceOf(TransactionContextRequiredError);
    });

    it("getChain lock: true on an absent row returns undefined without blocking", async ({
      createContext,
      withTransaction,
      expect,
    }) => {
      const { client } = await createContext();

      await withTransaction(async (txCtx) => {
        expect(
          await client.getChain({
            ...txCtx,
            id: "00000000-0000-0000-0000-000000000000",
            lock: true,
          }),
        ).toBeUndefined();
      });
    });

    it(
      "getChain blocks a concurrent locked read until the holder commits",
      { timeout: 15000 },
      async ({ runLockContention }) =>
        runLockContention({
          holder: async (client, txCtx, [a]) => client.getChain({ ...txCtx, id: a, lock: true }),
          waiter: async (client, txCtx, [a]) => client.getChain({ ...txCtx, id: a, lock: true }),
        }),
    );
  });

  describe("getChains", () => {
    it("getChains returns empty array for empty ids", async ({ createContext, expect }) => {
      const { client } = await createContext();

      const chains = await client.getChains({ ids: [] });

      expect(chains).toEqual([]);
    });

    it("getChains returns undefined for nonexistent ids", async ({ createContext, expect }) => {
      const { client } = await createContext();

      const chains = await client.getChains({
        ids: ["00000000-0000-0000-0000-000000000000"],
      });

      expect(chains).toEqual([undefined]);
    });

    it("getChains returns chains in input order", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 42 });
      const notification = await createChain("notification", { message: "hello" });

      const chains = await client.getChains({ ids: [notification.id, order.id] });

      expect(chains).toHaveLength(2);
      expect(chains[0]!.id).toBe(notification.id);
      expect(chains[1]!.id).toBe(order.id);
    });

    it("getChains returns mix of found and undefined", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 42 });

      const chains = await client.getChains({
        ids: ["00000000-0000-0000-0000-000000000000", created.id],
      });

      expect(chains).toHaveLength(2);
      expect(chains[0]).toBeUndefined();
      expect(chains[1]!.id).toBe(created.id);
    });

    it("getChains narrows return type by typeName", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("notification", { message: "hello" });

      const chains = await client.getChains({
        typeName: "notification",
        ids: [created.id],
      });

      expect(chains).toHaveLength(1);
      expectTypeOf(chains[0]!.typeName).toEqualTypeOf<"notification">();
    });

    it("getChains throws on typeName mismatch", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 42 });

      await expect(
        client.getChains({ typeName: "notification", ids: [created.id] }),
      ).rejects.toThrow(ChainTypeMismatchError);
    });

    it("getChains skips typeName check for undefined entries", async ({
      createContext,
      expect,
    }) => {
      const { client } = await createContext();

      const chains = await client.getChains({
        typeName: "order",
        ids: ["00000000-0000-0000-0000-000000000000"],
      });

      expect(chains).toEqual([undefined]);
    });

    it("getChains supports lock: true only with a transaction context (type level)", async ({
      createContext,
    }) => {
      const { client } = await createContext();
      expectTypeOf(client.getChains).toBeCallableWith({ ids: ["x"] });
      expectTypeOf(client.getChains).toBeCallableWith({ ids: ["x"], lock: false });
      expectTypeOf(client.getChains).toBeCallableWith({ ids: ["x"], lock: true, $test: true });
    });

    it("getChains locks every matched row inside a transaction", async ({
      createContext,
      withTransaction,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const first = await createChain("order", { amount: 1 });
      const second = await createChain("notification", { message: "hi" });

      await withTransaction(async (txCtx) => {
        const chains = await client.getChains({
          ...txCtx,
          ids: [first.id, second.id],
          lock: true,
        });
        expect(chains.map((c) => c?.id)).toEqual([first.id, second.id]);
      });
    });

    it("getChains lock: true without a transaction context throws TransactionContextRequiredError", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 3 });

      await expect(
        // @ts-expect-error lock: true without a transaction context does not compile.
        client.getChains({ ids: [created.id], lock: true }),
      ).rejects.toBeInstanceOf(TransactionContextRequiredError);
    });

    it("getChains lock: true on absent rows returns undefined entries without blocking", async ({
      createContext,
      withTransaction,
      expect,
    }) => {
      const { client } = await createContext();

      await withTransaction(async (txCtx) => {
        expect(
          await client.getChains({
            ...txCtx,
            ids: ["00000000-0000-0000-0000-000000000000"],
            lock: true,
          }),
        ).toEqual([undefined]);
      });
    });

    it(
      "getChains blocks a concurrent locked read until the holder commits",
      { timeout: 15000 },
      async ({ runLockContention }) =>
        runLockContention({
          holder: async (client, txCtx, [a, b]) =>
            client.getChains({ ...txCtx, ids: [a, b], lock: true }),
          waiter: async (client, txCtx, [, b]) =>
            client.getChains({ ...txCtx, ids: [b], lock: true }),
        }),
    );
  });

  describe("getJob", () => {
    it("getJob returns undefined for nonexistent job", async ({ createContext, expect }) => {
      const { client } = await createContext();

      const job = await client.getJob({
        typeName: "order",
        id: "00000000-0000-0000-0000-000000000000",
      });

      expect(job).toBeUndefined();
    });

    it("getJob returns job by id", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const chain = await createChain("notification", { message: "hello" });

      const job = await client.getJob({ id: chain.id });

      expect(job).not.toBeNull();
      expect(job!.id).toBe(chain.id);
      expect(job!.typeName).toBe("notification");
      expect(job!.input).toEqual({ message: "hello" });
      expect(job!.status).toBe("pending");
    });

    it("getJob returns without typeName", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const chain = await createChain("notification", { message: "hello" });

      const job = await client.getJob({ id: chain.id });

      expect(job).not.toBeNull();
      expect(job!.typeName).toBe("notification");
    });

    it("getJob throws on typeName mismatch", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const chain = await createChain("notification", { message: "hello" });

      await expect(client.getJob({ typeName: "order", id: chain.id })).rejects.toThrow(
        JobTypeMismatchError,
      );
    });

    it("getJob supports lock: true only with a transaction context (type level)", async ({
      createContext,
    }) => {
      const { client } = await createContext();
      expectTypeOf(client.getJob).toBeCallableWith({ id: "x" });
      expectTypeOf(client.getJob).toBeCallableWith({ id: "x", lock: false });
      expectTypeOf(client.getJob).toBeCallableWith({ id: "x", lock: true, $test: true });
    });

    it("getJob returns the row under lock inside a transaction", async ({
      createContext,
      withTransaction,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 7 });

      await withTransaction(async (txCtx) => {
        const job = await client.getJob({ ...txCtx, id: created.id, lock: true });
        expect(job!.id).toBe(created.id);
      });
    });

    it("getJob lock: true without a transaction context throws TransactionContextRequiredError", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 3 });

      await expect(
        // @ts-expect-error lock: true without a transaction context does not compile.
        client.getJob({ id: created.id, lock: true }),
      ).rejects.toBeInstanceOf(TransactionContextRequiredError);
    });

    it("getJob lock: true on an absent row returns undefined without blocking", async ({
      createContext,
      withTransaction,
      expect,
    }) => {
      const { client } = await createContext();

      await withTransaction(async (txCtx) => {
        expect(
          await client.getJob({
            ...txCtx,
            id: "00000000-0000-0000-0000-000000000000",
            lock: true,
          }),
        ).toBeUndefined();
      });
    });

    it(
      "getJob blocks a concurrent locked read until the holder commits",
      { timeout: 15000 },
      async ({ runLockContention }) =>
        runLockContention({
          holder: async (client, txCtx, [a]) => client.getJob({ ...txCtx, id: a, lock: true }),
          waiter: async (client, txCtx, [a]) => client.getJob({ ...txCtx, id: a, lock: true }),
        }),
    );
  });

  describe("getJobs", () => {
    it("getJobs returns empty array for empty ids", async ({ createContext, expect }) => {
      const { client } = await createContext();

      const jobs = await client.getJobs({ ids: [] });

      expect(jobs).toEqual([]);
    });

    it("getJobs returns undefined for nonexistent ids", async ({ createContext, expect }) => {
      const { client } = await createContext();

      const jobs = await client.getJobs({
        ids: ["00000000-0000-0000-0000-000000000000"],
      });

      expect(jobs).toEqual([undefined]);
    });

    it("getJobs returns jobs in input order", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 42 });
      const notification = await createChain("notification", { message: "hello" });

      const jobs = await client.getJobs({ ids: [notification.id, order.id] });

      expect(jobs).toHaveLength(2);
      expect(jobs[0]!.id).toBe(notification.id);
      expect(jobs[1]!.id).toBe(order.id);
    });

    it("getJobs returns mix of found and undefined", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("notification", { message: "hello" });

      const jobs = await client.getJobs({
        ids: ["00000000-0000-0000-0000-000000000000", created.id],
      });

      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toBeUndefined();
      expect(jobs[1]!.id).toBe(created.id);
    });

    it("getJobs narrows return type by typeName", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("notification", { message: "hello" });

      const jobs = await client.getJobs({
        typeName: "notification",
        ids: [created.id],
      });

      expect(jobs).toHaveLength(1);
      expectTypeOf(jobs[0]!.typeName).toEqualTypeOf<"notification">();
    });

    it("getJobs throws on typeName mismatch", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("notification", { message: "hello" });

      await expect(client.getJobs({ typeName: "order", ids: [created.id] })).rejects.toThrow(
        JobTypeMismatchError,
      );
    });

    it("getJobs skips typeName check for undefined entries", async ({ createContext, expect }) => {
      const { client } = await createContext();

      const jobs = await client.getJobs({
        typeName: "order",
        ids: ["00000000-0000-0000-0000-000000000000"],
      });

      expect(jobs).toEqual([undefined]);
    });

    it("getJobs supports lock: true only with a transaction context (type level)", async ({
      createContext,
    }) => {
      const { client } = await createContext();
      expectTypeOf(client.getJobs).toBeCallableWith({ ids: ["x"] });
      expectTypeOf(client.getJobs).toBeCallableWith({ ids: ["x"], lock: false });
      expectTypeOf(client.getJobs).toBeCallableWith({ ids: ["x"], lock: true, $test: true });
    });

    it("getJobs locks every matched row inside a transaction", async ({
      createContext,
      withTransaction,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const first = await createChain("order", { amount: 1 });
      const second = await createChain("notification", { message: "hi" });

      await withTransaction(async (txCtx) => {
        const jobs = await client.getJobs({
          ...txCtx,
          ids: [first.id, second.id],
          lock: true,
        });
        expect(jobs.map((j) => j?.id)).toEqual([first.id, second.id]);
      });
    });

    it("getJobs lock: true without a transaction context throws TransactionContextRequiredError", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const created = await createChain("order", { amount: 3 });

      await expect(
        // @ts-expect-error lock: true without a transaction context does not compile.
        client.getJobs({ ids: [created.id], lock: true }),
      ).rejects.toBeInstanceOf(TransactionContextRequiredError);
    });

    it("getJobs lock: true on absent rows returns undefined entries without blocking", async ({
      createContext,
      withTransaction,
      expect,
    }) => {
      const { client } = await createContext();

      await withTransaction(async (txCtx) => {
        expect(
          await client.getJobs({
            ...txCtx,
            ids: ["00000000-0000-0000-0000-000000000000"],
            lock: true,
          }),
        ).toEqual([undefined]);
      });
    });

    it(
      "getJobs blocks a concurrent locked read until the holder commits",
      { timeout: 15000 },
      async ({ runLockContention }) =>
        runLockContention({
          holder: async (client, txCtx, [a, b]) =>
            client.getJobs({ ...txCtx, ids: [a, b], lock: true }),
          waiter: async (client, txCtx, [, b]) =>
            client.getJobs({ ...txCtx, ids: [b], lock: true }),
        }),
    );
  });

  describe("listChains", () => {
    it("listChains returns empty page when no chains exist", async ({ createContext, expect }) => {
      const { client } = await createContext();

      const page = await client.listChains({});

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("listChains returns all chains", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const chain1 = await createChain("order", { amount: 100 });
      const chain2 = await createChain("notification", { message: "hi" });

      const page = await client.listChains({});

      expect(page.items).toHaveLength(2);
      const ids = page.items.map((c) => c.id);
      expect(ids).toContain(chain1.id);
      expect(ids).toContain(chain2.id);
    });

    it("listChains filters by typeName", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 100 });
      const notif = await createChain("notification", { message: "hi" });

      const page = await client.listChains({
        typeName: ["notification"],
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(notif.id);
      expect(page.items[0].typeName).toBe("notification");
    });

    it("listChains filters by id", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const chain1 = await createChain("order", { amount: 100 });
      await createChain("notification", { message: "hi" });

      const page = await client.listChains({
        chainId: [chain1.id],
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(chain1.id);
    });

    it("listChains filters root-only (excludes blocker chains)", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      await createChain("report", { type: "summary" }, [order]);

      const allChains = await client.listChains({});
      const rootChains = await client.listChains({ independent: true });

      expect(allChains.items).toHaveLength(2);
      expect(rootChains.items).toHaveLength(1);
      expect(rootChains.items[0].typeName).toBe("report");
    });

    it("listChains filters by status", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      await createChain("notification", { message: "hi" });
      await createChain("report", { type: "summary" }, [order]);

      const running = await client.listChains({ status: "running" });

      expect(running.items).toHaveLength(3);
    });

    it("listChains orders ascending", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 1 });
      await sleep(5);
      await createChain("order", { amount: 2 });

      const desc = await client.listChains({});
      const asc = await client.listChains({ orderDirection: "asc" });

      expect(desc.items).toHaveLength(2);
      expect(asc.items).toHaveLength(2);
      expect(asc.items[0].id).toBe(desc.items[1].id);
      expect(asc.items[1].id).toBe(desc.items[0].id);
    });

    it("listChains paginates with cursor", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 1 });
      await createChain("order", { amount: 2 });
      await createChain("order", { amount: 3 });

      const page1 = await client.listChains({ limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await client.listChains({ limit: 2, cursor: page1.nextCursor! });
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();

      const allIds = [...page1.items, ...page2.items].map((c) => c.id);
      expect(new Set(allIds).size).toBe(3);
    });

    it("listChains filters by date range", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const first = await createChain("order", { amount: 1 });
      const second = await createChain("order", { amount: 2 });

      const createdMs = [first.createdAt.getTime(), second.createdAt.getTime()];
      const earliest = Math.min(...createdMs);
      const latest = Math.max(...createdMs);

      const page = await client.listChains({
        from: new Date(earliest - 1000),
        to: new Date(latest + 1000),
      });

      expect(page.items).toHaveLength(2);

      const empty = await client.listChains({
        from: new Date(latest + 60_000),
      });
      expect(empty.items).toHaveLength(0);
    });

    it("listChains sorts completed chains by completedAt when orderBy is completedAt", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
      withWorkers,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        task_a: {
          entry: true;
          input: null;
          output: null;
        };
        task_b: {
          entry: true;
          input: null;
          output: null;
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            task_a: {
              attemptHandler: async ({ complete }) => complete(async () => null),
            },
            task_b: {
              attemptHandler: async ({ complete }) => complete(async () => null),
            },
          },
        }),
      });

      const chainA = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "task_a", input: null }),
        ),
      );
      await sleep(5);
      const chainB = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "task_b", input: null }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitChain(chainA, completionOptions);
        await client.awaitChain(chainB, completionOptions);
      });

      const byCreatedAt = await client.listChains({
        status: "completed",
        orderBy: "createdAt",
        orderDirection: "asc",
      });
      expect(byCreatedAt.items[0].id).toBe(chainA.id);
      expect(byCreatedAt.items[1].id).toBe(chainB.id);

      const byCompletedAt = await client.listChains({
        status: "completed",
        orderBy: "completedAt",
        orderDirection: "desc",
      });
      expect(byCompletedAt.items).toHaveLength(2);
      const [first, second] = byCompletedAt.items;
      expect(first.status).toBe("completed");
      expect(second.status).toBe("completed");
      if (first.status === "completed" && second.status === "completed") {
        expect(first.completedAt.getTime()).toBeGreaterThanOrEqual(second.completedAt.getTime());
      }
    });

    it("listChains returns correct chain shape", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const chain = await createChain("order", { amount: 42 });

      const page = await client.listChains({
        typeName: ["order"],
      });

      const result = page.items[0];
      expect(result.id).toBe(chain.id);
      expect(result.typeName).toBe("order");
      expect(result.input).toEqual({ amount: 42 });
      expect(result.status).toBe("running");
      const resultJob = await client.getJob({ id: chain.id });
      expect(resultJob!.status).toBe("pending");
      expect(result.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("listJobs", () => {
    it("listJobs returns empty page when no jobs exist", async ({ createContext, expect }) => {
      const { client } = await createContext();

      const page = await client.listJobs({});

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("listJobs returns all jobs across chains", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 100 });
      await createChain("notification", { message: "hi" });

      const page = await client.listJobs({});

      expect(page.items).toHaveLength(2);
    });

    it("listJobs filters by typeName", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 100 });
      await createChain("notification", { message: "hi" });

      const page = await client.listJobs({
        typeName: ["notification"],
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].typeName).toBe("notification");
    });

    it("listJobs filters by chainTypeName", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 100 });
      await createChain("notification", { message: "hi" });

      const page = await client.listJobs({
        chainTypeName: ["order"],
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].chainTypeName).toBe("order");

      // Type-level: chainTypeName only accepts entry job type names
      expectTypeOf(client.listJobs)
        .parameter(0)
        .toHaveProperty("chainTypeName")
        .exclude<undefined>()
        .items.toEqualTypeOf<"order" | "notification" | "report">();
    });

    it("listJobs filters by chainId", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const chain = await createChain("order", { amount: 100 });
      await createChain("notification", { message: "hi" });

      const page = await client.listJobs({
        chainId: [chain.id],
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].chainId).toBe(chain.id);
    });

    it("listJobs filters by status", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      await createChain("notification", { message: "hi" });
      await createChain("report", { type: "summary" }, [order]);

      const pending = await client.listJobs({ status: "pending" });
      const blocked = await client.listJobs({ status: "pending", blocked: true });
      const runnable = await client.listJobs({ status: "pending", blocked: false });

      expect(pending.items).toHaveLength(3);
      const report = pending.items.find((j) => j.typeName === "report");
      expect(report?.status === "pending" && report.blocked).toBe(true);

      expect(blocked.items).toHaveLength(1);
      expect(blocked.items[0].typeName).toBe("report");
      expect(blocked.items[0].status === "pending" && blocked.items[0].blocked).toBe(true);

      expect(runnable.items).toHaveLength(2);
      expect(runnable.items.map((j) => j.typeName).sort()).toEqual(["notification", "order"]);
    });

    it("listJobs orders ascending", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 1 });
      await sleep(5);
      await createChain("order", { amount: 2 });

      const desc = await client.listJobs({});
      const asc = await client.listJobs({ orderDirection: "asc" });

      expect(desc.items).toHaveLength(2);
      expect(asc.items).toHaveLength(2);
      expect(asc.items[0].id).toBe(desc.items[1].id);
      expect(asc.items[1].id).toBe(desc.items[0].id);
    });

    it("listJobs paginates with cursor", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 1 });
      await createChain("order", { amount: 2 });
      await createChain("order", { amount: 3 });

      const page1 = await client.listJobs({ limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await client.listJobs({ limit: 2, cursor: page1.nextCursor! });
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
    });

    it("listJobs filters by date range", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const first = await createChain("order", { amount: 1 });
      const second = await createChain("order", { amount: 2 });

      const createdMs = [first.createdAt.getTime(), second.createdAt.getTime()];
      const earliest = Math.min(...createdMs);
      const latest = Math.max(...createdMs);

      const page = await client.listJobs({
        from: new Date(earliest - 1000),
        to: new Date(latest + 1000),
      });
      expect(page.items).toHaveLength(2);

      const futureOnly = await client.listJobs({
        from: new Date(latest + 60_000),
      });
      expect(futureOnly.items).toHaveLength(0);

      const pastOnly = await client.listJobs({
        to: new Date(earliest - 60_000),
      });
      expect(pastOnly.items).toHaveLength(0);
    });

    it("listJobs sorts completed jobs by completedAt when orderBy is completedAt", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
      withWorkers,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
        job_a: {
          entry: true;
          input: null;
          output: null;
        };
        job_b: {
          entry: true;
          input: null;
          output: null;
        };
      }>();

      const client = await createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        log,
        jobTypes,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            job_a: {
              attemptHandler: async ({ complete }) => complete(async () => null),
            },
            job_b: {
              attemptHandler: async ({ complete }) => complete(async () => null),
            },
          },
        }),
      });

      const chainA = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "job_a", input: null }),
        ),
      );
      await sleep(5);
      const chainB = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "job_b", input: null }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitChain(chainA, completionOptions);
        await client.awaitChain(chainB, completionOptions);
      });

      const byCreatedAt = await client.listJobs({
        status: "completed",
        orderBy: "createdAt",
        orderDirection: "asc",
      });
      expect(byCreatedAt.items[0].id).toBe(chainA.id);
      expect(byCreatedAt.items[1].id).toBe(chainB.id);

      const byCompletedAt = await client.listJobs({
        status: "completed",
        orderBy: "completedAt",
        orderDirection: "desc",
      });
      expect(byCompletedAt.items).toHaveLength(2);
      const [first, second] = byCompletedAt.items;
      expect(first.status).toBe("completed");
      expect(second.status).toBe("completed");
      if (first.status === "completed" && second.status === "completed") {
        expect(first.completedAt.getTime()).toBeGreaterThanOrEqual(second.completedAt.getTime());
      }
    });

    it("listJobs sorts pending jobs by scheduledAt when orderBy is scheduledAt", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 1 });
      await sleep(5);
      await createChain("notification", { message: "hi" });

      const byScheduledAt = await client.listJobs({
        status: "pending",
        orderBy: "scheduledAt",
        orderDirection: "asc",
      });
      expect(byScheduledAt.items).toHaveLength(2);
      expect(byScheduledAt.items[0].scheduledAt.getTime()).toBeLessThanOrEqual(
        byScheduledAt.items[1].scheduledAt.getTime(),
      );
    });

    it("listJobs returns correct job shape", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("notification", { message: "test" });

      const page = await client.listJobs({ typeName: ["notification"] });
      const job = page.items[0];

      expect(job.typeName).toBe("notification");
      expect(job.input).toEqual({ message: "test" });
      expect(job.status).toBe("pending");
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.scheduledAt).toBeInstanceOf(Date);
      expect(job.id).toBe(job.chainId);
      expect(job.attempt).toBe(0);
    });
  });

  describe("listChainJobs", () => {
    it("listChainJobs returns empty page for nonexistent chain", async ({
      createContext,
      expect,
    }) => {
      const { client } = await createContext();

      const page = await client.listChainJobs({
        chainId: "00000000-0000-0000-0000-000000000000",
      });

      expect(page.items).toEqual([]);
    });

    it("listChainJobs returns jobs in chain in continuedToId order", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
      withWorkers,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            step: {
              attemptHandler: async ({ job, complete }) =>
                complete(async ({ continueWith }) =>
                  job.input.n < 2
                    ? continueWith({ typeName: "step", input: { n: job.input.n + 1 } })
                    : { done: true },
                ),
            },
          },
        }),
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "step", input: { n: 0 } }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitChain(chain, completionOptions);
      });

      const page = await client.listChainJobs({ chainId: chain.id });

      expect(page.items.length).toBe(3);
      const [first, second, third] = page.items;
      expect(first.input).toEqual({ n: 0 });
      expect(second.input).toEqual({ n: 1 });
      expect(third.input).toEqual({ n: 2 });
      expect(first.id).toBe(chain.id);
      for (const job of page.items) {
        expect(job.chainId).toBe(chain.id);
        expect(job.status).toBe("completed");
      }
      expect(first).toMatchObject({ status: "completed", continuedToId: second.id });
      expect(second).toMatchObject({ status: "completed", continuedToId: third.id });
      expect(third).toMatchObject({ status: "completed", continuedToId: null });
      expect("output" in first).toBe(false);
      expect("output" in second).toBe(false);
      expect(third).toMatchObject({ output: { done: true } });
    });

    it("listChainJobs orders descending", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
      withWorkers,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            step: {
              attemptHandler: async ({ job, complete }) =>
                complete(async ({ continueWith }) =>
                  job.input.n < 1
                    ? continueWith({ typeName: "step", input: { n: job.input.n + 1 } })
                    : { done: true },
                ),
            },
          },
        }),
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "step", input: { n: 0 } }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitChain(chain, completionOptions);
      });

      const asc = await client.listChainJobs({ chainId: chain.id });
      const desc = await client.listChainJobs({
        chainId: chain.id,
        orderDirection: "desc",
      });

      expect(asc.items[0].id).toBe(chain.id);
      expect(asc.items[1].id).not.toBe(chain.id);
      expect(desc.items[0].id).not.toBe(chain.id);
      expect(desc.items[1].id).toBe(chain.id);
    });

    it("listChainJobs paginates", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
      withWorkers,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            step: {
              attemptHandler: async ({ job, complete }) =>
                complete(async ({ continueWith }) =>
                  job.input.n < 2
                    ? continueWith({ typeName: "step", input: { n: job.input.n + 1 } })
                    : { done: true },
                ),
            },
          },
        }),
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "step", input: { n: 0 } }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitChain(chain, completionOptions);
      });

      const page1 = await client.listChainJobs({ chainId: chain.id, limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      expect(page1.items[0].id).toBe(chain.id);

      const page2 = await client.listChainJobs({
        chainId: chain.id,
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
      expect(page2.items[0].input).toEqual({ n: 2 });
    });

    it("listChainJobs only returns jobs from the specified chain", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const chain1 = await createChain("order", { amount: 1 });
      await createChain("notification", { message: "hi" });

      const page = await client.listChainJobs({ chainId: chain1.id });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].chainId).toBe(chain1.id);
    });

    it("listChainJobs narrows return type when typeName is provided", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const chain = await createChain("order", { amount: 42 });

      const page = await client.listChainJobs({ chainId: chain.id, chainTypeName: "order" });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].typeName).toBe("order");
      expectTypeOf(page.items[0].typeName).toEqualTypeOf<"order" | "order_fulfill">();
      expectTypeOf(page.items[0].input).toEqualTypeOf<{ amount: number } | { orderId: string }>();
    });

    it("listChainJobs throws on typeName mismatch", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const chain = await createChain("order", { amount: 42 });

      await expect(
        client.listChainJobs({ chainId: chain.id, chainTypeName: "notification" }),
      ).rejects.toThrow(ChainTypeMismatchError);
    });
  });

  describe("getJobBlockers", () => {
    it("getJobBlockers returns empty array when job has no blockers", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const chain = await createChain("order", { amount: 100 });

      const blockers = await client.getJobBlockers({ jobId: chain.id });

      expect(blockers).toEqual([]);
    });

    it("getJobBlockers returns blocker chains", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      const report = await createChain("report", { type: "summary" }, [order]);

      const blockers = await client.getJobBlockers({ jobId: report.id });

      expect(blockers).toHaveLength(1);
      expect(blockers[0].id).toBe(order.id);
      expect(blockers[0].typeName).toBe("order");
      expect(blockers[0].input).toEqual({ amount: 50 });
    });

    it("getJobBlockers resolves typed blockers when typeName is provided", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      const report = await createChain("report", { type: "summary" }, [order]);

      const blockers = await client.getJobBlockers({
        jobId: report.id,
        typeName: "report",
      });

      expect(blockers).toHaveLength(1);
      expect(blockers[0].typeName).toBe("order");
      expect(blockers[0].input).toEqual({ amount: 50 });

      expectTypeOf(blockers[0].typeName).toEqualTypeOf<"order">();
    });

    it("getJobBlockers throws on typeName mismatch", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      const report = await createChain("report", { type: "summary" }, [order]);

      await expect(client.getJobBlockers({ jobId: report.id, typeName: "order" })).rejects.toThrow(
        JobTypeMismatchError,
      );
    });

    it("getJobBlockers reflects blocker completion status", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
      withWorkers,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            dep: {
              attemptHandler: async ({ complete }) => complete(async () => ({ ok: true })),
            },
            main: {
              attemptHandler: async ({ complete }) => complete(async () => ({ result: "done" })),
            },
          },
        }),
      });

      const { mainChain } = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) => {
          const depChain = await client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "dep",
            input: { v: 1 },
          });
          const mainChain = await client.createChain({
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
        await client.awaitChain(mainChain, completionOptions);
      });

      const blockersAfter = await client.getJobBlockers({ jobId: mainChain.id });
      expect(blockersAfter[0].status).toBe("completed");
    });
  });

  describe("listBlockedJobs", () => {
    it("listBlockedJobs returns empty page when chain has no dependents", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const chain = await createChain("order", { amount: 100 });

      const page = await client.listBlockedJobs({ chainId: chain.id });

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("listBlockedJobs returns jobs blocked by chain", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      const report = await createChain("report", { type: "summary" }, [order]);

      const page = await client.listBlockedJobs({ chainId: order.id });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(report.id);
      expect(page.items[0].typeName).toBe("report");
      expect(page.items[0].status).toBe("pending");
      const blockedItem = page.items[0];
      expect(blockedItem.status === "pending" && blockedItem.blocked).toBe(true);
    });

    it("listBlockedJobs paginates", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      await createChain("report", { type: "a" }, [order]);
      await createChain("report", { type: "b" }, [order]);
      await createChain("report", { type: "c" }, [order]);

      const page1 = await client.listBlockedJobs({ chainId: order.id, limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await client.listBlockedJobs({
        chainId: order.id,
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
    });

    it("listBlockedJobs narrows return type when typeName is provided", async ({
      createContext,
      expect,
    }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      const report = await createChain("report", { type: "summary" }, [order]);

      const page = await client.listBlockedJobs({
        chainId: order.id,
        typeName: "order",
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(report.id);
      expect(page.items[0].typeName).toBe("report");

      expectTypeOf(page.items[0].typeName).toEqualTypeOf<"report">();
      expectTypeOf(page.items[0].input).toEqualTypeOf<{ type: string }>();
    });

    it("listBlockedJobs throws on typeName mismatch", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      await createChain("report", { type: "summary" }, [order]);

      await expect(
        client.listBlockedJobs({ chainId: order.id, typeName: "notification" }),
      ).rejects.toThrow(ChainTypeMismatchError);
    });

    it("listBlockedJobs orders ascending", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      const order = await createChain("order", { amount: 50 });
      await createChain("report", { type: "a" }, [order]);
      await sleep(5);
      await createChain("report", { type: "b" }, [order]);

      const desc = await client.listBlockedJobs({ chainId: order.id });
      const asc = await client.listBlockedJobs({ chainId: order.id, orderDirection: "asc" });

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
      observabilityAdapter,
      log,
      withTransaction,
      withWorkers,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
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
          },
        }),
      });

      const chain = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.createChain({ ...txCtx, transactionHooks, typeName: "task", input: { n: 1 } }),
        ),
      );

      await withWorkers([await worker.start()], async () => {
        await client.awaitChain(chain, completionOptions);
      });

      const headJob = await client.getJob({ id: chain.id });
      expect(headJob).not.toBeNull();
      expect(headJob!.status).toBe("completed");

      const chains = await client.listChains({ typeName: ["task"] });
      expect(chains.items).toHaveLength(1);
      const completedChain = chains.items[0];
      expect(completedChain.status).toBe("completed");
      expect((completedChain as { output: unknown }).output).toEqual({ final: 20 });

      const jobs = await client.listJobs({ chainId: [chain.id] });
      expect(jobs.items).toHaveLength(2);
      expect(jobs.items.every((j) => j.status === "completed")).toBe(true);

      const chainJobs = await client.listChainJobs({ chainId: chain.id });
      expect(chainJobs.items).toHaveLength(2);
      expect(chainJobs.items[0].typeName).toBe("task");
      expect(chainJobs.items[1].typeName).toBe("task_next");
    });

    it("query methods work with blockers across chains", async ({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      withTransaction,
      withWorkers,
      expect,
    }) => {
      const jobTypes = defineJobTypes<{
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
        jobTypes,
      });

      const worker = await createInProcessWorker({
        client,
        concurrency: 1,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            dep: {
              attemptHandler: async ({ complete }) => complete(async () => ({ ok: true })),
            },
            main: {
              attemptHandler: async ({ complete }) => complete(async () => ({ result: "done" })),
            },
          },
        }),
      });

      const { depChain, mainChain } = await withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) => {
          const depChain = await client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "dep",
            input: { v: 1 },
          });
          const mainChain = await client.createChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            input: { start: true },
            blockers: [depChain],
          });
          return { depChain, mainChain };
        }),
      );

      const mainJob = await client.getJob({ id: mainChain.id });
      expect(mainJob!.status).toBe("pending");
      expect(mainJob!.status === "pending" && mainJob!.blocked).toBe(true);

      const blocked = await client.listBlockedJobs({ chainId: depChain.id });
      expect(blocked.items).toHaveLength(1);
      expect(blocked.items[0].id).toBe(mainChain.id);

      const blockers = await client.getJobBlockers({ jobId: mainChain.id });
      expect(blockers).toHaveLength(1);
      expect(blockers[0].id).toBe(depChain.id);

      await withWorkers([await worker.start()], async () => {
        await client.awaitChain(mainChain, completionOptions);
      });

      const completedMain = await client.getJob({ id: mainChain.id });
      expect(completedMain!.status).toBe("completed");

      const completedDep = await client.getJob({ id: depChain.id });
      expect(completedDep!.status).toBe("completed");
    });

    it("default limit is applied when not specified", async ({ createContext, expect }) => {
      const { client, createChain } = await createContext();
      await createChain("order", { amount: 1 });

      const chains = await client.listChains({});
      const jobs = await client.listJobs({});

      expect(chains.items).toHaveLength(1);
      expect(jobs.items).toHaveLength(1);
    });
  });
};
