import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const completeJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "completeJobs",
  cases: [
    {
      name: "completes a job with output",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
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

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: created.id, completedBy: "worker-1", output: { result: 42 } }],
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
      name: "completes multiple jobs in one call, returning results in input order",
      run: async ({ stateAdapter }, expect) => {
        const created = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "batch-test", input: { n: 1 } },
              { typeName: "batch-test", input: { n: 2 } },
            ],
          }),
        );
        const [first, second] = created.map((r) => r.job);

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [
              { jobId: second.id, completedBy: null, output: { done: 2 } },
              { jobId: first.id, completedBy: null, output: { done: 1 } },
            ],
          }),
        );

        expect(completed.map((job) => job.id)).toEqual([second.id, first.id]);
        expect(completed[0].output).toEqual({ done: 2 });
        expect(completed[1].output).toEqual({ done: 1 });
      },
    },
    {
      name: "fails the batch when any job is missing or already completed",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "batch-fail-test", input: null }],
          }),
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [
                { jobId: created.id, completedBy: null, output: { ok: true } },
                { jobId: "missing-id", completedBy: null, output: { ok: true } },
              ],
            }),
          ),
        ).rejects.toThrow();

        const [after] = await stateAdapter.getJobs({ jobIds: [created.id] });
        expect(after!.completedAt).toBeNull();
      },
    },
    {
      name: "completes a job with null completedBy (workerless)",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "workerless-test", input: null }],
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: created.id, completedBy: null, output: { done: true } }],
          }),
        );

        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.completedBy).toBeNull();
      },
    },
    {
      name: "completes a job whose output is undefined, storing it as null",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "undefined-output", input: null }],
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: created.id, completedBy: null, output: undefined }],
          }),
        );

        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.output).toBeNull();

        const [stored] = await stateAdapter.getJobs({ jobIds: [created.id] });
        expect(stored!.completedAt).toBeInstanceOf(Date);
        expect(stored!.output).toBeNull();
      },
    },
    {
      name: "leaves an already-completed job untouched on double-completion",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
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

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: created.id, completedBy: "worker-1", output: { first: true } }],
          }),
        );

        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.output).toEqual({ first: true });

        await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: created.id, completedBy: "worker-2", output: { second: true } }],
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
          stateAdapter.createJobs({
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

        const [failed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.rescheduleJobs({
            txCtx,
            jobs: [
              { jobId: created.id, schedule: { afterMs: 5000 }, error: "first attempt failed" },
            ],
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

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: created.id, completedBy: "worker-1", output: { ok: true } }],
          }),
        );

        expect(completed.completedAt).toBeInstanceOf(Date);
        expect(completed.lastAttemptError).toBeNull();
        expect(completed.attemptAt).toBeNull();
        expect(completed.attemptUntil).toBeNull();
      },
    },
  ],
};
