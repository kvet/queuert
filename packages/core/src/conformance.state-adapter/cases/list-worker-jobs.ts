import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const listWorkerJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listWorkerJobs",
  cases: [
    {
      name: "lists the jobs running under the worker across types, ordered by attemptAt",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["reserve-stock", "ship-order"],
            concurrency: 3,
            leaseMs: 60_000,
          }),
        );
        const otherWorker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["reserve-stock"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "reserve-stock", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "ship-order", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "reserve-stock", input: null },
              ],
            }),
          ),
        );
        const [first] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["reserve-stock"],
            limit: 1,
          }),
        );
        yield* wait(sleep(5));
        const [second] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["ship-order"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: otherWorker.id,
            workerToken: otherWorker.token,
            typeNames: ["reserve-stock"],
            limit: 1,
          }),
        );

        const { items: jobs } = yield* step(
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          jobs.map((job) => job.id),
          [first.id, second.id],
        );
        assert.deepEqual(
          jobs.map((job) => [job.status, job.attemptBy, job.chain.id]),
          [
            ["running", worker.id, first.chainId],
            ["running", worker.id, second.chainId],
          ],
        );
      }),
    },
    {
      name: "orders jobs attempted at the same time by id",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["daily-digest"],
            concurrency: 3,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              ],
            }),
          ),
        );
        const claimed = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["daily-digest"],
            limit: 3,
          }),
        );

        const { items: jobs } = yield* step(
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          jobs.map((job) => job.id),
          claimed.map((job) => job.id).toSorted(),
        );
      }),
    },
    {
      name: "paginates jobs attempted at the same time by id in both directions",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["daily-digest"],
            concurrency: 3,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [0, 1, 2].map(() => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "daily-digest",
                input: null,
              })),
            }),
          ),
        );
        const claimed = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["daily-digest"],
            limit: 3,
          }),
        );
        const [firstId, secondId, thirdId] = claimed.map((job) => job.id).toSorted();
        const listSameTimeWorkerJobs = function* (orderDirection: "asc" | "desc", cursor?: string) {
          return yield* step(
            stateAdapter.listWorkerJobs({
              workerId: worker.id,
              orderDirection,
              page: { limit: 2, cursor },
            }),
          );
        };

        const ascPage = yield* listSameTimeWorkerJobs("asc");
        assert.deepEqual(
          ascPage.items.map((job) => job.id),
          [firstId, secondId],
        );
        assert.deepEqual(
          (yield* listSameTimeWorkerJobs("asc", ascPage.nextCursor!)).items.map((job) => job.id),
          [thirdId],
        );

        const descPage = yield* listSameTimeWorkerJobs("desc");
        assert.deepEqual(
          descPage.items.map((job) => job.id),
          [thirdId, secondId],
        );
        assert.deepEqual(
          (yield* listSameTimeWorkerJobs("desc", descPage.nextCursor!)).items.map((job) => job.id),
          [firstId],
        );
      }),
    },
    {
      name: "excludes jobs the worker completed and jobs reclaimed from it",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["capture-payment"],
            concurrency: 3,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "capture-payment",
                  input: null,
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "capture-payment",
                  input: null,
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "capture-payment",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [completed, rescheduled, running] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["capture-payment"],
            limit: 3,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [
                {
                  jobId: completed.id,
                  output: null,
                  attemptToken: completed.attemptToken!,
                  workerId: completed.attemptBy!,
                },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [
              {
                jobId: rescheduled.id,
                error: "JobAttemptReclaimedError",
                attemptToken: rescheduled.attemptToken!,
              },
            ],
          }),
        );

        const { items: jobs } = yield* step(
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          jobs.map((job) => job.id),
          [running.id],
        );
      }),
    },
    {
      name: "lists a running job whose worker row is gone",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["provision-account"],
            concurrency: 2,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "provision-account",
                  input: null,
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "provision-account",
                  input: null,
                },
              ],
            }),
          ),
        );
        const claimed = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["provision-account"],
            limit: 2,
          }),
        );
        yield* step(
          stateAdapter.stopWorker({
            workerId: worker.id,
            workerToken: worker.token,
          }),
        );

        const { items: jobs } = yield* step(
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(yield* step(stateAdapter.getWorkers({ workerIds: [worker.id] })), [
          undefined,
        ]);
        assert.deepEqual(
          jobs.map((job) => job.id).toSorted(),
          claimed.map((job) => job.id).toSorted(),
        );
      }),
    },
    {
      name: "returns an empty page for an unknown worker",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        assert.deepEqual(
          yield* step(
            stateAdapter.listWorkerJobs({
              workerId: stateAdapter.config.generateWorkerId(),
              orderDirection: "asc",
              page: { limit: 10 },
            }),
          ),
          { items: [], nextCursor: null },
        );
      }),
    },
    {
      name: "orders jobs descending when orderDirection is desc",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["daily-digest"],
            concurrency: 3,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              ],
            }),
          ),
        );
        const claimed = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["daily-digest"],
            limit: 3,
          }),
        );
        const [firstJobId, secondJobId, thirdJobId] = claimed.map((job) => job.id).toSorted();

        const { items: jobs } = yield* step(
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );

        assert.deepEqual(
          jobs.map((job) => job.id),
          [thirdJobId, secondJobId, firstJobId],
        );
      }),
    },
    {
      name: "paginates with cursor",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["daily-digest"],
            concurrency: 3,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              ],
            }),
          ),
        );
        const claimed = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["daily-digest"],
            limit: 3,
          }),
        );
        const [firstJobId, secondJobId, thirdJobId] = claimed.map((job) => job.id).toSorted();

        const firstPage = yield* step(
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection: "asc",
            page: { limit: 2 },
          }),
        );
        assert.deepEqual(
          firstPage.items.map((job) => job.id),
          [firstJobId, secondJobId],
        );
        assert.notEqual(firstPage.nextCursor, null);

        const secondPage = yield* step(
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection: "asc",
            page: { limit: 2, cursor: firstPage.nextCursor! },
          }),
        );
        assert.deepEqual(
          secondPage.items.map((job) => job.id),
          [thirdJobId],
        );
        assert.equal(secondPage.nextCursor, null);
      }),
    },
    {
      name: "paginates with cursor in desc order",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["daily-digest"],
            concurrency: 3,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "daily-digest", input: null },
              ],
            }),
          ),
        );
        const claimed = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["daily-digest"],
            limit: 3,
          }),
        );
        const [firstJobId, secondJobId, thirdJobId] = claimed.map((job) => job.id).toSorted();

        const firstPage = yield* step(
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection: "desc",
            page: { limit: 2 },
          }),
        );
        assert.deepEqual(
          firstPage.items.map((job) => job.id),
          [thirdJobId, secondJobId],
        );
        assert.notEqual(firstPage.nextCursor, null);

        const secondPage = yield* step(
          stateAdapter.listWorkerJobs({
            workerId: worker.id,
            orderDirection: "desc",
            page: { limit: 2, cursor: firstPage.nextCursor! },
          }),
        );
        assert.deepEqual(
          secondPage.items.map((job) => job.id),
          [firstJobId],
        );
        assert.equal(secondPage.nextCursor, null);
      }),
    },
  ],
};
