import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const countRunningJobsByWorkerIdGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "countRunningJobsByWorkerId",
  cases: [
    {
      name: "returns an empty array for empty ids",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        assert.deepEqual(
          yield* step(stateAdapter.countRunningJobsByWorkerId({ workerIds: [] })),
          [],
        );
      }),
    },
    {
      name: "counts only the jobs running under each worker, in input order",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["get-count"],
            concurrency: 5,
            leaseMs: 60_000,
          }),
        );
        const otherWorker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["get-count-other"],
            concurrency: 5,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "get-count", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "get-count", input: null },
                { id: stateAdapter.config.generateJobId(), typeName: "get-count", input: null },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "get-count-other",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [completed] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["get-count"],
            limit: 3,
          }),
        );
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: otherWorker.id,
            workerToken: otherWorker.token,
            typeNames: ["get-count-other"],
            limit: 1,
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

        assert.deepEqual(
          yield* step(
            stateAdapter.countRunningJobsByWorkerId({
              workerIds: [worker.id, otherWorker.id, stateAdapter.config.generateWorkerId()],
            }),
          ),
          [2, 1, 0],
        );
      }),
    },
    {
      name: "counts a running job whose worker row is gone",
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
        yield* step(
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

        assert.deepEqual(yield* step(stateAdapter.getWorkers({ workerIds: [worker.id] })), [
          undefined,
        ]);
        assert.deepEqual(
          yield* step(stateAdapter.countRunningJobsByWorkerId({ workerIds: [worker.id] })),
          [2],
        );
      }),
    },
  ],
};
