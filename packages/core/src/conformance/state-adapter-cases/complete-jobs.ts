import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const completeJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "completeJobs",
  cases: [
    {
      name: "completes a job with output",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
            jobId: createdChain.head.id,
            workerId: "worker-1",
            timeoutMs: 10_000,
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [{ jobId: createdChain.head.id, output: { result: 42 } }],
          }),
        );

        expect(completed!.output).toEqual({ result: 42 });
        expect(completed!.continuedToId).toBeNull();
        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.completedBy).toBe("worker-1");
        expect(completed!.attemptBy).toBeNull();
        expect(completed!.attemptUntil).toBeNull();
        expect(completed!.attemptAt).toBeNull();
      },
    },
    {
      name: "completes multiple jobs in one call, returning results in input order",
      run: async ({ stateAdapter }, expect) => {
        const createdChains = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "batch-test", input: { n: 1 } },
              { typeName: "batch-test", input: { n: 2 } },
            ],
          }),
        );
        const [firstChain, secondChain] = createdChains;

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [
              { jobId: secondChain.head.id, output: { done: 2 } },
              { jobId: firstChain.head.id, output: { done: 1 } },
            ],
          }),
        );

        expect(completed.map((c) => c!.id)).toEqual([secondChain.head.id, firstChain.head.id]);
        expect(completed[0]!.output).toEqual({ done: 2 });
        expect(completed[1]!.output).toEqual({ done: 1 });
      },
    },
    {
      name: "reports an undefined result for a missing or already-completed job",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "batch-fail-test", input: null }],
          }),
        );

        const missingJobId =
          createdChain.head.id.slice(0, -1) + (createdChain.head.id.endsWith("0") ? "1" : "0");

        // The missing id is a hole in the result, not a thrown error: the caller reads
        // it and decides whether to abort, which is what keeps the batch atomic.
        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            const results = await stateAdapter.completeJobs({
              txCtx,
              completedBy: null,
              jobs: [
                { jobId: createdChain.head.id, output: { ok: true } },
                { jobId: missingJobId, output: { ok: true } },
              ],
            });
            expect(results).toHaveLength(2);
            expect(results[0]?.completedAt).toBeInstanceOf(Date);
            expect(results[1]).toBeUndefined();
            throw new Error("caller aborts");
          }),
        ).rejects.toThrow("caller aborts");

        const [after] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(after!.completedAt).toBeNull();
      },
    },
    {
      name: "completes a job with null completedBy (workerless)",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "workerless-test", input: null }],
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: createdChain.head.id, output: { done: true } }],
          }),
        );

        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.completedBy).toBeNull();
      },
    },
    {
      name: "completes a job whose output is undefined, storing it as null",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "undefined-output", input: null }],
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: createdChain.head.id, output: undefined }],
          }),
        );

        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.output).toBeNull();

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(stored!.completedAt).toBeInstanceOf(Date);
        expect(stored!.output).toBeNull();
      },
    },
    {
      name: "leaves an already-completed job untouched on double-completion",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
            jobId: createdChain.head.id,
            workerId: "worker-1",
            timeoutMs: 10_000,
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [{ jobId: createdChain.head.id, output: { first: true } }],
          }),
        );

        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.output).toEqual({ first: true });

        await stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              completedBy: "worker-2",
              jobs: [{ jobId: createdChain.head.id, output: { second: true } }],
            }),
          )
          .catch(() => {});

        const [after] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(after!.output).toEqual({ first: true });
        expect(after!.completedBy).toBe("worker-1");
      },
    },
    {
      name: "clears lastAttemptError when completing a job that previously failed",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
              {
                jobId: createdChain.head.id,
                schedule: { afterMs: 5000 },
                error: "first attempt failed",
              },
            ],
          }),
        );
        expect(failed!.lastAttemptError).toBe("first attempt failed");

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
            completedBy: "worker-1",
            jobs: [{ jobId: createdChain.head.id, output: { ok: true } }],
          }),
        );

        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.lastAttemptError).toBeNull();
        expect(completed!.attemptAt).toBeNull();
        expect(completed!.attemptUntil).toBeNull();
      },
    },
    {
      name: "completing the only job in a chain completes the chain",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "one-job-chain", input: null }],
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [{ jobId: createdChain.head.id, output: { done: true } }],
          }),
        );

        expect(completed!.id).toBe(createdChain.head.id);
        expect(completed!.status).toBe("completed");
        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.chain.id).toBe(createdChain.head.chainId);
        expect(completed!.chain.status).toBe("completed");
        expect(completed!.chain.completedAt).toBeInstanceOf(Date);

        // The head and the completing job are the same row here, so both halves of the
        // write have to survive — an implementation that splits them loses one silently.
        const [chain] = await stateAdapter.getChains({ chainIds: [createdChain.head.chainId] });
        expect(chain!.tail).toBeUndefined();
        expect(chain!.head.completedAt).toBeInstanceOf(Date);
        expect(chain!.head.completedBy).toBe("worker-1");
        expect(chain!.head.output).toEqual({ done: true });
        expect(chain!.completedAt).toBeInstanceOf(Date);
      },
    },
    {
      name: "completing the tail of a multi-job chain completes the chain",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "multi-job-chain", input: null }],
          }),
        );

        const [continuedTail] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [{ typeName: "multi-job-chain", input: null, continueFromId: headChain.head.id }],
          }),
        );
        const { continuation: tail } = continuedTail!;

        const [chainBeforeCompletion] = await stateAdapter.getChains({
          chainIds: [headChain.head.chainId],
        });
        expect(chainBeforeCompletion!.completedAt).toBeNull();

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [{ jobId: tail.id, output: null }],
          }),
        );

        expect(completed!.id).toBe(tail.id);
        expect(completed!.chain.id).toBe(headChain.head.chainId);
        expect(completed!.chain.completedAt).toBeInstanceOf(Date);

        const [chain] = await stateAdapter.getChains({ chainIds: [headChain.head.chainId] });
        expect(chain!.completedAt).toBeInstanceOf(Date);
        expect(chain!.tail!.id).toBe(tail.id);
      },
    },
    {
      name: "reports hasBlockedJobs only when a job depends on the completing chain",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "has-blocking-blocker", input: null }],
          }),
        );

        const [dependentChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "has-blocking-dependent", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: dependentChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const [blockerCompleted] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );
        expect(blockerCompleted!.hasBlockedJobs).toBe(true);

        const [independentChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "has-blocking-independent", input: null }],
          }),
        );

        const [independentCompleted] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: independentChain.head.id, output: null }],
          }),
        );
        expect(independentCompleted!.hasBlockedJobs).toBe(false);
      },
    },
  ],
};
