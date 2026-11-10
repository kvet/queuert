import { sleep } from "@queuert/helpers";

import type { ConformanceGroup } from "../runner.ts";
import type { StateAdapterConformanceContext } from "./types.ts";

export const listWorkersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listWorkers",
  cases: [
    {
      name: "returns an empty page when no worker has a row",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        expect(
          await stateAdapter.listWorkers({ orderDirection: "asc", page: { limit: 10 } }),
        ).toEqual({
          items: [],
          nextCursor: null,
        });
      },
    },
    {
      name: "orders workers by startedAt",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const thirdWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: firstWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: secondWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: thirdWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const { items: workers } = await stateAdapter.listWorkers({
          orderDirection: "asc",
          page: { limit: 10 },
        });

        expect(workers.map((worker) => worker.id)).toEqual([
          firstWorkerId,
          secondWorkerId,
          thirdWorkerId,
        ]);
      },
    },
    {
      name: "orders workers by startedAt descending when orderDirection is desc",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const thirdWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: firstWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: secondWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: thirdWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const { items: workers } = await stateAdapter.listWorkers({
          orderDirection: "desc",
          page: { limit: 10 },
        });

        expect(workers.map((worker) => worker.id)).toEqual([
          thirdWorkerId,
          secondWorkerId,
          firstWorkerId,
        ]);
      },
    },
    {
      name: "paginates with cursor",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const thirdWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: firstWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: secondWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: thirdWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const firstPage = await stateAdapter.listWorkers({
          orderDirection: "asc",
          page: { limit: 2 },
        });
        expect(firstPage.items.map((worker) => worker.id)).toEqual([firstWorkerId, secondWorkerId]);
        expect(firstPage.nextCursor).not.toBeNull();

        const secondPage = await stateAdapter.listWorkers({
          orderDirection: "asc",
          page: { limit: 2, cursor: firstPage.nextCursor! },
        });
        expect(secondPage.items.map((worker) => worker.id)).toEqual([thirdWorkerId]);
        expect(secondPage.nextCursor).toBeNull();
      },
    },
    {
      name: "paginates with cursor in desc order",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const thirdWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: firstWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: secondWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: thirdWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const firstPage = await stateAdapter.listWorkers({
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(firstPage.items.map((worker) => worker.id)).toEqual([thirdWorkerId, secondWorkerId]);
        expect(firstPage.nextCursor).not.toBeNull();

        const secondPage = await stateAdapter.listWorkers({
          orderDirection: "desc",
          page: { limit: 2, cursor: firstPage.nextCursor! },
        });
        expect(secondPage.items.map((worker) => worker.id)).toEqual([firstWorkerId]);
        expect(secondPage.nextCursor).toBeNull();
      },
    },
    {
      name: "keeps only the workers that process typeName",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const emailWorkerId = stateAdapter.config.generateWorkerId();
        const bothWorkerId = stateAdapter.config.generateWorkerId();
        const crmWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: emailWorkerId,
          typeNames: ["send-welcome-email"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: bothWorkerId,
          typeNames: ["sync-to-crm", "send-welcome-email"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: crmWorkerId,
          typeNames: ["sync-to-crm"],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const { items: workers } = await stateAdapter.listWorkers({
          typeName: "send-welcome-email",
          orderDirection: "asc",
          page: { limit: 10 },
        });

        expect(workers.map((worker) => worker.id)).toEqual([emailWorkerId, bothWorkerId]);
        expect(
          await stateAdapter.listWorkers({
            typeName: "ship-order",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        ).toEqual({ items: [], nextCursor: null });
      },
    },
    {
      name: "includes an unreclaimed worker whose lease is no longer live",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const liveWorkerId = stateAdapter.config.generateWorkerId();
        const expiredWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: liveWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: expiredWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 0,
        });

        const { items: workers } = await stateAdapter.listWorkers({
          orderDirection: "asc",
          page: { limit: 10 },
        });

        expect(workers.map((worker) => worker.id)).toEqual([liveWorkerId, expiredWorkerId]);
        expect(workers[1].leaseUntil.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
      },
    },
    {
      name: "excludes stopped workers",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const liveWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: liveWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const stoppedWorker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.stopWorker({
          workerId: stoppedWorker.id,
          workerToken: stoppedWorker.token,
        });

        const { items: workers } = await stateAdapter.listWorkers({
          orderDirection: "asc",
          page: { limit: 10 },
        });

        expect(workers.map((worker) => worker.id)).toEqual([liveWorkerId]);
      },
    },
    {
      name: "filters by status, live or expired",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const firstLiveWorkerId = stateAdapter.config.generateWorkerId();
        const expiredWorkerId = stateAdapter.config.generateWorkerId();
        const secondLiveWorkerId = stateAdapter.config.generateWorkerId();
        const thirdLiveWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: firstLiveWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: expiredWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 0,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: secondLiveWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await sleep(5);
        await stateAdapter.startWorker({
          workerId: thirdLiveWorkerId,
          typeNames: [],
          concurrency: 1,
          leaseMs: 60_000,
        });

        const firstLivePage = await stateAdapter.listWorkers({
          status: "live",
          orderDirection: "asc",
          page: { limit: 2 },
        });
        expect(firstLivePage.items.map((worker) => [worker.id, worker.expired])).toEqual([
          [firstLiveWorkerId, false],
          [secondLiveWorkerId, false],
        ]);
        expect(firstLivePage.nextCursor).not.toBeNull();

        const secondLivePage = await stateAdapter.listWorkers({
          status: "live",
          orderDirection: "asc",
          page: { limit: 2, cursor: firstLivePage.nextCursor! },
        });
        expect(secondLivePage.items.map((worker) => worker.id)).toEqual([thirdLiveWorkerId]);
        expect(secondLivePage.nextCursor).toBeNull();

        const expiredPage = await stateAdapter.listWorkers({
          status: "expired",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(expiredPage.items.map((worker) => [worker.id, worker.expired])).toEqual([
          [expiredWorkerId, true],
        ]);
        expect(expiredPage.nextCursor).toBeNull();

        const { items: allWorkers } = await stateAdapter.listWorkers({
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(allWorkers.map((worker) => worker.id)).toEqual([
          firstLiveWorkerId,
          expiredWorkerId,
          secondLiveWorkerId,
          thirdLiveWorkerId,
        ]);
      },
    },
    {
      name: "filters by status and typeName together",
      run: async ({ createStateAdapter }, expect) => {
        await using stateAdapter = await createStateAdapter();

        const liveEmailWorkerId = stateAdapter.config.generateWorkerId();
        const expiredEmailWorkerId = stateAdapter.config.generateWorkerId();
        const expiredCrmWorkerId = stateAdapter.config.generateWorkerId();
        await stateAdapter.startWorker({
          workerId: liveEmailWorkerId,
          typeNames: ["send-welcome-email"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        await stateAdapter.startWorker({
          workerId: expiredEmailWorkerId,
          typeNames: ["send-welcome-email"],
          concurrency: 1,
          leaseMs: 0,
        });
        await stateAdapter.startWorker({
          workerId: expiredCrmWorkerId,
          typeNames: ["sync-to-crm"],
          concurrency: 1,
          leaseMs: 0,
        });

        const { items: workers } = await stateAdapter.listWorkers({
          typeName: "send-welcome-email",
          status: "expired",
          orderDirection: "asc",
          page: { limit: 10 },
        });

        expect(workers.map((worker) => worker.id)).toEqual([expiredEmailWorkerId]);
      },
    },
  ],
};
