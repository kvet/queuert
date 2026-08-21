import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const finishJobAttemptGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "finishJobAttempt",
  cases: [
    {
      name: "completes a job with output",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "complete-test", input: { value: 1 } }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["complete-test"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            timeoutMs: 10_000,
          }),
        );

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            outcome: { output: { result: 42 } },
          }),
        );

        expect(completed.output).toEqual({ result: 42 });
        expect(completed.continuedToId).toBeNull();
        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.completedBy).toBe("worker-1");
        expect(completed.attemptBy).toBeNull();
        expect(completed.attemptUntil).toBeNull();
        expect(completed.attemptAt).toBeNull();
      },
    },
    {
      name: "links the parent to its successor when completing as a continuation",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: parent }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "cont-parent", input: null }],
          }),
        );

        const { job: child } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: { typeName: "cont-child", continueFromId: parent.id, input: null },
          }),
        );

        // Before completion the parent is not yet linked — it is still running.
        const [parentBefore] = await stateAdapter.getJobs({ jobIds: [parent.id] });
        expect(parentBefore!.continuedToId).toBeNull();

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: parent.id,
            workerId: "worker-1",
            outcome: { continuedToId: child.id },
          }),
        );

        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.continuedToId).toBe(child.id);
        expect(completed.output).toBeNull();

        const [parentAfter] = await stateAdapter.getJobs({ jobIds: [parent.id] });
        expect(parentAfter!.continuedToId).toBe(child.id);
      },
    },
    {
      name: "completes a job with null workerId (workerless)",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "workerless-test", input: null }],
          }),
        );

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: null,
            outcome: { output: { done: true } },
          }),
        );

        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.completedBy).toBeNull();
      },
    },
    {
      name: "fails a running job back to pending and records the attempt error",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "fail-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: ["fail-test"] }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            timeoutMs: 10_000,
          }),
        );

        const failed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            outcome: { error: "transient failure", schedule: { afterMs: 5000 } },
          }),
        );

        expect(failed.completedAt).toBeNull();
        expect(failed.attemptAt).toBeNull();
        expect(failed.lastAttemptError).toBe("transient failure");
        expect(failed.lastAttemptAt).toBeInstanceOf(Date);
        expect(failed.attemptBy).toBeNull();
        expect(failed.attemptUntil).toBeNull();
        expect(failed.attemptAt).toBeNull();
      },
    },
    {
      name: "fails with a schedule to set the next run time",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "fail-then-schedule", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["fail-then-schedule"],
          }),
        );

        const before = Date.now();
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            outcome: { error: "boom", schedule: { afterMs: 5000 } },
          }),
        );

        expect(rescheduled.completedAt).toBeNull();
        expect(rescheduled.attemptAt).toBeNull();
        expect(rescheduled.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
        expect(rescheduled.lastAttemptError).toBe("boom");
        expect(rescheduled.attemptBy).toBeNull();
        expect(rescheduled.attemptUntil).toBeNull();
        expect(rescheduled.attemptAt).toBeNull();
      },
    },
    {
      name: "reschedules a running job back to pending without recording an error",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "reschedule-test", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["reschedule-test"],
          }),
        );

        const before = Date.now();
        const rescheduled = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            outcome: { schedule: { afterMs: 5000 } },
          }),
        );

        expect(rescheduled.completedAt).toBeNull();
        expect(rescheduled.attemptAt).toBeNull();
        expect(rescheduled.attemptBy).toBeNull();
        expect(rescheduled.attemptUntil).toBeNull();
        expect(rescheduled.lastAttemptError).toBeNull();
        expect(rescheduled.lastAttemptAt).toBeInstanceOf(Date);
        expect(rescheduled.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
      },
    },
    {
      name: "leaves a non-running job untouched when failing",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "fail-non-running", input: null }],
          }),
        );

        await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.finishJobAttempt({
              txCtx,
              jobId: created.id,
              workerId: null,
              outcome: { error: "should-not-apply", schedule: { afterMs: 5000 } },
            }),
          )
          .catch(() => {});

        const [after] = await stateAdapter.getJobs({ jobIds: [created.id] });
        expect(after!.completedAt).toBeNull();
        expect(after!.attemptAt).toBeNull();
        expect(after!.lastAttemptError).not.toBe("should-not-apply");
      },
    },
    {
      name: "leaves an already-completed job untouched on double-completion",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "double-complete-test", input: { v: 1 } }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["double-complete-test"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            timeoutMs: 10_000,
          }),
        );

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            outcome: { output: { first: true } },
          }),
        );

        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.output).toEqual({ first: true });

        await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.finishJobAttempt({
              txCtx,
              jobId: created.id,
              workerId: "worker-2",
              outcome: { output: { second: true } },
            }),
          )
          .catch(() => {});

        const [after] = await stateAdapter.getJobs({ jobIds: [created.id] });
        expect(after!.output).toEqual({ first: true });
        expect(after!.completedBy).toBe("worker-1");
      },
    },
    {
      name: "clears lastAttemptError when completing a job that previously failed",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "complete-clears-error", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["complete-clears-error"],
          }),
        );

        const failed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            outcome: { error: "first attempt failed", schedule: { afterMs: 5000 } },
          }),
        );
        expect(failed.lastAttemptError).toBe("first attempt failed");

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["complete-clears-error"],
          }),
        );

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: created.id,
            workerId: "worker-1",
            outcome: { output: { ok: true } },
          }),
        );

        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.lastAttemptError).toBeNull();
      },
    },
  ],
};
