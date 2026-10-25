import { type ConformanceGroup } from "../runner.js";
import { transaction } from "../transaction.js";
import { type StateConformanceFixture } from "./types.js";

export const rescheduleJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "rescheduleJobs",
  cases: [
    {
      name: "sets scheduledAt to now on a pending job",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-test",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        expect(
          Math.abs(createdChain.head.scheduledAt.getTime() - futureDate.getTime()),
        ).toBeLessThan(1000);

        const before = Date.now();
        const triggered = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: createdChain.head.id }] }),
        );

        expect(triggered).toHaveLength(1);
        expect(triggered[0]!.completedAt).toBeNull();
        expect(triggered[0]!.attemptAt).toBeNull();
        expect(triggered[0]!.scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(triggered[0]!.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      },
    },
    {
      name: "makes a future-scheduled job acquirable",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-acquire",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        const [beforeTrigger] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "trigger-acquire": 30_000 },
            limit: 1,
          }),
        );
        expect(beforeTrigger).toBeUndefined();

        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: createdChain.head.id }] }),
        );

        const [afterTrigger] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "trigger-acquire": 30_000 },
            limit: 1,
          }),
        );
        expect(afterTrigger).toBeDefined();
        expect(afterTrigger.id).toBe(createdChain.head.id);
      },
    },
    {
      name: "preserves other job fields",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-fields",
                input: { key: "value" },
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        const triggered = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: createdChain.head.id }] }),
        );

        expect(triggered[0]!.id).toBe(createdChain.head.id);
        expect(triggered[0]!.typeName).toBe("trigger-fields");
        expect(triggered[0]!.input).toEqual({ key: "value" });
        expect(triggered[0]!.chainId).toBe(createdChain.head.chainId);
        expect(triggered[0]!.attempt).toBe(createdChain.head.attempt);
      },
    },
    {
      name: "triggers multiple jobs in input order",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const created = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-batch",
                input: { i: 1 },
                schedule: { at: futureDate },
              },
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-batch",
                input: { i: 2 },
                schedule: { at: futureDate },
              },
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-batch",
                input: { i: 3 },
                schedule: { at: futureDate },
              },
            ],
          }),
        );
        const ids = created.map((c) => c.head.id);

        const triggered = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: ids.map((jobId) => ({ jobId })) }),
        );

        expect(triggered.map((j) => j!.id)).toEqual(ids);

        // Preserves input order when input order differs from insertion order.
        const reversed = [...ids].reverse();
        const reversedTriggered = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: reversed.map((jobId) => ({ jobId })) }),
        );
        expect(reversedTriggered.map((j) => j!.id)).toEqual(reversed);
      },
    },
    {
      name: "returns the rescheduled job at every position of a repeated id",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-duplicate",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        const triggered = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id }, { jobId: createdChain.head.id }],
          }),
        );

        expect(triggered).toHaveLength(2);
        expect(triggered[0]!.id).toBe(createdChain.head.id);
        expect(triggered[1]!.id).toBe(createdChain.head.id);
        expect(triggered[0]!.status).toBe("pending");
        expect(triggered[1]!.status).toBe("pending");
        expect(triggered[0]!.scheduledAt.getTime()).toBeLessThan(futureDate.getTime());
        expect(triggered[1]!.scheduledAt.getTime()).toBe(triggered[0]!.scheduledAt.getTime());
      },
    },
    {
      name: "returns empty array for empty jobIds",
      run: async ({ stateAdapter }, expect) => {
        const triggered = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [] }),
        );
        expect(triggered).toEqual([]);
      },
    },
    {
      name: "skips missing ids",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-missing",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        const missingId = crypto.randomUUID();
        const triggered = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id }, { jobId: missingId }],
          }),
        );

        expect(triggered[0]!.id).toBe(createdChain.head.id);
        expect(triggered[1]).toBeUndefined();
      },
    },
    {
      name: "skips completed ids",
      run: async ({ stateAdapter }, expect) => {
        const futureDate = new Date(Date.now() + 60_000);
        const created = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-not-pending",
                input: null,
                schedule: { at: futureDate },
              },
              {
                id: stateAdapter.config.generateId(),
                typeName: "trigger-not-pending",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );
        const [pending, toComplete] = created.map((c) => c.head);

        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: toComplete.id, output: null }],
          }),
        );

        const triggered = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: pending.id }, { jobId: toComplete.id }],
          }),
        );

        expect(triggered[0]!.id).toBe(pending.id);
        expect(triggered[1]).toBeUndefined();
      },
    },
    {
      name: "clears a running attempt and records the error",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "resched-fail-test", input: null },
            ],
          }),
        );

        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "resched-fail-test": 30_000 },
            limit: 1,
          }),
        );

        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
            timeoutMs: 10_000,
          }),
        );

        const before = Date.now();
        const [failed] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [
              {
                jobId: createdChain.head.id,
                schedule: { afterMs: 5000 },
                error: "transient failure",
                fence: { attempt: 1, workerId: "worker-1" },
              },
            ],
          }),
        );

        expect(failed!.status).toBe("pending");
        expect(failed!.completedAt).toBeNull();
        expect(failed!.attemptAt).toBeNull();
        expect(failed!.attemptBy).toBeNull();
        expect(failed!.attemptUntil).toBeNull();
        expect(failed!.lastAttemptError).toBe("transient failure");
        expect(failed!.lastAttemptAt).toBeInstanceOf(Date);
        expect(failed!.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
      },
    },
    {
      name: "clears a running attempt without recording an error",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "resched-running-test",
                input: null,
              },
            ],
          }),
        );

        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "resched-running-test": 30_000 },
            limit: 1,
          }),
        );

        const before = Date.now();
        const [rescheduled] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, schedule: { afterMs: 5000 } }],
          }),
        );

        expect(rescheduled!.completedAt).toBeNull();
        expect(rescheduled!.attemptAt).toBeNull();
        expect(rescheduled!.attemptBy).toBeNull();
        expect(rescheduled!.attemptUntil).toBeNull();
        expect(rescheduled!.lastAttemptError).toBeNull();
        expect(rescheduled!.lastAttemptAt).toBeInstanceOf(Date);
        expect(rescheduled!.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
      },
    },
    {
      name: "leaves attempt bookkeeping untouched when there is no attempt to clear",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "resched-no-attempt", input: null },
            ],
          }),
        );

        const [rescheduled] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [
              {
                jobId: createdChain.head.id,
                schedule: { afterMs: 5000 },
                error: "should-not-apply",
              },
            ],
          }),
        );

        expect(rescheduled!.lastAttemptError).toBeNull();
        expect(rescheduled!.lastAttemptAt).toBeNull();
        expect(rescheduled!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 4000);
      },
    },
    {
      name: "reschedules to a future absolute date with schedule.at",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "resched-at", input: null }],
          }),
        );

        const futureDate = new Date(Date.now() + 60_000);
        const rescheduled = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, schedule: { at: futureDate } }],
          }),
        );

        expect(rescheduled).toHaveLength(1);
        expect(rescheduled[0]!.completedAt).toBeNull();
        expect(rescheduled[0]!.attemptAt).toBeNull();
        expect(Math.abs(rescheduled[0]!.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(
          1000,
        );
      },
    },
    {
      name: "reschedules into the future with schedule.afterMs",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "resched-after", input: null },
            ],
          }),
        );

        const before = Date.now();
        const rescheduled = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, schedule: { afterMs: 60_000 } }],
          }),
        );

        expect(rescheduled[0]!.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 59_000);
      },
    },
    {
      name: "reschedules with a schedule.afterMs of 30 days",
      run: async ({ stateAdapter }, expect) => {
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateId(), typeName: "resched-far", input: null }],
          }),
        );

        const before = Date.now();
        const rescheduled = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, schedule: { afterMs: thirtyDaysMs } }],
          }),
        );

        const diff = rescheduled[0]!.scheduledAt.getTime() - before;
        expect(diff).toBeGreaterThanOrEqual(thirtyDaysMs - 1000);
        expect(diff).toBeLessThan(thirtyDaysMs + 1000);
      },
    },
    {
      name: "reschedules with a fractional schedule.afterMs",
      run: async ({ stateAdapter }, expect) => {
        const fractionalMs = 60_000.5;
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "resched-fractional", input: null },
            ],
          }),
        );

        const before = Date.now();
        const rescheduled = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, schedule: { afterMs: fractionalMs } }],
          }),
        );

        const diff = rescheduled[0]!.scheduledAt.getTime() - before;
        expect(diff).toBeGreaterThanOrEqual(fractionalMs - 1000);
        expect(diff).toBeLessThan(fractionalMs + 1000);
      },
    },
    {
      name: "clamps a past schedule.at to now",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "resched-past",
                input: null,
                schedule: { at: new Date(Date.now() + 60_000) },
              },
            ],
          }),
        );

        const past = new Date(Date.now() - 60 * 60 * 1000);
        const before = Date.now();
        const rescheduled = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, schedule: { at: past } }],
          }),
        );

        expect(rescheduled[0]!.scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(rescheduled[0]!.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      },
    },
    {
      name: "reschedules a blocked job",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain, blockedChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "resched-blocker", input: null },
              {
                id: stateAdapter.config.generateId(),
                typeName: "resched-blocked",
                input: null,
                schedule: { at: new Date(Date.now() + 60_000) },
              },
            ],
          }),
        );

        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const [refreshedBlockedJob] = await stateAdapter.getJobs({
          jobIds: [blockedChain.head.id],
        });
        expect(refreshedBlockedJob!.status).toBe("blocked");

        const futureDate = new Date(Date.now() + 120_000);
        const rescheduled = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [{ jobId: blockedChain.head.id, schedule: { at: futureDate } }],
          }),
        );

        expect(rescheduled).toHaveLength(1);
        expect(rescheduled[0]!.status).toBe("blocked");
        expect(Math.abs(rescheduled[0]!.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(
          1000,
        );
      },
    },
    {
      name: "omitted schedule reschedules to now",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "resched-now",
                input: null,
                schedule: { at: new Date(Date.now() + 60_000) },
              },
            ],
          }),
        );

        const before = Date.now();
        const rescheduled = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: createdChain.head.id }] }),
        );

        expect(rescheduled[0]!.scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(rescheduled[0]!.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      },
    },
    {
      name: "reports an undefined result for a fence of another worker",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "resched-fence-other",
                input: null,
              },
            ],
          }),
        );
        const [job] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "resched-fence-other": 30_000 },
            limit: 1,
          }),
        );
        const [before] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });

        const [rescheduled] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [
              {
                jobId: job.id,
                error: "boom",
                fence: { attempt: job.attempt, workerId: "worker-2" },
              },
            ],
          }),
        );

        expect(rescheduled).toBeUndefined();
        const [after] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(after).toEqual(before);
      },
    },
    {
      name: "reports an undefined result for a fence on an attempt the same worker has since replaced",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateId(),
                typeName: "resched-fence-replaced",
                input: null,
              },
            ],
          }),
        );
        const [job] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "resched-fence-replaced": 30_000 },
            limit: 1,
          }),
        );
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({ txCtx, jobs: [{ jobId: job.id }] }),
        );
        await transaction(stateAdapter, (txCtx) =>
          stateAdapter.startJobAttempts({
            txCtx,
            workerId: "worker-1",
            timeoutMsByTypeName: { "resched-fence-replaced": 30_000 },
            limit: 1,
          }),
        );
        const [before] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });

        const [rescheduled] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [
              {
                jobId: job.id,
                error: "boom",
                fence: { attempt: job.attempt, workerId: "worker-1" },
              },
            ],
          }),
        );

        expect(rescheduled).toBeUndefined();
        const [after] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(after).toEqual(before);
      },
    },
    {
      name: "reschedules without a txCtx, committing on its own",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await transaction(stateAdapter, (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateId(), typeName: "resched-autocommit", input: null },
            ],
          }),
        );
        const [acquired] = await stateAdapter.startJobAttempts({
          workerId: "worker-1",
          timeoutMsByTypeName: { "resched-autocommit": 30_000 },
          limit: 1,
        });

        const [rescheduled] = await stateAdapter.rescheduleJobs({
          jobs: [
            {
              jobId: createdChain.head.id,
              schedule: { afterMs: 60_000 },
              error: "boom",
              fence: { attempt: acquired.attempt, workerId: "worker-1" },
            },
          ],
        });
        expect(rescheduled!.status).toBe("pending");

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.status).toBe("pending");
        expect(stored!.lastAttemptError).toBe("boom");
        expect(stored!.attemptBy).toBeNull();
      },
    },
  ],
};
