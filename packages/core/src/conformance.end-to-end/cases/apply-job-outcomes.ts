import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { sleep } from "@queuert/helpers/sleep";
import { dynamicSyncAsync, syncAsync, resource, step, wait } from "@queuert/sync-async";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { runInModeOf } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import {
  JobBlockerLimitExceededError,
  ChainTypeMismatchError,
  JobAlreadyCompletedError,
  JobNotFoundError,
  JobStatusMismatchError,
  JobTakenByAnotherWorkerError,
  JobsStatusMismatchError,
  JobTypeMismatchError,
  JobTypeValidationError,
  JobsTypeValidationError,
  JobsAlreadyCompletedError,
  JobsNotFoundError,
  JobsTypeMismatchError,
  JobsBlockerLimitExceededError,
} from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createJobTypes } from "../../job-types/job-types.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createCaseStateAdapter } from "../support/create-case-state-adapter.ts";
import { createSpyNotifyAdapter } from "../support/spy-notify-adapter.ts";
import type { EndToEndSavepointContext } from "../types.ts";

const hourMs = 60 * 60 * 1000;

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

export const applyJobOutcomesGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "apply-job-outcomes",
  cases: [
    {
      name: "applyJobOutcome with output completes a pending job and its chain by id and typeName",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: { value: 42 } }),
          ),
        );

        const completed = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "test" },
              output: { result: 84 },
            }),
          ),
        );

        assert.partialDeepStrictEqual(completed, {
          id: chain.id,
          typeName: "test",
          status: "completed",
          output: { result: 84 },
        });
        assert.equal(completed.continuedTo, undefined);
        assert.partialDeepStrictEqual(yield* step(client.getChain({ id: chain.id })), {
          status: "completed",
          output: { result: 84 },
        });
      }),
    },
    {
      name: "applyJobOutcome with continueWith completes the job and returns its continuation",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          start: {
            entry: true;
            input: { requestId: string };
            continueWith: { typeName: "step-a" };
          };
          "step-a": { input: { valueA: number }; continueWith: { typeName: "step-b" } };
          "step-b": { input: { valueB: boolean }; output: { result: string } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "start", input: { requestId: "req-1" } }),
          ),
        );

        const completedStart = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "start" },
              continueWith: { typeName: "step-a", input: { valueA: 42 } },
            }),
          ),
        );
        assert.equal(completedStart.status, "completed");
        assert.partialDeepStrictEqual(completedStart.continuedTo, {
          typeName: "step-a",
          status: "pending",
          chainId: chain.id,
          chainTypeName: "start",
          input: { valueA: 42 },
        });

        const completedStepA = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: completedStart.continuedTo.id, typeName: "step-a" },
              continueWith: { typeName: "step-b", input: { valueB: true } },
            }),
          ),
        );
        assert.equal(completedStepA.chainTypeName, "start");

        const completedStepB = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: completedStepA.continuedTo.id, typeName: "step-b" },
              output: { result: "done" },
            }),
          ),
        );
        assert.partialDeepStrictEqual(completedStepB, {
          status: "completed",
          chainTypeName: "start",
          output: { result: "done" },
        });

        assert.partialDeepStrictEqual(yield* step(client.getChain({ id: chain.id })), {
          status: "completed",
          output: { result: "done" },
        });
      }),
    },
    {
      name: "applyJobOutcome completes the tail read earlier with a locked getChainTailJob",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          order: { entry: true; input: { orderId: string }; continueWith: { typeName: "pay" } };
          pay: { input: { orderId: string }; output: { paid: boolean } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "order", input: { orderId: "o-1" } }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "order" },
              continueWith: { typeName: "pay", input: { orderId: "o-1" } },
            }),
          ),
        );

        const completed = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const job = yield* step(
                  client.getChainTailJob({
                    ...txCtx,
                    chainId: chain.id,
                    chainTypeName: "order",
                    lock: "exclusive",
                  }),
                );
                if (job?.typeName !== "pay" || job.status === "completed") {
                  throw new Error(`unexpected tail ${job?.typeName} ${job?.status}`);
                }
                return yield* step(
                  client.applyJobOutcome({ ...txCtx, job, output: { paid: true } }),
                );
              }),
            ),
          ),
        );

        assert.partialDeepStrictEqual(completed, {
          typeName: "pay",
          status: "completed",
          output: { paid: true },
        });
        assert.partialDeepStrictEqual(yield* step(client.getChain({ id: chain.id })), {
          status: "completed",
          output: { paid: true },
        });
      }),
    },
    {
      name: "applyJobOutcome with output completes a blocked job",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: null };
          main: {
            entry: true;
            input: null;
            output: { done: boolean };
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [blockerChain, mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const blockerChain = yield* step(
                  client.createChain({ ...txCtx, typeName: "blocker", input: null }),
                );
                const mainChain = yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "main",
                    input: null,
                    blockers: [blockerChain],
                  }),
                );
                return [blockerChain, mainChain] as const;
              }),
            ),
          ),
        );
        assert.equal((yield* step(client.getJob({ id: mainChain.id })))!.status, "blocked");

        const completed = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: mainChain.id, typeName: "main" },
              output: { done: true },
            }),
          ),
        );

        assert.partialDeepStrictEqual(completed, { status: "completed", output: { done: true } });
        assert.partialDeepStrictEqual(yield* step(client.getChain({ id: mainChain.id })), {
          status: "completed",
        });
        assert.equal((yield* step(client.getJob({ id: blockerChain.id })))!.status, "pending");
      }),
    },
    {
      name: "applyJobOutcome continueWith blockers block the continuation until applyJobOutcome completes the blocker",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: { value: number } };
          starter: { entry: true; input: null; continueWith: { typeName: "next" } };
          next: { input: null; output: null; blockers: [{ typeName: "blocker" }] };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [blockerChain, starterChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "blocker", input: null },
                { typeName: "starter", input: null },
              ],
            }),
          ),
        );

        const completedStarter = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: starterChain.id, typeName: "starter" },
              continueWith: { typeName: "next", input: null, blockers: [blockerChain] },
            }),
          ),
        );
        assert.equal(completedStarter.continuedTo.status, "blocked");

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: blockerChain.id, typeName: "blocker" },
              output: { value: 7 },
            }),
          ),
        );

        const continuation = yield* step(
          client.getJob({ id: completedStarter.continuedTo.id, typeName: "next" }),
        );
        assert.equal(continuation!.status, "pending");
        assert.partialDeepStrictEqual(
          yield* step(client.getJobBlockers({ jobId: continuation!.id, typeName: "next" })),
          [{ id: blockerChain.id, status: "completed", output: { value: 7 } }],
        );
      }),
    },
    {
      name: "applyJobOutcome rejects continueWith declaring more blockers than the limit",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: null };
          starter: { entry: true; input: null; output: null; continueWith: { typeName: "next" } };
          next: { input: null; output: null; blockers: [{ typeName: "blocker" }] };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [blockerChain, starterChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "blocker", input: null },
                { typeName: "starter", input: null },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  assertRejects(
                    () =>
                      client.applyJobOutcome({
                        ...txCtx,
                        job: { id: starterChain.id, typeName: "starter" },
                        continueWith: {
                          typeName: "next",
                          input: null,
                          blockers: Array.from(
                            { length: stateAdapter.config.maxBlockersPerJob + 1 },
                            () => blockerChain,
                          ) as [typeof blockerChain],
                        },
                      }),
                    (error) => {
                      assert.ok(error instanceof JobBlockerLimitExceededError);
                      assert.equal(error.count, stateAdapter.config.maxBlockersPerJob + 1);
                      assert.equal(error.limit, stateAdapter.config.maxBlockersPerJob);
                      assert.equal(error.typeName, "next");
                      return true;
                    },
                  ),
                );
              }),
            ),
          ),
        );

        const jobs = yield* step(client.listChainJobs({ chainId: starterChain.id, limit: 10 }));
        assert.equal(jobs.items.length, 1);
        assert.equal(jobs.items[0].status, "pending");
      }),
    },
    {
      name: "a chain advanced partially without a worker is finished by a worker",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          "awaiting-approval": {
            entry: true;
            input: { requestId: string };
            continueWith: { typeName: "process-approved" };
          };
          "process-approved": { input: { approved: boolean }; output: { done: true } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                "process-approved": {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { done: true } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "awaiting-approval",
              input: { requestId: "req-123" },
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "awaiting-approval" },
              continueWith: { typeName: "process-approved", input: { approved: true } },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const succeededChain = yield* wait(client.awaitChain({ chain, ...completionOptions }));

        assert.deepEqual(succeededChain.output, { done: true });
      }),
    },
    {
      name: "applyJobOutcome throws JobAlreadyCompletedError for a completed job, also in the same transaction",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          review: {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "archive" };
          };
          archive: { input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "review", input: null }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  client.applyJobOutcome({
                    ...txCtx,
                    job: { id: chain.id, typeName: "review" },
                    output: { approved: true },
                  }),
                );
                yield* step(
                  assertRejects(
                    () =>
                      client.applyJobOutcome({
                        ...txCtx,
                        job: { id: chain.id, typeName: "review" },
                        continueWith: { typeName: "archive", input: null },
                      }),
                    JobAlreadyCompletedError,
                  ),
                );
              }),
            ),
          ),
        );

        for (const outcome of [
          { output: { approved: false } },
          { continueWith: { typeName: "archive" as const, input: null } },
          { reschedule: { afterMs: 0 } },
        ]) {
          yield* step(
            assertRejects(
              () =>
                stateAdapter.withTransaction((txCtx) =>
                  client.applyJobOutcome({
                    ...txCtx,
                    job: { id: chain.id, typeName: "review" },
                    ...outcome,
                  }),
                ),
              (error) => {
                assert.ok(error instanceof JobAlreadyCompletedError);
                assert.equal(error.jobId, chain.id);
                return true;
              },
            ),
          );
        }

        assert.partialDeepStrictEqual(yield* step(client.getChain({ id: chain.id })), {
          status: "completed",
          output: { approved: true },
        });
      }),
    },
    {
      name: "applyJobOutcome throws JobStatusMismatchError for a job read earlier whose status changed",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );
        const readEarlier = yield* step(client.getJob({ id: chain.id, typeName: "test" }));
        assert.equal(readEarlier!.status, "pending");
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({ ...txCtx, job: { id: chain.id }, reschedule: { afterMs: 0 } }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({ ...txCtx, job: readEarlier!, output: null }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { ...readEarlier!, status: "running" },
                  output: null,
                }),
              ),
            JobAlreadyCompletedError,
          ),
        );

        const fresh = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );
        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: fresh.id, typeName: "test", status: "running" },
                  output: null,
                }),
              ),
            (error) => {
              assert.ok(error instanceof JobStatusMismatchError);
              assert.equal(error.jobId, fresh.id);
              assert.equal(error.expectedStatus, "running");
              assert.equal(error.actualStatus, "pending");
              return true;
            },
          ),
        );
        assert.equal((yield* step(client.getJob({ id: fresh.id })))!.status, "pending");
      }),
    },
    {
      name: "applyJobOutcomes throws JobsStatusMismatchError listing every job whose status changed and writes nothing",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [unchanged, completed, rescheduled] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: null },
                { typeName: "test", input: null },
                { typeName: "test", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: completed.id, typeName: "test" },
              output: null,
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcomes({
                  ...txCtx,
                  items: [
                    { job: { id: unchanged.id, status: "pending" }, reschedule: { afterMs: 0 } },
                    { job: { id: rescheduled.id, status: "blocked" }, reschedule: { afterMs: 0 } },
                    { job: { id: completed.id, status: "pending" }, reschedule: { afterMs: 0 } },
                  ],
                }),
              ),
            JobsAlreadyCompletedError,
          ),
        );
        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcomes({
                  ...txCtx,
                  items: [
                    {
                      job: { id: unchanged.id, status: "pending" },
                      reschedule: { afterMs: hourMs },
                    },
                    {
                      job: { id: rescheduled.id, status: "blocked" },
                      reschedule: { afterMs: hourMs },
                    },
                  ],
                }),
              ),
            (error) => {
              assert.ok(error instanceof JobsStatusMismatchError);
              assert.deepEqual(error.jobIds, [rescheduled.id]);
              assert.deepEqual(error.actualStatuses, ["pending"]);
              return true;
            },
          ),
        );

        const jobs = yield* step(client.getJobs({ ids: [unchanged.id, rescheduled.id] }));
        for (const job of jobs) {
          assert.ok(job!.scheduledAt.getTime() < Date.now() + 60_000);
        }
      }),
    },
    {
      name: "applyJobOutcome throws JobNotFoundError for a missing job",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({ ...txCtx, ids: [chain.id] }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: chain.id, typeName: "test" },
                  output: null,
                }),
              ),
            (error) => {
              assert.ok(error instanceof JobNotFoundError);
              assert.equal(error.jobId, chain.id);
              return true;
            },
          ),
        );
      }),
    },
    {
      name: "applyJobOutcome throws JobTypeMismatchError when job.typeName differs from the stored job",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          order: { entry: true; input: { amount: number }; output: { receipt: string } };
          notification: { entry: true; input: { message: string }; output: { sent: boolean } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "order", input: { amount: 42 } }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: chain.id, typeName: "notification" },
                  output: { sent: true },
                }),
              ),
            (error) => {
              assert.ok(error instanceof JobTypeMismatchError);
              assert.equal(error.expectedTypeName, "notification");
              assert.equal(error.actualTypeName, "order");
              return true;
            },
          ),
        );

        assert.equal((yield* step(client.getJob({ id: chain.id })))!.status, "pending");
      }),
    },
    {
      name: "applyJobOutcomes throws JobsTypeMismatchError listing every job whose typeName differs and writes nothing",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          order: { entry: true; input: { amount: number }; output: { receipt: string } };
          notification: { entry: true; input: { message: string }; output: { sent: boolean } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [orderChain, notificationChain, matchingChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "order", input: { amount: 42 } },
                { typeName: "notification", input: { message: "hi" } },
                { typeName: "order", input: { amount: 7 } },
              ],
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcomes({
                  ...txCtx,
                  items: [
                    {
                      job: { id: orderChain.id, typeName: "notification" },
                      output: { sent: true },
                    },
                    {
                      job: { id: matchingChain.id, typeName: "order" },
                      output: { receipt: "r-7" },
                    },
                    {
                      job: { id: notificationChain.id, typeName: "order" },
                      reschedule: { afterMs: hourMs },
                    },
                  ],
                }),
              ),
            (error) => {
              assert.ok(error instanceof JobsTypeMismatchError);
              assert.deepEqual(error.jobIds, [orderChain.id, notificationChain.id]);
              assert.deepEqual(error.expectedTypeNames, ["notification", "order"]);
              assert.deepEqual(error.actualTypeNames, ["order", "notification"]);
              return true;
            },
          ),
        );

        assert.deepEqual(
          (yield* step(
            client.getJobs({ ids: [orderChain.id, notificationChain.id, matchingChain.id] }),
          )).map((job) => job!.status),
          ["pending", "pending", "pending"],
        );
      }),
    },
    {
      name: "applyJobOutcome completes a running job, losing its attempt",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobStarted = Promise.withResolvers<void>();
        const jobCompleted = Promise.withResolvers<void>();
        const processCompleted = Promise.withResolvers<void>();

        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: { result: string } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                test: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    jobStarted.resolve();

                    await jobCompleted.promise;

                    try {
                      await assertRejects(
                        () =>
                          stateAdapter.withTransaction((txCtx) =>
                            applyJobOutcome({ ...txCtx, output: { result: "from-worker" } }),
                          ),
                        JobAlreadyCompletedError,
                      );

                      assert.equal(job.signal.aborted, true);

                      throw new Error();
                    } finally {
                      processCompleted.resolve();
                    }
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(jobStarted.promise);
        yield* wait(sleep(10));

        const completed = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "test" },
              output: { result: "from-external" },
            }),
          ),
        );
        assert.equal(completed.status, "completed");
        jobCompleted.resolve();

        yield* wait(processCompleted.promise);
        assert.partialDeepStrictEqual(yield* step(client.getChain({ id: chain.id })), {
          status: "completed",
          output: { result: "from-external" },
        });
      }),
    },
    {
      name: "applyJobOutcomes returns a mixed batch of output, continueWith and reschedule in input order",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          order: {
            entry: true;
            input: { orderId: string };
            output: { paid: boolean };
            continueWith: { typeName: "ship" };
          };
          ship: { input: { orderId: string }; output: { shipped: boolean } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [rescheduledChain, paidChain, shippedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "order", input: { orderId: "o-1" } },
                { typeName: "order", input: { orderId: "o-2" } },
                { typeName: "order", input: { orderId: "o-3" } },
              ],
            }),
          ),
        );

        const before = Date.now();
        const [rescheduled, paid, shipped] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcomes({
              ...txCtx,
              items: [
                {
                  job: { id: rescheduledChain.id },
                  reschedule: { afterMs: 60 * 60 * 1000 },
                  reason: "later",
                },
                { job: { id: paidChain.id, typeName: "order" }, output: { paid: true } },
                {
                  job: { id: shippedChain.id, typeName: "order" },
                  continueWith: { typeName: "ship", input: { orderId: "o-3" } },
                },
              ],
            }),
          ),
        );

        assert.partialDeepStrictEqual(rescheduled, {
          id: rescheduledChain.id,
          status: "pending",
          lastRescheduleReason: "later",
        });
        assert.ok(rescheduled.scheduledAt.getTime() >= before + 60 * 60 * 1000 - 1000);
        assert.partialDeepStrictEqual(paid, {
          id: paidChain.id,
          status: "completed",
          output: { paid: true },
        });
        assert.partialDeepStrictEqual(shipped, { id: shippedChain.id, status: "completed" });
        assert.partialDeepStrictEqual(shipped.continuedTo, {
          typeName: "ship",
          status: "pending",
          chainId: shippedChain.id,
          input: { orderId: "o-3" },
        });

        assert.deepEqual(
          (yield* step(
            client.getChains({ ids: [rescheduledChain.id, paidChain.id, shippedChain.id] }),
          )).map((chain) => chain!.status),
          ["running", "completed", "running"],
        );
      }),
    },
    {
      name: "applyJobOutcomes with empty items returns an empty array",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        assert.deepEqual(
          yield* step(
            stateAdapter.withTransaction((txCtx) =>
              client.applyJobOutcomes({ ...txCtx, items: [] }),
            ),
          ),
          [],
        );
      }),
    },
    {
      name: "applyJobOutcomes writes nothing and lists every completed job when any item is completed",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { value: number } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [firstCompleted, pendingChain, secondCompleted] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: { value: 1 } },
                { typeName: "test", input: { value: 2 } },
                { typeName: "test", input: { value: 3 } },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcomes({
              ...txCtx,
              items: [
                { job: { id: firstCompleted.id, typeName: "test" }, output: { value: 1 } },
                { job: { id: secondCompleted.id, typeName: "test" }, output: { value: 3 } },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  assertRejects(
                    () =>
                      client.applyJobOutcomes({
                        ...txCtx,
                        items: [
                          {
                            job: { id: firstCompleted.id, typeName: "test" },
                            output: { value: 10 },
                          },
                          { job: { id: pendingChain.id, typeName: "test" }, output: { value: 20 } },
                          { job: { id: secondCompleted.id }, reschedule: { afterMs: 0 } },
                        ],
                      }),
                    (error) => {
                      assert.ok(error instanceof JobsAlreadyCompletedError);
                      assert.deepEqual(error.jobIds, [firstCompleted.id, secondCompleted.id]);
                      return true;
                    },
                  ),
                );
              }),
            ),
          ),
        );

        assert.equal((yield* step(client.getJob({ id: pendingChain.id })))!.status, "pending");
        assert.deepEqual(
          (yield* step(client.getChains({ ids: [firstCompleted.id, secondCompleted.id] }))).map(
            (chain) => (chain!.status === "completed" ? chain!.output : undefined),
          ),
          [{ value: 1 }, { value: 3 }],
        );
      }),
    },
    {
      name: "applyJobOutcomes writes nothing and lists every missing job when any item is missing",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [pendingChain, firstDeleted, secondDeleted] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "test", input: { value: 1 } },
                { typeName: "test", input: { value: 2 } },
                { typeName: "test", input: { value: 3 } },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.deleteChains({ ...txCtx, ids: [firstDeleted.id, secondDeleted.id] }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  assertRejects(
                    () =>
                      client.applyJobOutcomes({
                        ...txCtx,
                        items: [
                          { job: { id: firstDeleted.id }, reschedule: { afterMs: 0 } },
                          { job: { id: pendingChain.id, typeName: "test" }, output: null },
                          { job: { id: secondDeleted.id, typeName: "test" }, output: null },
                        ],
                      }),
                    (error) => {
                      assert.ok(error instanceof JobsNotFoundError);
                      assert.deepEqual(error.jobIds, [firstDeleted.id, secondDeleted.id]);
                      return true;
                    },
                  ),
                );
              }),
            ),
          ),
        );

        assert.equal((yield* step(client.getJob({ id: pendingChain.id })))!.status, "pending");
      }),
    },
    {
      name: "applyJobOutcomes writes nothing when a continueWith item declares more blockers than the limit",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: null };
          review: {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "archive" };
          };
          archive: { input: null; output: null; blockers: [{ typeName: "blocker" }] };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [blockerChain, approvedChain, archivedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "blocker", input: null },
                { typeName: "review", input: null },
                { typeName: "review", input: null },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  assertRejects(
                    () =>
                      client.applyJobOutcomes({
                        ...txCtx,
                        items: [
                          {
                            job: { id: approvedChain.id, typeName: "review" },
                            output: { approved: true },
                          },
                          {
                            job: { id: archivedChain.id, typeName: "review" },
                            continueWith: {
                              typeName: "archive",
                              input: null,
                              blockers: Array.from(
                                { length: stateAdapter.config.maxBlockersPerJob + 1 },
                                () => blockerChain,
                              ) as [typeof blockerChain],
                            },
                          },
                        ],
                      }),
                    (error: unknown) => {
                      assert.ok(error instanceof JobsBlockerLimitExceededError);
                      assert.deepEqual(error.itemIndexes, [1]);
                      assert.deepEqual(
                        error.errors.map(({ typeName, count }) => [typeName, count]),
                        [["archive", stateAdapter.config.maxBlockersPerJob + 1]],
                      );
                      return true;
                    },
                  ),
                );
              }),
            ),
          ),
        );

        assert.deepEqual(
          (yield* step(client.getJobs({ ids: [approvedChain.id, archivedChain.id] }))).map(
            (job) => job!.status,
          ),
          ["pending", "pending"],
        );
        const archivedJobs = yield* step(
          client.listChainJobs({ chainId: archivedChain.id, limit: 10 }),
        );
        assert.equal(archivedJobs.items.length, 1);
      }),
    },
    {
      name: "applyJobOutcomes writes nothing when an output item fails validation after a continueWith item",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = createJobTypes<{
          review: {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "archive" };
          };
          archive: { input: null; output: null };
        }>({
          getTypeNames: () => ["review", "archive"],
          validateEntry: () => {},
          encodeInput: (_, input) => input,
          decodeInput: (_, input) => input,
          encodeOutput: (_, output) => {
            if ((output as { approved?: unknown }).approved !== true) {
              throw new Error("only approvals are accepted");
            }
            return output;
          },
          decodeOutput: (_, output) => output,
          validateContinueWith: () => {},
          validateBlockers: (typeName) => {
            if (typeName === "archive") throw new Error("archives are not taken yet");
          },
        });

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [continuedChain, rejectedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "review", input: null },
                { typeName: "review", input: null },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  assertRejects(
                    () =>
                      client.applyJobOutcomes({
                        ...txCtx,
                        items: [
                          {
                            job: { id: continuedChain.id, typeName: "review" },
                            continueWith: { typeName: "archive", input: null },
                          },
                          {
                            job: { id: rejectedChain.id, typeName: "review" },
                            output: { approved: false },
                          },
                        ],
                      }),
                    { name: "JobsTypeValidationError", itemIndexes: [1] },
                  ),
                );
                yield* step(
                  assertRejects(
                    () =>
                      client.applyJobOutcomes({
                        ...txCtx,
                        items: [
                          {
                            job: { id: rejectedChain.id, typeName: "review" },
                            output: { approved: true },
                          },
                          {
                            job: { id: continuedChain.id, typeName: "review" },
                            continueWith: { typeName: "archive", input: null },
                          },
                        ],
                      }),
                    (error: unknown) => {
                      assert.ok(error instanceof JobsTypeValidationError);
                      assert.deepEqual(error.itemIndexes, [1]);
                      assert.equal(error.errors[0].code, "invalid_blockers");
                      return true;
                    },
                  ),
                );
              }),
            ),
          ),
        );

        assert.deepEqual(
          (yield* step(client.getJobs({ ids: [continuedChain.id, rejectedChain.id] }))).map(
            (job) => job!.status,
          ),
          ["pending", "pending"],
        );
        const continuedJobs = yield* step(
          client.listChainJobs({ chainId: continuedChain.id, limit: 10 }),
        );
        assert.equal(continuedJobs.items.length, 1);
      }),
    },
    {
      name: "applyJobOutcomes throws when an item names the same job twice",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: null }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcomes({
                  ...txCtx,
                  items: [
                    { job: { id: chain.id }, reschedule: { afterMs: 0 } },
                    { job: { id: chain.id, typeName: "test" }, output: null },
                  ],
                }),
              ),
            /at most once/,
          ),
        );

        assert.equal((yield* step(client.getJob({ id: chain.id })))!.status, "pending");
      }),
    },
    {
      name: "applyJobOutcome and applyJobOutcomes throw when called without transaction context",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: { value: 42 } }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              // @ts-expect-error missing txCtx
              client.applyJobOutcome({
                job: { id: chain.id, typeName: "test" },
                output: { result: 84 },
              }),
            /requires a transaction context/,
          ),
        );
        yield* step(
          assertRejects(
            () =>
              // @ts-expect-error missing txCtx
              client.applyJobOutcomes({
                items: [{ job: { id: chain.id, typeName: "test" }, output: { result: 84 } }],
              }),
            /requires a transaction context/,
          ),
        );

        assert.equal((yield* step(client.getJob({ id: chain.id })))!.status, "pending");
      }),
    },
    {
      name: "applyJobOutcome and applyJobOutcomes throw when the context is not in a transaction",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "test", input: { value: 42 } }),
          ),
        );

        yield* step(
          context.withNonTransactionContext((txCtx) =>
            assertRejects(
              () =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: chain.id, typeName: "test" },
                  output: { result: 84 },
                }),
              /not in a transaction/,
            ),
          ),
        );
        yield* step(
          context.withNonTransactionContext((txCtx) =>
            assertRejects(
              () =>
                client.applyJobOutcomes({
                  ...txCtx,
                  items: [{ job: { id: chain.id, typeName: "test" }, output: { result: 84 } }],
                }),
              /not in a transaction/,
            ),
          ),
        );

        assert.equal((yield* step(client.getJob({ id: chain.id })))!.status, "pending");
      }),
    },
    {
      name: "reschedules a future-scheduled pending job to run now",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          report: { entry: true; input: { type: string }; output: { generatedAt: string } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "report",
              input: { type: "daily" },
              schedule: { afterMs: hourMs },
            }),
          ),
        );

        const beforeReschedule = yield* step(client.getJob({ id: chain.id }));
        assert.equal(beforeReschedule!.status, "pending");
        assert.ok(beforeReschedule!.scheduledAt.getTime() > Date.now() + 30_000);

        const before = Date.now();
        const rescheduled = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({ ...txCtx, job: { id: chain.id }, reschedule: { afterMs: 0 } }),
          ),
        );

        assert.equal(rescheduled.status, "pending");
        assert.ok(rescheduled.scheduledAt.getTime() >= before - 1000);
        assert.ok(rescheduled.scheduledAt.getTime() <= Date.now() + 1000);
        assert.equal(rescheduled.typeName, "report");
        assert.deepEqual(rescheduled.input, { type: "daily" });
      }),
    },
    {
      name: "stores a client reschedule reason truncated to 10,000 characters",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: null,
              schedule: { afterMs: hourMs },
            }),
          ),
        );

        const rescheduled = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id },
              reschedule: { afterMs: 0 },
              reason: "x".repeat(20_000),
            }),
          ),
        );

        assert.equal(rescheduled.lastRescheduleReason, `${"x".repeat(10_000)}… [truncated]`);
        assert.equal(rescheduled.lastAttemptError, null);
      }),
    },
    {
      name: "reschedules a pending job to a future absolute date",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        const futureDate = new Date(Date.now() + hourMs);
        const rescheduled = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "task" },
              reschedule: { at: futureDate },
            }),
          ),
        );

        assert.equal(rescheduled.status, "pending");
        assert.ok(Math.abs(rescheduled.scheduledAt.getTime() - futureDate.getTime()) < 1000);
      }),
    },
    {
      name: "reschedules a pending job into the future with afterMs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        const before = Date.now();
        const rescheduled = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id },
              reschedule: { afterMs: hourMs },
            }),
          ),
        );

        assert.equal(rescheduled.status, "pending");
        assert.ok(rescheduled.scheduledAt.getTime() >= before + hourMs - 1000);
      }),
    },
    {
      name: "a reschedule clamps a past schedule.at to now",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: null,
              schedule: { afterMs: hourMs },
            }),
          ),
        );

        const before = Date.now();
        const rescheduled = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id },
              reschedule: { at: new Date(before - hourMs) },
            }),
          ),
        );

        assert.ok(rescheduled.scheduledAt.getTime() >= before - 1000);
        assert.ok(rescheduled.scheduledAt.getTime() <= Date.now() + 1000);
      }),
    },
    {
      name: "a reschedule resets consecutiveFailures and keeps lastAttemptError of a pending job",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const attempted = Promise.withResolvers<void>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 20,
            backoffConfig: { initialDelayMs: hourMs, multiplier: 1, maxDelayMs: hourMs },
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async () => {
                    attempted.resolve();
                    throw new Error("attempt failed");
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(attempted.promise);
        yield* wait(workerRunner.close());

        const failed = yield* step(client.getJob({ id: chain.id }));
        assert.equal(failed!.status, "pending");
        assert.equal(failed!.consecutiveFailures, 1);
        assert.ok(failed!.lastAttemptError?.includes("attempt failed"));

        const rescheduled = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id },
              reschedule: { afterMs: 0 },
              reason: "retry now",
            }),
          ),
        );

        assert.equal(rescheduled.consecutiveFailures, 0);
        assert.equal(rescheduled.lastAttemptError, failed!.lastAttemptError);
        assert.equal(rescheduled.lastRescheduleReason, "retry now");
        assert.ok(rescheduled.scheduledAt.getTime() <= Date.now() + 1000);
      }),
    },
    {
      name: "rescheduled job is picked up by worker",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { value: number }; output: { result: number } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { result: job.input.value * 2 } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: { value: 21 },
              schedule: { afterMs: hourMs },
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({ ...txCtx, job: { id: chain.id }, reschedule: { afterMs: 0 } }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(
          client.awaitChain({ chain, timeoutMs: 5000, pollIntervalMs: 100 }),
        );

        assert.equal(completed.status, "completed");
        assert.deepEqual(completed.output, { result: 42 });
      }),
    },
    {
      name: "a reschedule moves scheduledAt of a blocked job, which stays blocked",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          blocker: { entry: true; input: null; output: null };
          blocked: {
            entry: true;
            input: null;
            output: null;
            blockers: [{ typeName: "blocker" }];
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [blockerChain, blockedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const blockerChain = yield* step(
                  client.createChain({ ...txCtx, typeName: "blocker", input: null }),
                );
                const blockedChain = yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "blocked",
                    input: null,
                    blockers: [blockerChain],
                  }),
                );
                return [blockerChain, blockedChain] as const;
              }),
            ),
          ),
        );

        const futureDate = new Date(Date.now() + hourMs);
        const rescheduled = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: blockedChain.id, typeName: "blocked" },
              reschedule: { at: futureDate },
              reason: "after the blocker",
            }),
          ),
        );

        assert.equal(rescheduled.status, "blocked");
        assert.equal(rescheduled.lastRescheduleReason, "after the blocker");
        assert.ok(Math.abs(rescheduled.scheduledAt.getTime() - futureDate.getTime()) < 1000);

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: blockerChain.id, typeName: "blocker" },
              output: null,
            }),
          ),
        );

        const unblocked = yield* step(client.getJob({ id: blockedChain.id }));
        assert.equal(unblocked!.status, "pending");
        assert.ok(Math.abs(unblocked!.scheduledAt.getTime() - futureDate.getTime()) < 1000);
      }),
    },
    {
      name: "applyJobOutcomes reschedules multiple pending jobs in input order",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { value: number }; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "task", input: { value: 1 }, schedule: { afterMs: hourMs } },
                { typeName: "task", input: { value: 2 }, schedule: { afterMs: hourMs } },
                { typeName: "task", input: { value: 3 }, schedule: { afterMs: hourMs } },
              ],
            }),
          ),
        );

        const before = Date.now();
        const futureDate = new Date(before + 2 * hourMs);
        const rescheduled = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcomes({
              ...txCtx,
              items: [
                { job: { id: chains[2].id }, reschedule: { afterMs: 0 } },
                { job: { id: chains[0].id }, reschedule: { at: futureDate } },
                { job: { id: chains[1].id }, reschedule: { afterMs: 0 } },
              ],
            }),
          ),
        );

        assert.deepEqual(
          rescheduled.map((job) => job.id),
          [chains[2].id, chains[0].id, chains[1].id],
        );
        assert.deepEqual(
          rescheduled.map((job) => job.status),
          ["pending", "pending", "pending"],
        );
        assert.ok(rescheduled[0].scheduledAt.getTime() <= Date.now() + 1000);
        assert.ok(Math.abs(rescheduled[1].scheduledAt.getTime() - futureDate.getTime()) < 1000);
        assert.ok(rescheduled[2].scheduledAt.getTime() <= Date.now() + 1000);
      }),
    },
    {
      name: "a reschedule of a running job returns it to pending, losing its attempt",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const attemptStarted = Promise.withResolvers<void>();
        const attemptGate = Promise.withResolvers<void>();
        const applyJobOutcomeFailed = Promise.withResolvers<unknown>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    attemptStarted.resolve();
                    await attemptGate.promise;
                    try {
                      await stateAdapter.withTransaction((txCtx) =>
                        applyJobOutcome({ ...txCtx, output: null }),
                      );
                      return;
                    } catch (error) {
                      applyJobOutcomeFailed.resolve(error);
                      throw error;
                    }
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(attemptStarted.promise);

        const rescheduled = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, status: "running" },
              reschedule: { afterMs: hourMs },
              reason: "paused by an operator",
            }),
          ),
        );
        assert.equal(rescheduled.status, "pending");
        assert.equal(rescheduled.lastRescheduleReason, "paused by an operator");
        assert.ok(rescheduled.scheduledAt.getTime() > Date.now() + 30 * 60 * 1000);

        attemptGate.resolve();
        assert.ok(
          (yield* wait(applyJobOutcomeFailed.promise)) instanceof JobTakenByAnotherWorkerError,
        );

        const job = yield* step(client.getJob({ id: chain.id }));
        assert.equal(job!.status, "pending");
        assert.ok(job!.scheduledAt.getTime() > Date.now() + 30 * 60 * 1000);
      }),
    },
    {
      name: "applyJobOutcomes wakes polling chains read with a locked getChainTailJobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          poll: { entry: true; input: { index: number }; output: { attempts: number } };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
        const chainCount = 3;
        let polled = 0;
        const allPolled = Promise.withResolvers<void>();
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: chainCount,
            pollIntervalMs: 50,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                poll: {
                  attemptHandler: async ({ job, applyJobOutcome }) => {
                    if (job.attempt > 1) {
                      await stateAdapter.withTransaction((txCtx) =>
                        applyJobOutcome({ ...txCtx, output: { attempts: job.attempt } }),
                      );
                      return;
                    }
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({
                        ...txCtx,
                        reschedule: { afterMs: 60_000 },
                        reason: "polling",
                      }),
                    );
                    polled++;
                    if (polled === chainCount) allPolled.resolve();
                  },
                },
              },
            }),
          }),
        );

        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: Array.from({ length: chainCount }, (_, index) => ({
                typeName: "poll" as const,
                input: { index },
              })),
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(allPolled.promise);

        const chainIds = chains.map((chain) => chain.id);
        const woken = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const tails = yield* step(
                  client.getChainTailJobs({ ...txCtx, chainIds, lock: "exclusive" }),
                );
                return yield* step(
                  client.applyJobOutcomes({
                    ...txCtx,
                    items: tails.flatMap((job) =>
                      job && (job.status === "pending" || job.status === "blocked")
                        ? [{ job, reschedule: { afterMs: 0 } }]
                        : [],
                    ),
                  }),
                );
              }),
            ),
          ),
        );

        assert.deepEqual(
          woken.map((job) => job.id),
          chainIds,
        );

        for (const chain of chains) {
          const completed = yield* wait(
            client.awaitChain({ chain, timeoutMs: 3000, pollIntervalMs: 50 }),
          );
          assert.deepEqual(completed.output, { attempts: 2 });
        }
      }),
    },
    {
      name: "applyJobOutcome after a locked read does not wake workers for the job it completed",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = createSpyNotifyAdapter(
          yield* resource(createCaseNotifyAdapter(createNotifyAdapter, stateAdapter)),
        );
        const jobTypes = defineJobTypes<{
          "await-approval": {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "process-request" };
          };
          "process-request": { input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "await-approval", input: null }),
          ),
        );
        notifyAdapter.calls.length = 0;

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const job = yield* step(
                  client.getChainTailJob({
                    ...txCtx,
                    chainId: chain.id,
                    chainTypeName: "await-approval",
                    lock: "exclusive",
                  }),
                );
                if (job?.typeName !== "await-approval") throw new Error("unexpected tail");
                yield* step(client.applyJobOutcome({ ...txCtx, job, output: { approved: false } }));
              }),
            ),
          ),
        );

        assert.deepEqual(
          [
            ...new Set(
              notifyAdapter.calls.flatMap(({ name, args }) =>
                name === "notifyJobsScheduled" ? args : [],
              ),
            ),
          ],
          [],
        );
      }),
    },
    {
      name: "applyJobOutcome after a locked read wakes workers only for the continuation it created",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = createSpyNotifyAdapter(
          yield* resource(createCaseNotifyAdapter(createNotifyAdapter, stateAdapter)),
        );
        const jobTypes = defineJobTypes<{
          "await-approval": {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "process-request" };
          };
          "process-request": { input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "await-approval", input: null }),
          ),
        );
        notifyAdapter.calls.length = 0;

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const job = yield* step(
                  client.getChainTailJob({
                    ...txCtx,
                    chainId: chain.id,
                    chainTypeName: "await-approval",
                    lock: "exclusive",
                  }),
                );
                if (job?.typeName !== "await-approval") throw new Error("unexpected tail");
                yield* step(
                  client.applyJobOutcome({
                    ...txCtx,
                    job,
                    continueWith: { typeName: "process-request", input: null },
                  }),
                );
              }),
            ),
          ),
        );

        assert.deepEqual(
          [
            ...new Set(
              notifyAdapter.calls.flatMap(({ name, args }) =>
                name === "notifyJobsScheduled" ? args : [],
              ),
            ),
          ],
          ["process-request"],
        );
      }),
    },
    {
      name: "applyJobOutcome after a locked read wakes workers for a job it rescheduled",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = createSpyNotifyAdapter(
          yield* resource(createCaseNotifyAdapter(createNotifyAdapter, stateAdapter)),
        );
        const jobTypes = defineJobTypes<{
          "await-approval": {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "process-request" };
          };
          "process-request": { input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "await-approval", input: null }),
          ),
        );
        notifyAdapter.calls.length = 0;

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const [job] = yield* step(
                  client.getJobs({ ...txCtx, ids: [chain.id], lock: "exclusive" }),
                );
                yield* step(
                  client.applyJobOutcome({ ...txCtx, job: job!, reschedule: { afterMs: hourMs } }),
                );
              }),
            ),
          ),
        );

        assert.deepEqual(
          [
            ...new Set(
              notifyAdapter.calls.flatMap(({ name, args }) =>
                name === "notifyJobsScheduled" ? args : [],
              ),
            ),
          ],
          ["await-approval"],
        );
      }),
    },
    {
      name: "applyJobOutcomes after a locked read wakes workers for the jobs it left pending",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = createSpyNotifyAdapter(
          yield* resource(createCaseNotifyAdapter(createNotifyAdapter, stateAdapter)),
        );
        const jobTypes = defineJobTypes<{
          "await-approval": {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "process-request" };
          };
          "process-request": { input: null; output: null };
          "send-reminder": { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [approvalChain, reminderChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "await-approval", input: null },
                { typeName: "send-reminder", input: null },
              ],
            }),
          ),
        );
        notifyAdapter.calls.length = 0;

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  client.getChainTailJobs({
                    ...txCtx,
                    chainIds: [approvalChain.id, reminderChain.id],
                    lock: "exclusive",
                  }),
                );
                yield* step(
                  client.applyJobOutcomes({
                    ...txCtx,
                    items: [
                      {
                        job: { id: approvalChain.id, typeName: "await-approval" },
                        output: { approved: true },
                      },
                    ],
                  }),
                );
              }),
            ),
          ),
        );

        assert.deepEqual(
          [
            ...new Set(
              notifyAdapter.calls.flatMap(({ name, args }) =>
                name === "notifyJobsScheduled" ? args : [],
              ),
            ),
          ],
          ["send-reminder"],
        );
      }),
    },
    {
      name: "a transaction that catches a failed applyJobOutcomes and commits wakes workers for the jobs it locked",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = createSpyNotifyAdapter(
          yield* resource(createCaseNotifyAdapter(createNotifyAdapter, stateAdapter)),
        );
        const jobTypes = defineJobTypes<{
          "await-approval": {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "process-request" };
          };
          "process-request": { input: null; output: null };
          "send-reminder": { entry: true; input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [approvalChain, reminderChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "await-approval", input: null },
                { typeName: "send-reminder", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: reminderChain.id, typeName: "send-reminder" },
              output: null,
            }),
          ),
        );
        notifyAdapter.calls.length = 0;

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                yield* step(
                  assertRejects(
                    () =>
                      client.applyJobOutcomes({
                        ...txCtx,
                        items: [
                          {
                            job: { id: approvalChain.id, typeName: "await-approval" },
                            output: { approved: true },
                          },
                          { job: { id: reminderChain.id }, reschedule: { afterMs: 0 } },
                        ],
                      }),
                    JobsAlreadyCompletedError,
                  ),
                );
              }),
            ),
          ),
        );

        assert.deepEqual(
          [
            ...new Set(
              notifyAdapter.calls.flatMap(({ name, args }) =>
                name === "notifyJobsScheduled" ? args : [],
              ),
            ),
          ],
          ["await-approval"],
        );
      }),
    },
  ],
};

export const applyJobOutcomesConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "apply-job-outcomes",
    cases: [
      {
        name: "workers skip a job locked by a getChainTailJob lock until applyJobOutcome commits",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = defineJobTypes<{
            first: { entry: true; input: null; continueWith: { typeName: "second" } };
            second: { input: null; output: null };
          }>();

          const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

          const chain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "first", input: null }),
          );
          await stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "first" },
              continueWith: { typeName: "second", input: null },
            }),
          );

          const secondAttempted = new AbortController();
          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                second: {
                  attemptHandler: async () => {
                    secondAttempted.abort();
                    throw new Error("acquired the job locked by getChainTailJob");
                  },
                },
              },
            }),
          });

          const lockHeld = Promise.withResolvers<void>();
          const lockGate = Promise.withResolvers<void>();
          const completion = stateAdapter.withTransaction(async (txCtx) => {
            const job = await client.getChainTailJob({
              ...txCtx,
              chainId: chain.id,
              chainTypeName: "first",
              lock: "exclusive",
            });
            lockHeld.resolve();
            await lockGate.promise;
            if (job?.typeName !== "second" || job.status === "completed") {
              throw new Error(`unexpected tail ${job?.typeName} ${job?.status}`);
            }
            return client.applyJobOutcome({ ...txCtx, job, output: null });
          });

          try {
            await lockHeld.promise;
            await workerRunner.start();
            await sleep(100);
            await workerRunner.close();
            assert.equal(secondAttempted.signal.aborted, false);
          } finally {
            lockGate.resolve();
            await completion;
          }

          const completed = await client.getChain({ id: chain.id });
          assert.equal(completed!.status, "completed");
        },
      },
    ],
  };

export const applyJobOutcomesNotifyConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "apply-job-outcomes",
    cases: [
      {
        name: "starts a pending job once an applyJobOutcomes call that failed on another job rolls back",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = defineJobTypes<{
            task: { entry: true; input: null; output: null };
          }>();

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const completedChain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );
          await stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({ ...txCtx, job: { id: completedChain.id }, output: null }),
          );
          const pendingChain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );

          const failed = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const rolledBack = assertRejects(
            async () =>
              stateAdapter.withTransaction(async (txCtx) => {
                await assertRejects(
                  async () =>
                    client.applyJobOutcomes({
                      ...txCtx,
                      items: [
                        { job: { id: pendingChain.id }, reschedule: { afterMs: 0 } },
                        { job: { id: completedChain.id }, reschedule: { afterMs: 0 } },
                      ],
                    }),
                  JobsAlreadyCompletedError,
                );
                failed.resolve();
                await release.promise;
                throw new Error("rollback");
              }),
            Error,
          );

          await failed.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await rolledBack;

          await client.awaitChain({ chain: pendingChain, ...completionOptions });
        },
      },
      {
        name: "starts a pending job once a transaction that caught an applyJobOutcomes call failing on another job commits",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = defineJobTypes<{
            task: { entry: true; input: null; output: null };
          }>();

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const completedChain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );
          await stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({ ...txCtx, job: { id: completedChain.id }, output: null }),
          );
          const pendingChain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );

          const failed = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = stateAdapter.withTransaction(async (txCtx) => {
            await assertRejects(
              async () =>
                client.applyJobOutcomes({
                  ...txCtx,
                  items: [
                    { job: { id: pendingChain.id }, reschedule: { afterMs: 0 } },
                    { job: { id: completedChain.id }, reschedule: { afterMs: 0 } },
                  ],
                }),
              JobsAlreadyCompletedError,
            );
            failed.resolve();
            await release.promise;
          });

          await failed.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain: pendingChain, ...completionOptions });
        },
      },
      {
        name: "starts a pending job once the transaction rescheduling it rolls back",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = defineJobTypes<{
            task: { entry: true; input: null; output: null };
          }>();

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const chain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );

          const rescheduled = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = assertRejects(
            async () =>
              stateAdapter.withTransaction(async (txCtx) => {
                await client.applyJobOutcome({
                  ...txCtx,
                  job: { id: chain.id },
                  reschedule: { afterMs: 0 },
                });
                rescheduled.resolve();
                await release.promise;
                throw new Error("rollback");
              }),
            Error,
          );

          await rescheduled.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain, ...completionOptions });
        },
      },
      {
        name: "starts the tail job once a transaction that read it with a locked getChainTailJob commits",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = defineJobTypes<{
            task: { entry: true; input: null; output: null };
          }>();

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const chain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );

          const locked = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = stateAdapter.withTransaction(async (txCtx) => {
            await client.getChainTailJob({ ...txCtx, chainId: chain.id, lock: "exclusive" });
            locked.resolve();
            await release.promise;
          });

          await locked.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain, ...completionOptions });
        },
      },
      {
        name: "starts the tail job once a transaction that read it with a locked getChainTailJob rolls back",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = defineJobTypes<{
            task: { entry: true; input: null; output: null };
          }>();

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const chain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );

          const locked = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = assertRejects(
            async () =>
              stateAdapter.withTransaction(async (txCtx) => {
                await client.getChainTailJob({ ...txCtx, chainId: chain.id, lock: "exclusive" });
                locked.resolve();
                await release.promise;
                throw new Error("rollback");
              }),
            Error,
          );

          await locked.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain, ...completionOptions });
        },
      },
      {
        name: "starts a pending job once a transaction that caught an applyJobOutcome failing to encode its output commits",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = createJobTypes<{
            review: { entry: true; input: null; output: { approved: boolean } };
          }>({
            getTypeNames: () => ["review"],
            validateEntry: () => {},
            encodeInput: (_, input) => input,
            decodeInput: (_, input) => input,
            encodeOutput: (_, output) => {
              if ((output as { approved?: unknown }).approved !== true) {
                throw new Error("only approvals are accepted");
              }
              return output;
            },
            decodeOutput: (_, output) => output,
            validateContinueWith: () => {},
            validateBlockers: () => {},
          });

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                review: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: { approved: true } }),
                    );
                  },
                },
              },
            }),
          });

          const chain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "review", input: null }),
          );

          const failed = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = stateAdapter.withTransaction(async (txCtx) => {
            await assertRejects(
              async () =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: chain.id, typeName: "review" },
                  output: { approved: false },
                }),
              JobTypeValidationError,
            );
            failed.resolve();
            await release.promise;
          });

          await failed.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain, ...completionOptions });
        },
      },
      {
        name: "starts the head job once a transaction that caught a locked getChain failing on its chain type commits",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = defineJobTypes<{
            task: { entry: true; input: null; output: null };
            other: { entry: true; input: null; output: null };
          }>();

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const chain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );

          const failed = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = stateAdapter.withTransaction(async (txCtx) => {
            await assertRejects(
              async () =>
                client.getChain({ ...txCtx, id: chain.id, typeName: "other", lock: "exclusive" }),
              ChainTypeMismatchError,
            );
            failed.resolve();
            await release.promise;
          });

          await failed.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain, ...completionOptions });
        },
      },
      {
        name: "starts the head job once a transaction that caught a locked getChainTailJob failing on its chain type commits",
        run: async ({ createStateAdapter, createNotifyAdapter }) => {
          await using stateAdapter = await createCaseStateAdapter(createStateAdapter);
          await using notifyAdapter = await createCaseNotifyAdapter(
            createNotifyAdapter,
            stateAdapter,
          );
          const jobTypes = defineJobTypes<{
            task: { entry: true; input: null; output: null };
            other: { entry: true; input: null; output: null };
          }>();

          const workerIdle = Promise.withResolvers<void>();
          const client = createClient({
            stateAdapter: {
              ...stateAdapter,
              getStartAttemptDelayMs: async (params) => {
                const delayMs = await stateAdapter.getStartAttemptDelayMs(params);
                workerIdle.resolve();
                return delayMs;
              },
            },
            notifyAdapter,
            jobTypes,
          });

          await using workerRunner = createWorkerRunner({
            client,
            concurrency: 1,
            pollIntervalMs: 60_000,
            processors: createProcessors({
              client,
              jobTypes,
              processors: {
                task: {
                  attemptHandler: async ({ applyJobOutcome }) => {
                    await stateAdapter.withTransaction((txCtx) =>
                      applyJobOutcome({ ...txCtx, output: null }),
                    );
                  },
                },
              },
            }),
          });

          const chain = await stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          );

          const failed = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const transaction = stateAdapter.withTransaction(async (txCtx) => {
            await assertRejects(
              async () =>
                client.getChainTailJob({
                  ...txCtx,
                  chainId: chain.id,
                  chainTypeName: "other",
                  lock: "exclusive",
                }),
              ChainTypeMismatchError,
            );
            failed.resolve();
            await release.promise;
          });

          await failed.promise;
          await workerRunner.start();
          await workerIdle.promise;
          release.resolve();
          await transaction;

          await client.awaitChain({ chain, ...completionOptions });
        },
      },
    ],
  };

export const applyJobOutcomesSavepointGroup: ConformanceGroup<EndToEndSavepointContext> = {
  name: "apply-job-outcomes",
  cases: [
    {
      name: "applyJobOutcome rolled back to a savepoint after a locked read wakes workers for the job on commit",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = createSpyNotifyAdapter(
          yield* resource(createCaseNotifyAdapter(createNotifyAdapter, stateAdapter)),
        );
        const jobTypes = defineJobTypes<{
          "await-approval": {
            entry: true;
            input: null;
            output: { approved: boolean };
            continueWith: { typeName: "process-request" };
          };
          "process-request": { input: null; output: null };
        }>();
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "await-approval", input: null }),
          ),
        );
        notifyAdapter.calls.length = 0;

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const job = yield* step(
                  client.getChainTailJob({
                    ...txCtx,
                    chainId: chain.id,
                    chainTypeName: "await-approval",
                    lock: "exclusive",
                  }),
                );
                if (job?.typeName !== "await-approval") throw new Error("unexpected tail");
                try {
                  yield* step(
                    context.withSavepoint(txCtx, (txCtx) =>
                      runInModeOf(
                        stateAdapter,
                        syncAsync(function* () {
                          yield* step(
                            client.applyJobOutcome({ ...txCtx, job, output: { approved: true } }),
                          );
                          throw new Error("rollback to savepoint");
                        }),
                      ),
                    ),
                  );
                } catch {}
              }),
            ),
          ),
        );
        assert.equal((yield* step(client.getJob({ id: chain.id })))!.status, "pending");

        assert.deepEqual(
          [
            ...new Set(
              notifyAdapter.calls.flatMap(({ name, args }) =>
                name === "notifyJobsScheduled" ? args : [],
              ),
            ),
          ],
          ["await-approval"],
        );
      }),
    },
  ],
};
