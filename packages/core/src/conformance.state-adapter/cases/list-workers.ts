import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers/sleep";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const listWorkersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listWorkers",
  cases: [
    {
      name: "returns an empty page when no worker has a row",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        assert.deepEqual(
          await stateAdapter.listWorkers({ orderDirection: "asc", page: { limit: 10 } }),
          {
            items: [],
            nextCursor: null,
          },
        );
      },
    },
    {
      name: "orders workers by startedAt",
      run: async ({ createStateAdapter }) => {
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

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [firstWorkerId, secondWorkerId, thirdWorkerId],
        );
      },
    },
    {
      name: "orders workers by startedAt descending when orderDirection is desc",
      run: async ({ createStateAdapter }) => {
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

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [thirdWorkerId, secondWorkerId, firstWorkerId],
        );
      },
    },
    {
      name: "paginates with cursor",
      run: async ({ createStateAdapter }) => {
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
        assert.deepEqual(
          firstPage.items.map((worker) => worker.id),
          [firstWorkerId, secondWorkerId],
        );
        assert.notEqual(firstPage.nextCursor, null);

        const secondPage = await stateAdapter.listWorkers({
          orderDirection: "asc",
          page: { limit: 2, cursor: firstPage.nextCursor! },
        });
        assert.deepEqual(
          secondPage.items.map((worker) => worker.id),
          [thirdWorkerId],
        );
        assert.equal(secondPage.nextCursor, null);
      },
    },
    {
      name: "paginates with cursor in desc order",
      run: async ({ createStateAdapter }) => {
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
        assert.deepEqual(
          firstPage.items.map((worker) => worker.id),
          [thirdWorkerId, secondWorkerId],
        );
        assert.notEqual(firstPage.nextCursor, null);

        const secondPage = await stateAdapter.listWorkers({
          orderDirection: "desc",
          page: { limit: 2, cursor: firstPage.nextCursor! },
        });
        assert.deepEqual(
          secondPage.items.map((worker) => worker.id),
          [firstWorkerId],
        );
        assert.equal(secondPage.nextCursor, null);
      },
    },
    {
      name: "keeps only the workers that process typeName",
      run: async ({ createStateAdapter }) => {
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

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [emailWorkerId, bothWorkerId],
        );
        assert.deepEqual(
          await stateAdapter.listWorkers({
            typeName: "ship-order",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
          { items: [], nextCursor: null },
        );
      },
    },
    {
      name: "includes an unreclaimed worker whose lease is no longer live",
      run: async ({ createStateAdapter }) => {
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

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [liveWorkerId, expiredWorkerId],
        );
        assert.ok(workers[1].leaseUntil.getTime() <= Date.now() + 1_000);
      },
    },
    {
      name: "excludes stopped workers",
      run: async ({ createStateAdapter }) => {
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

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [liveWorkerId],
        );
      },
    },
    {
      name: "filters by status, live or expired",
      run: async ({ createStateAdapter }) => {
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
        assert.deepEqual(
          firstLivePage.items.map((worker) => [worker.id, worker.expired]),
          [
            [firstLiveWorkerId, false],
            [secondLiveWorkerId, false],
          ],
        );
        assert.notEqual(firstLivePage.nextCursor, null);

        const secondLivePage = await stateAdapter.listWorkers({
          status: "live",
          orderDirection: "asc",
          page: { limit: 2, cursor: firstLivePage.nextCursor! },
        });
        assert.deepEqual(
          secondLivePage.items.map((worker) => worker.id),
          [thirdLiveWorkerId],
        );
        assert.equal(secondLivePage.nextCursor, null);

        const expiredPage = await stateAdapter.listWorkers({
          status: "expired",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        assert.deepEqual(
          expiredPage.items.map((worker) => [worker.id, worker.expired]),
          [[expiredWorkerId, true]],
        );
        assert.equal(expiredPage.nextCursor, null);

        const { items: allWorkers } = await stateAdapter.listWorkers({
          orderDirection: "asc",
          page: { limit: 10 },
        });
        assert.deepEqual(
          allWorkers.map((worker) => worker.id),
          [firstLiveWorkerId, expiredWorkerId, secondLiveWorkerId, thirdLiveWorkerId],
        );
      },
    },
    {
      name: "filters by status and typeName together",
      run: async ({ createStateAdapter }) => {
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

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [expiredEmailWorkerId],
        );
      },
    },
  ],
};
