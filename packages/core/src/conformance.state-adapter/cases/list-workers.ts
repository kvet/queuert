import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const listWorkersGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listWorkers",
  cases: [
    {
      name: "returns an empty page when no worker has a row",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        assert.deepEqual(
          yield* step(stateAdapter.listWorkers({ orderDirection: "asc", page: { limit: 10 } })),
          {
            items: [],
            nextCursor: null,
          },
        );
      }),
    },
    {
      name: "orders workers by startedAt",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const thirdWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: firstWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: secondWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: thirdWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );

        const { items: workers } = yield* step(
          stateAdapter.listWorkers({
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [firstWorkerId, secondWorkerId, thirdWorkerId],
        );
      }),
    },
    {
      name: "orders workers by startedAt descending when orderDirection is desc",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const thirdWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: firstWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: secondWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: thirdWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );

        const { items: workers } = yield* step(
          stateAdapter.listWorkers({
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [thirdWorkerId, secondWorkerId, firstWorkerId],
        );
      }),
    },
    {
      name: "paginates with cursor",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const thirdWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: firstWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: secondWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: thirdWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );

        const firstPage = yield* step(
          stateAdapter.listWorkers({
            orderDirection: "asc",
            page: { limit: 2 },
          }),
        );
        assert.deepEqual(
          firstPage.items.map((worker) => worker.id),
          [firstWorkerId, secondWorkerId],
        );
        assert.notEqual(firstPage.nextCursor, null);

        const secondPage = yield* step(
          stateAdapter.listWorkers({
            orderDirection: "asc",
            page: { limit: 2, cursor: firstPage.nextCursor! },
          }),
        );
        assert.deepEqual(
          secondPage.items.map((worker) => worker.id),
          [thirdWorkerId],
        );
        assert.equal(secondPage.nextCursor, null);
      }),
    },
    {
      name: "paginates with cursor in desc order",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const firstWorkerId = stateAdapter.config.generateWorkerId();
        const secondWorkerId = stateAdapter.config.generateWorkerId();
        const thirdWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: firstWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: secondWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: thirdWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );

        const firstPage = yield* step(
          stateAdapter.listWorkers({
            orderDirection: "desc",
            page: { limit: 2 },
          }),
        );
        assert.deepEqual(
          firstPage.items.map((worker) => worker.id),
          [thirdWorkerId, secondWorkerId],
        );
        assert.notEqual(firstPage.nextCursor, null);

        const secondPage = yield* step(
          stateAdapter.listWorkers({
            orderDirection: "desc",
            page: { limit: 2, cursor: firstPage.nextCursor! },
          }),
        );
        assert.deepEqual(
          secondPage.items.map((worker) => worker.id),
          [firstWorkerId],
        );
        assert.equal(secondPage.nextCursor, null);
      }),
    },
    {
      name: "keeps only the workers that process typeName",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const emailWorkerId = stateAdapter.config.generateWorkerId();
        const bothWorkerId = stateAdapter.config.generateWorkerId();
        const crmWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: emailWorkerId,
            typeNames: ["send-welcome-email"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: bothWorkerId,
            typeNames: ["sync-to-crm", "send-welcome-email"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.startWorker({
            workerId: crmWorkerId,
            typeNames: ["sync-to-crm"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );

        const { items: workers } = yield* step(
          stateAdapter.listWorkers({
            typeName: "send-welcome-email",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [emailWorkerId, bothWorkerId],
        );
        assert.deepEqual(
          yield* step(
            stateAdapter.listWorkers({
              typeName: "ship-order",
              orderDirection: "asc",
              page: { limit: 10 },
            }),
          ),
          { items: [], nextCursor: null },
        );
      }),
    },
    {
      name: "includes an unreclaimed worker whose lease is no longer live",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const liveWorkerId = stateAdapter.config.generateWorkerId();
        const expiredWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: liveWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: expiredWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 0,
          }),
        );

        const { items: workers } = yield* step(
          stateAdapter.listWorkers({
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [liveWorkerId, expiredWorkerId],
        );
        assert.ok(workers[1].leaseUntil.getTime() <= Date.now() + 1_000);
      }),
    },
    {
      name: "excludes stopped workers",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const liveWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: liveWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const stoppedWorker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.stopWorker({
            workerId: stoppedWorker.id,
            workerToken: stoppedWorker.token,
          }),
        );

        const { items: workers } = yield* step(
          stateAdapter.listWorkers({
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [liveWorkerId],
        );
      }),
    },
    {
      name: "filters by status, live or expired",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const firstLiveWorkerId = stateAdapter.config.generateWorkerId();
        const expiredWorkerId = stateAdapter.config.generateWorkerId();
        const secondLiveWorkerId = stateAdapter.config.generateWorkerId();
        const thirdLiveWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: firstLiveWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: expiredWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 0,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: secondLiveWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* wait(sleep(5));
        yield* step(
          stateAdapter.startWorker({
            workerId: thirdLiveWorkerId,
            typeNames: [],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );

        const firstLivePage = yield* step(
          stateAdapter.listWorkers({
            status: "live",
            orderDirection: "asc",
            page: { limit: 2 },
          }),
        );
        assert.deepEqual(
          firstLivePage.items.map((worker) => [worker.id, worker.expired]),
          [
            [firstLiveWorkerId, false],
            [secondLiveWorkerId, false],
          ],
        );
        assert.notEqual(firstLivePage.nextCursor, null);

        const secondLivePage = yield* step(
          stateAdapter.listWorkers({
            status: "live",
            orderDirection: "asc",
            page: { limit: 2, cursor: firstLivePage.nextCursor! },
          }),
        );
        assert.deepEqual(
          secondLivePage.items.map((worker) => worker.id),
          [thirdLiveWorkerId],
        );
        assert.equal(secondLivePage.nextCursor, null);

        const expiredPage = yield* step(
          stateAdapter.listWorkers({
            status: "expired",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(
          expiredPage.items.map((worker) => [worker.id, worker.expired]),
          [[expiredWorkerId, true]],
        );
        assert.equal(expiredPage.nextCursor, null);

        const { items: allWorkers } = yield* step(
          stateAdapter.listWorkers({
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(
          allWorkers.map((worker) => worker.id),
          [firstLiveWorkerId, expiredWorkerId, secondLiveWorkerId, thirdLiveWorkerId],
        );
      }),
    },
    {
      name: "filters by status and typeName together",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const liveEmailWorkerId = stateAdapter.config.generateWorkerId();
        const expiredEmailWorkerId = stateAdapter.config.generateWorkerId();
        const expiredCrmWorkerId = stateAdapter.config.generateWorkerId();
        yield* step(
          stateAdapter.startWorker({
            workerId: liveEmailWorkerId,
            typeNames: ["send-welcome-email"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.startWorker({
            workerId: expiredEmailWorkerId,
            typeNames: ["send-welcome-email"],
            concurrency: 1,
            leaseMs: 0,
          }),
        );
        yield* step(
          stateAdapter.startWorker({
            workerId: expiredCrmWorkerId,
            typeNames: ["sync-to-crm"],
            concurrency: 1,
            leaseMs: 0,
          }),
        );

        const { items: workers } = yield* step(
          stateAdapter.listWorkers({
            typeName: "send-welcome-email",
            status: "expired",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          workers.map((worker) => worker.id),
          [expiredEmailWorkerId],
        );
      }),
    },
  ],
};
