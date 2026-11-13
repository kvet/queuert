import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import {
  JobNotFoundError,
  JobNotReschedulableError,
  JobsNotFoundError,
  JobsNotReschedulableError,
} from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

export const rescheduleJobGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "reschedule-job",
  cases: [
    {
      name: "reschedules a future-scheduled pending job to run now",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          report: {
            entry: true;
            input: { type: string };
            output: { generatedAt: string };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "report",
              input: { type: "daily" },
              schedule: { afterMs: 60 * 60 * 1000 },
            }),
          ),
        );

        const beforeReschedule = yield* step(client.getJob({ id: chain.id }));
        assert.equal(beforeReschedule!.status, "pending");
        assert.ok(beforeReschedule!.scheduledAt.getTime() > Date.now() + 30_000);

        const before = Date.now();
        const rescheduled = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.rescheduleJob({ ...txCtx, id: chain.id }),
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
      name: "reschedules a pending job to a future absolute date",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        const futureDate = new Date(Date.now() + 60 * 60 * 1000);
        const rescheduled = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.rescheduleJob({
              ...txCtx,
              id: chain.id,
              schedule: { at: futureDate },
            }),
          ),
        );

        assert.equal(rescheduled.status, "pending");
        assert.ok(Math.abs(rescheduled.scheduledAt.getTime() - futureDate.getTime()) < 1000);
      }),
    },
    {
      name: "reschedules a pending job into the future with afterMs",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        const before = Date.now();
        const rescheduled = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.rescheduleJob({
              ...txCtx,
              id: chain.id,
              schedule: { afterMs: 60 * 60 * 1000 },
            }),
          ),
        );

        assert.equal(rescheduled.status, "pending");
        assert.ok(rescheduled.scheduledAt.getTime() >= before + 60 * 60 * 1000 - 1000);
      }),
    },
    {
      name: "rescheduled job is picked up by worker",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: {
            entry: true;
            input: { value: number };
            output: { result: number };
          };
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
                  attemptHandler: async ({ job, complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: { value: 21 },
              schedule: { afterMs: 60 * 60 * 1000 },
            }),
          ),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.rescheduleJob({ ...txCtx, id: chain.id }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(
          client.awaitChain(chain, {
            timeoutMs: 5000,
            pollIntervalMs: 100,
          }),
        );

        assert.equal(completed.status, "completed");
        assert.deepEqual(completed.output, { result: 42 });
      }),
    },
    {
      name: "throws JobNotFoundError for nonexistent job",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.deleteChains({ ...txCtx, ids: [chain.id] }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.rescheduleJob({ ...txCtx, id: chain.id }),
              ),
            JobNotFoundError,
          ),
        );
      }),
    },
    {
      name: "throws JobNotReschedulableError for completed job",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: { done: true } };
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
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { done: true as const } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({ ...txCtx, typeName: "task", input: null }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(chain, { timeoutMs: 5000, pollIntervalMs: 100 }));

        yield* step(
          assertRejects(
            () =>
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.rescheduleJob({ ...txCtx, id: chain.id }),
              ),
            JobNotReschedulableError,
          ),
        );
      }),
    },
    {
      name: "throws when called without transaction context",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          report: {
            entry: true;
            input: { type: string };
            output: { generatedAt: string };
          };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "report",
              input: { type: "daily" },
              schedule: { afterMs: 60_000 },
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              // @ts-expect-error missing txCtx
              client.rescheduleJob({ id: chain.id }),
            /requires a transaction context/,
          ),
        );
      }),
    },
    {
      name: "rescheduleJob throws when the context is not in a transaction",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: null,
              schedule: { afterMs: 60_000 },
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              context.withNonTransactionContext((txCtx) =>
                client.rescheduleJob({
                  ...txCtx,
                  id: chain.id,
                  schedule: { afterMs: 0 },
                }),
              ),
            /not in a transaction/,
          ),
        );

        const job = yield* step(client.getJob({ id: chain.id }));
        assert.ok(job!.scheduledAt.getTime() > Date.now() + 30_000);
      }),
    },
    {
      name: "throws JobNotReschedulableError for blocked job",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
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

        const blockedChain = yield* step(
          withCaseTransaction(stateAdapter, function* (txCtx) {
            const blockerChain = yield* step(
              client.createChain({
                ...txCtx,
                typeName: "blocker",
                input: null,
              }),
            );
            return yield* step(
              client.createChain({
                ...txCtx,
                typeName: "blocked",
                input: null,
                blockers: [blockerChain],
              }),
            );
          }),
        );

        yield* step(
          assertRejects(
            () =>
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.rescheduleJob({ ...txCtx, id: blockedChain.id }),
              ),
            JobNotReschedulableError,
          ),
        );
      }),
    },
    {
      name: "rescheduleJobs returns the job at every position of a repeated id",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: null,
              schedule: { afterMs: 60 * 60 * 1000 },
            }),
          ),
        );

        const rescheduled = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.rescheduleJobs({ ...txCtx, ids: [chain.id, chain.id] }),
          ),
        );

        assert.deepEqual(
          rescheduled.map((job) => job.id),
          [chain.id, chain.id],
        );
        assert.deepEqual(
          rescheduled.map((job) => job.status),
          ["pending", "pending"],
        );
      }),
    },
    {
      name: "rescheduleJobs reschedules multiple pending jobs in input order",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { value: number }; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "task", input: { value: 1 }, schedule: { afterMs: 60 * 60 * 1000 } },
                { typeName: "task", input: { value: 2 }, schedule: { afterMs: 60 * 60 * 1000 } },
                { typeName: "task", input: { value: 3 }, schedule: { afterMs: 60 * 60 * 1000 } },
              ],
            }),
          ),
        );

        const before = Date.now();
        const ids = chains.map((c) => c.id);
        const rescheduled = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) => client.rescheduleJobs({ ...txCtx, ids })),
        );

        assert.equal(rescheduled.length, 3);
        for (let i = 0; i < rescheduled.length; i++) {
          assert.equal(rescheduled[i].id, ids[i]);
          assert.equal(rescheduled[i].status, "pending");
          assert.ok(rescheduled[i].scheduledAt.getTime() >= before - 1000);
          assert.ok(rescheduled[i].scheduledAt.getTime() <= Date.now() + 1000);
        }
      }),
    },
    {
      name: "rescheduleJobs applies a future schedule to all jobs",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { value: number }; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "task", input: { value: 1 } },
                { typeName: "task", input: { value: 2 } },
              ],
            }),
          ),
        );

        const ids = chains.map((c) => c.id);
        const futureDate = new Date(Date.now() + 60 * 60 * 1000);
        const rescheduled = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.rescheduleJobs({ ...txCtx, ids, schedule: { at: futureDate } }),
          ),
        );

        assert.equal(rescheduled.length, 2);
        for (const job of rescheduled) {
          assert.ok(Math.abs(job.scheduledAt.getTime() - futureDate.getTime()) < 1000);
        }
      }),
    },
    {
      name: "rescheduleJobs with empty ids returns empty array",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const rescheduled = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.rescheduleJobs({ ...txCtx, ids: [] }),
          ),
        );

        assert.deepEqual(rescheduled, []);
      }),
    },
    {
      name: "rescheduleJobs fails atomically when any job is missing",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { value: number }; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const [chainA, chainB] = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "task", input: { value: 1 }, schedule: { afterMs: 60 * 60 * 1000 } },
                { typeName: "task", input: { value: 2 }, schedule: { afterMs: 60 * 60 * 1000 } },
              ],
            }),
          ),
        );

        yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.deleteChains({ ...txCtx, ids: [chainB.id] }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.rescheduleJobs({
                  ...txCtx,
                  ids: [chainA.id, chainB.id],
                }),
              ),
            JobsNotFoundError,
          ),
        );

        const chainAJob = yield* step(client.getJob({ id: chainA.id }));
        assert.ok(chainAJob!.scheduledAt.getTime() > Date.now() + 30_000);
      }),
    },
    {
      name: "rescheduleJobs fails atomically when any job is not pending",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: { value: number }; output: { done: true } };
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
                  attemptHandler: async ({ complete }) =>
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { done: true as const } }),
                    ),
                },
              },
            }),
          }),
        );

        const completedChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: { value: 1 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        yield* wait(client.awaitChain(completedChain, { timeoutMs: 5000, pollIntervalMs: 100 }));
        yield* wait(workerRunner.close());

        const pendingChain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: { value: 2 },
              schedule: { afterMs: 60 * 60 * 1000 },
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              withCaseTransaction(stateAdapter, (txCtx) =>
                client.rescheduleJobs({
                  ...txCtx,
                  ids: [pendingChain.id, completedChain.id],
                }),
              ),
            JobsNotReschedulableError,
          ),
        );

        const pendingJob = yield* step(client.getJob({ id: pendingChain.id }));
        assert.ok(pendingJob!.scheduledAt.getTime() > Date.now() + 30_000);
      }),
    },
    {
      name: "rescheduleJobs throws when called without transaction context",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: null,
              schedule: { afterMs: 60_000 },
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              // @ts-expect-error missing txCtx
              client.rescheduleJobs({ ids: [chain.id] }),
            /requires a transaction context/,
          ),
        );
      }),
    },
    {
      name: "rescheduleJobs throws when the context is not in a transaction",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter, ...context }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          task: { entry: true; input: null; output: null };
        }>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        const chain = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "task",
              input: null,
              schedule: { afterMs: 60_000 },
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              context.withNonTransactionContext((txCtx) =>
                client.rescheduleJobs({
                  ...txCtx,
                  ids: [chain.id],
                  schedule: { afterMs: 0 },
                }),
              ),
            /not in a transaction/,
          ),
        );

        const job = yield* step(client.getJob({ id: chain.id }));
        assert.ok(job!.scheduledAt.getTime() > Date.now() + 30_000);
      }),
    },
  ],
};
