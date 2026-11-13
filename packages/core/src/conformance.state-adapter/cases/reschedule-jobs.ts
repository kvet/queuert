import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const rescheduleJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "rescheduleJobs",
  cases: [
    {
      name: "sets scheduledAt to now on a pending job",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-test",
                  input: null,
                  schedule: { at: futureDate },
                },
              ],
            }),
          ),
        );

        assert.ok(Math.abs(createdChain.head.scheduledAt.getTime() - futureDate.getTime()) < 1000);

        const before = Date.now();
        const triggered = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id }],
          }),
        );

        assert.equal(triggered.length, 1);
        assert.equal(triggered[0]!.completedAt, null);
        assert.equal(triggered[0]!.attemptAt, null);
        assert.ok(triggered[0]!.scheduledAt.getTime() >= before - 1000);
        assert.ok(triggered[0]!.scheduledAt.getTime() <= Date.now() + 1000);
      }),
    },
    {
      name: "makes a future-scheduled job acquirable",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["trigger-acquire"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-acquire",
                  input: null,
                  schedule: { at: futureDate },
                },
              ],
            }),
          ),
        );

        const [beforeTrigger] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["trigger-acquire"],
            limit: 1,
          }),
        );
        assert.equal(beforeTrigger, undefined);

        yield* step(stateAdapter.rescheduleJobs({ jobs: [{ jobId: createdChain.head.id }] }));

        const [afterTrigger] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["trigger-acquire"],
            limit: 1,
          }),
        );
        assert.notEqual(afterTrigger, undefined);
        assert.equal(afterTrigger.id, createdChain.head.id);
      }),
    },
    {
      name: "preserves other job fields",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-fields",
                  input: { key: "value" },
                  schedule: { at: futureDate },
                },
              ],
            }),
          ),
        );

        const triggered = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id }],
          }),
        );

        assert.equal(triggered[0]!.id, createdChain.head.id);
        assert.equal(triggered[0]!.typeName, "trigger-fields");
        assert.deepEqual(triggered[0]!.input, { key: "value" });
        assert.equal(triggered[0]!.chainId, createdChain.head.chainId);
        assert.equal(triggered[0]!.attempt, createdChain.head.attempt);
      }),
    },
    {
      name: "triggers multiple jobs in input order",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const futureDate = new Date(Date.now() + 60_000);
        const created = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-batch",
                  input: { i: 1 },
                  schedule: { at: futureDate },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-batch",
                  input: { i: 2 },
                  schedule: { at: futureDate },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-batch",
                  input: { i: 3 },
                  schedule: { at: futureDate },
                },
              ],
            }),
          ),
        );
        const ids = created.map((c) => c.head.id);

        const triggered = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: ids.map((jobId) => ({ jobId })),
          }),
        );

        assert.deepEqual(
          triggered.map((j) => j!.id),
          ids,
        );

        // Preserves input order when input order differs from insertion order.
        const reversed = [...ids].reverse();
        const reversedTriggered = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: reversed.map((jobId) => ({ jobId })),
          }),
        );
        assert.deepEqual(
          reversedTriggered.map((j) => j!.id),
          reversed,
        );
      }),
    },
    {
      name: "returns the rescheduled job at every position of a repeated id",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-duplicate",
                  input: null,
                  schedule: { at: futureDate },
                },
              ],
            }),
          ),
        );

        const triggered = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id }, { jobId: createdChain.head.id }],
          }),
        );

        assert.equal(triggered.length, 2);
        assert.equal(triggered[0]!.id, createdChain.head.id);
        assert.equal(triggered[1]!.id, createdChain.head.id);
        assert.equal(triggered[0]!.status, "pending");
        assert.equal(triggered[1]!.status, "pending");
        assert.ok(triggered[0]!.scheduledAt.getTime() < futureDate.getTime());
        assert.equal(triggered[1]!.scheduledAt.getTime(), triggered[0]!.scheduledAt.getTime());
      }),
    },
    {
      name: "returns empty array for empty jobIds",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const triggered = yield* step(stateAdapter.rescheduleJobs({ jobs: [] }));
        assert.deepEqual(triggered, []);
      }),
    },
    {
      name: "skips missing ids",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-missing",
                  input: null,
                  schedule: { at: futureDate },
                },
              ],
            }),
          ),
        );

        const missingId = crypto.randomUUID();
        const triggered = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id }, { jobId: missingId }],
          }),
        );

        assert.equal(triggered[0]!.id, createdChain.head.id);
        assert.equal(triggered[1], undefined);
      }),
    },
    {
      name: "skips completed ids",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const futureDate = new Date(Date.now() + 60_000);
        const created = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-not-pending",
                  input: null,
                  schedule: { at: futureDate },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trigger-not-pending",
                  input: null,
                  schedule: { at: futureDate },
                },
              ],
            }),
          ),
        );
        const [pending, toComplete] = created.map((c) => c.head);

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: toComplete.id, output: null }],
            }),
          ),
        );

        const triggered = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: pending.id }, { jobId: toComplete.id }],
          }),
        );

        assert.equal(triggered[0]!.id, pending.id);
        assert.equal(triggered[1], undefined);
      }),
    },
    {
      name: "clears a running attempt and records the error",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["resched-fail-test"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-fail-test",
                  input: null,
                },
              ],
            }),
          ),
        );

        const [claimed] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["resched-fail-test"],
            limit: 1,
          }),
        );

        const before = Date.now();
        const [failed] = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [
              {
                jobId: createdChain.head.id,
                schedule: { afterMs: 5000 },
                error: "transient failure",
                attemptToken: claimed.attemptToken!,
              },
            ],
          }),
        );

        assert.equal(failed!.status, "pending");
        assert.equal(failed!.completedAt, null);
        assert.equal(failed!.attemptAt, null);
        assert.equal(failed!.attemptBy, null);
        assert.equal(failed!.attemptToken, null);
        assert.equal(failed!.lastAttemptError, "transient failure");
        assert.ok(failed!.lastAttemptAt instanceof Date);
        assert.ok(failed!.scheduledAt.getTime() >= before + 4000);
      }),
    },
    {
      name: "clears a running attempt without recording an error",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["resched-running-test"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-running-test",
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
            typeNames: ["resched-running-test"],
            limit: 1,
          }),
        );

        const before = Date.now();
        const [rescheduled] = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id, schedule: { afterMs: 5000 } }],
          }),
        );

        assert.equal(rescheduled!.completedAt, null);
        assert.equal(rescheduled!.attemptAt, null);
        assert.equal(rescheduled!.attemptBy, null);
        assert.equal(rescheduled!.attemptToken, null);
        assert.equal(rescheduled!.lastAttemptError, null);
        assert.ok(rescheduled!.lastAttemptAt instanceof Date);
        assert.ok(rescheduled!.scheduledAt.getTime() >= before + 4000);
      }),
    },
    {
      name: "leaves attempt bookkeeping untouched when there is no attempt to clear",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-no-attempt",
                  input: null,
                },
              ],
            }),
          ),
        );

        const [rescheduled] = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [
              {
                jobId: createdChain.head.id,
                schedule: { afterMs: 5000 },
                error: "should-not-apply",
              },
            ],
          }),
        );

        assert.equal(rescheduled!.lastAttemptError, null);
        assert.equal(rescheduled!.lastAttemptAt, null);
        assert.ok(rescheduled!.scheduledAt.getTime() > Date.now() + 4000);
      }),
    },
    {
      name: "reschedules to a future absolute date with schedule.at",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "resched-at", input: null },
              ],
            }),
          ),
        );

        const futureDate = new Date(Date.now() + 60_000);
        const rescheduled = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id, schedule: { at: futureDate } }],
          }),
        );

        assert.equal(rescheduled.length, 1);
        assert.equal(rescheduled[0]!.completedAt, null);
        assert.equal(rescheduled[0]!.attemptAt, null);
        assert.ok(Math.abs(rescheduled[0]!.scheduledAt.getTime() - futureDate.getTime()) < 1000);
      }),
    },
    {
      name: "reschedules into the future with schedule.afterMs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "resched-after", input: null },
              ],
            }),
          ),
        );

        const before = Date.now();
        const rescheduled = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id, schedule: { afterMs: 60_000 } }],
          }),
        );

        assert.ok(rescheduled[0]!.scheduledAt.getTime() >= before + 59_000);
      }),
    },
    {
      name: "reschedules with a schedule.afterMs of 30 days",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "resched-far", input: null },
              ],
            }),
          ),
        );

        const before = Date.now();
        const rescheduled = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id, schedule: { afterMs: thirtyDaysMs } }],
          }),
        );

        const diff = rescheduled[0]!.scheduledAt.getTime() - before;
        assert.ok(diff >= thirtyDaysMs - 1000);
        assert.ok(diff < thirtyDaysMs + 1000);
      }),
    },
    {
      name: "reschedules with a fractional schedule.afterMs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const fractionalMs = 60_000.5;
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-fractional",
                  input: null,
                },
              ],
            }),
          ),
        );

        const before = Date.now();
        const rescheduled = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id, schedule: { afterMs: fractionalMs } }],
          }),
        );

        const diff = rescheduled[0]!.scheduledAt.getTime() - before;
        assert.ok(diff >= fractionalMs - 1000);
        assert.ok(diff < fractionalMs + 1000);
      }),
    },
    {
      name: "clamps a past schedule.at to now",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-past",
                  input: null,
                  schedule: { at: new Date(Date.now() + 60_000) },
                },
              ],
            }),
          ),
        );

        const past = new Date(Date.now() - 60 * 60 * 1000);
        const before = Date.now();
        const rescheduled = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id, schedule: { at: past } }],
          }),
        );

        assert.ok(rescheduled[0]!.scheduledAt.getTime() >= before - 1000);
        assert.ok(rescheduled[0]!.scheduledAt.getTime() <= Date.now() + 1000);
      }),
    },
    {
      name: "reschedules a blocked job",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain, blockedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-blocker",
                  input: null,
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-blocked",
                  input: null,
                  schedule: { at: new Date(Date.now() + 60_000) },
                },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        const [refreshedBlockedJob] = yield* step(
          stateAdapter.getJobs({
            jobIds: [blockedChain.head.id],
          }),
        );
        assert.equal(refreshedBlockedJob!.status, "blocked");

        const futureDate = new Date(Date.now() + 120_000);
        const rescheduled = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: blockedChain.head.id, schedule: { at: futureDate } }],
          }),
        );

        assert.equal(rescheduled.length, 1);
        assert.equal(rescheduled[0]!.status, "blocked");
        assert.ok(Math.abs(rescheduled[0]!.scheduledAt.getTime() - futureDate.getTime()) < 1000);
      }),
    },
    {
      name: "omitted schedule reschedules to now",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-now",
                  input: null,
                  schedule: { at: new Date(Date.now() + 60_000) },
                },
              ],
            }),
          ),
        );

        const before = Date.now();
        const rescheduled = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [{ jobId: createdChain.head.id }],
          }),
        );

        assert.ok(rescheduled[0]!.scheduledAt.getTime() >= before - 1000);
        assert.ok(rescheduled[0]!.scheduledAt.getTime() <= Date.now() + 1000);
      }),
    },
    {
      name: "reports an undefined result for a token no attempt holds",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["resched-token-unknown"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-token-unknown",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [job] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["resched-token-unknown"],
            limit: 1,
          }),
        );
        const [before] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));

        const [rescheduled] = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [
              {
                jobId: job.id,
                error: "boom",
                attemptToken: crypto.randomUUID(),
              },
            ],
          }),
        );

        assert.equal(rescheduled, undefined);
        const [after] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));
        assert.deepEqual(after, before);
      }),
    },
    {
      name: "reports an undefined result for the token of an attempt the same worker has since replaced",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["resched-token-replaced"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-token-replaced",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [job] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["resched-token-replaced"],
            limit: 1,
          }),
        );
        yield* step(stateAdapter.rescheduleJobs({ jobs: [{ jobId: job.id }] }));
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["resched-token-replaced"],
            limit: 1,
          }),
        );
        const [before] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));

        const [rescheduled] = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [
              {
                jobId: job.id,
                error: "boom",
                attemptToken: job.attemptToken!,
              },
            ],
          }),
        );

        assert.equal(rescheduled, undefined);
        const [after] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));
        assert.deepEqual(after, before);
      }),
    },
    {
      name: "reports an undefined result for the token of an attempt whose chain was deleted and recreated under the same id",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["resched-token-recreated"],
            concurrency: 2,
            leaseMs: 60_000,
          }),
        );
        const chainId = stateAdapter.config.generateJobId();
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: chainId, typeName: "resched-token-recreated", input: null }],
            }),
          ),
        );
        const [job] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["resched-token-recreated"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [chainId] }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: chainId, typeName: "resched-token-recreated", input: null }],
            }),
          ),
        );
        const [recreated] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["resched-token-recreated"],
            limit: 1,
          }),
        );
        assert.equal(recreated.id, job.id);
        assert.equal(recreated.attempt, job.attempt);
        assert.equal(recreated.attemptBy, job.attemptBy);

        const [rescheduled] = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [
              {
                jobId: chainId,
                error: "boom",
                attemptToken: job.attemptToken!,
              },
            ],
          }),
        );

        assert.equal(rescheduled, undefined);
        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [chainId] }));
        assert.equal(stored!.status, "running");
        assert.equal(stored!.attemptToken, recreated.attemptToken);
      }),
    },
    {
      name: "reschedules without a txCtx, committing on its own",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["resched-autocommit"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "resched-autocommit",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [acquired] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["resched-autocommit"],
            limit: 1,
          }),
        );

        const [rescheduled] = yield* step(
          stateAdapter.rescheduleJobs({
            jobs: [
              {
                jobId: createdChain.head.id,
                schedule: { afterMs: 60_000 },
                error: "boom",
                attemptToken: acquired.attemptToken!,
              },
            ],
          }),
        );
        assert.equal(rescheduled!.status, "pending");

        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));
        assert.equal(stored!.status, "pending");
        assert.equal(stored!.lastAttemptError, "boom");
        assert.equal(stored!.attemptBy, null);
        assert.equal(stored!.attemptToken, null);
      }),
    },
  ],
};
