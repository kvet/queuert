import type { ConformanceGroup } from "../runner.ts";
import type { StateConformanceFixture } from "./types.ts";

export const completeJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "completeJobs",
  cases: [
    {
      name: "completes a job with output",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["complete-test"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "complete-test",
                input: { value: 1 },
              },
            ],
          }),
        );

        const [claimed] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["complete-test"],
          limit: 1,
        });

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [
              {
                jobId: createdChain.head.id,
                output: { result: 42 },
                attemptToken: claimed.attemptToken!,
                workerId: claimed.attemptBy!,
              },
            ],
          }),
        );

        expect(completed!.output).toEqual({ result: 42 });
        expect(completed!.continuedToId).toBeNull();
        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.completedBy).toBe(worker.id);
        expect(completed!.attemptBy).toBeNull();
        expect(completed!.attemptToken).toBeNull();
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
              { id: stateAdapter.config.generateJobId(), typeName: "batch-test", input: { n: 1 } },
              { id: stateAdapter.config.generateJobId(), typeName: "batch-test", input: { n: 2 } },
            ],
          }),
        );
        const [firstChain, secondChain] = createdChains;

        const completed = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
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
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "batch-fail-test", input: null },
            ],
          }),
        );

        const [completedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "batch-fail-test", input: null },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: completedChain.head.id, output: { first: true } }],
          }),
        );

        const missingJobId =
          createdChain.head.id.slice(0, -1) + (createdChain.head.id.endsWith("0") ? "1" : "0");

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            const results = await stateAdapter.completeJobs({
              txCtx,
              jobs: [
                { jobId: createdChain.head.id, output: { ok: true } },
                { jobId: missingJobId, output: { ok: true } },
                { jobId: completedChain.head.id, output: { second: true } },
              ],
            });
            expect(results).toHaveLength(3);
            expect(results[0]?.completedAt).toBeInstanceOf(Date);
            expect(results[1]).toBeUndefined();
            expect(results[2]).toBeUndefined();
            throw new Error("caller aborts");
          }),
        ).rejects.toThrow("caller aborts");

        const [after, alreadyCompleted] = await stateAdapter.getJobs({
          jobIds: [createdChain.head.id, completedChain.head.id],
        });
        expect(after!.completedAt).toBeNull();
        expect(alreadyCompleted!.output).toEqual({ first: true });
      },
    },
    {
      name: "completes a job without an attempt token with a null completedBy",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "workerless-test", input: null },
            ],
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
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
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "undefined-output",
                input: null,
              },
            ],
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
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
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["double-complete-test"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "double-complete-test",
                input: { v: 1 },
              },
            ],
          }),
        );

        const [claimed] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["double-complete-test"],
          limit: 1,
        });

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [
              {
                jobId: createdChain.head.id,
                output: { first: true },
                attemptToken: claimed.attemptToken!,
                workerId: claimed.attemptBy!,
              },
            ],
          }),
        );

        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.output).toEqual({ first: true });

        const [secondCompletion] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, output: { second: true } }],
          }),
        );
        expect(secondCompletion).toBeUndefined();

        const [after] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(after!.output).toEqual({ first: true });
        expect(after!.completedBy).toBe(worker.id);
        expect(after!.attemptToken).toBeNull();
      },
    },
    {
      name: "clears lastAttemptError when completing a job that previously failed",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["complete-clears-error"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "complete-clears-error",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["complete-clears-error"],
          limit: 1,
        });

        const [failed] = await stateAdapter.rescheduleJobs({
          jobs: [
            {
              jobId: createdChain.head.id,
              schedule: { afterMs: 5000 },
              error: "first attempt failed",
            },
          ],
        });
        expect(failed!.lastAttemptError).toBe("first attempt failed");

        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["complete-clears-error"],
          limit: 1,
        });

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, output: { ok: true } }],
          }),
        );

        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.lastAttemptError).toBeNull();
        expect(completed!.attemptAt).toBeNull();
      },
    },
    {
      name: "completing the only job in a chain completes the chain",
      run: async ({ stateAdapter }, expect) => {
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "one-job-chain", input: null },
            ],
          }),
        );

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, output: { done: true } }],
          }),
        );

        expect(completed!.id).toBe(createdChain.head.id);
        expect(completed!.status).toBe("completed");
        expect(completed!.completedAt).toBeInstanceOf(Date);
        expect(completed!.chain.id).toBe(createdChain.head.chainId);
        expect(completed!.chain.status).toBe("completed");
        expect(completed!.chain.completedAt).toBeInstanceOf(Date);

        const [chain] = await stateAdapter.getChains({ chainIds: [createdChain.head.chainId] });
        expect(chain!.tail).toBeUndefined();
        expect(chain!.head.completedAt).toBeInstanceOf(Date);
        expect(chain!.head.completedBy).toBeNull();
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
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "multi-job-chain", input: null },
            ],
          }),
        );

        const [continuedTail] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "multi-job-chain",
                input: null,
                continueFromId: headChain.head.id,
              },
            ],
          }),
        );
        const { continuation: tail } = continuedTail!;

        const [chainBeforeCompletion] = await stateAdapter.getChains({
          chainIds: [headChain.head.chainId],
        });
        expect(chainBeforeCompletion!.status).toBe("running");
        expect(chainBeforeCompletion!.completedAt).toBeNull();

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: tail.id, output: { final: true } }],
          }),
        );

        expect(completed!.id).toBe(tail.id);
        expect(completed!.chain.id).toBe(headChain.head.chainId);
        expect(completed!.chain.status).toBe("completed");
        expect(completed!.chain.completedAt).toBeInstanceOf(Date);

        const [chain] = await stateAdapter.getChains({ chainIds: [headChain.head.chainId] });
        expect(chain!.status).toBe("completed");
        expect(chain!.completedAt).toBeInstanceOf(Date);
        expect(chain!.tail!.id).toBe(tail.id);
        expect(chain!.tail!.output).toEqual({ final: true });
      },
    },
    {
      name: "reports an undefined result for a token no attempt holds, leaving the job and its chain head untouched",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["complete-token-unknown"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "complete-token-head",
                input: null,
              },
            ],
          }),
        );
        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "complete-token-unknown",
                input: null,
                continueFromId: headChain.head.id,
              },
            ],
          }),
        );
        const [job] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["complete-token-unknown"],
          limit: 1,
        });
        const jobIds = [continued!.continuation.id, headChain.head.id];
        const before = await stateAdapter.getJobs({ jobIds });

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [
              {
                jobId: job.id,
                output: null,
                attemptToken: crypto.randomUUID(),
              },
            ],
          }),
        );

        expect(completed).toBeUndefined();
        expect(await stateAdapter.getJobs({ jobIds })).toEqual(before);
      },
    },
    {
      name: "reports an undefined result for the token of an attempt the same worker has since replaced",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["complete-token-replaced"],
          concurrency: 1,
          leaseMs: 60_000,
        });
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                id: stateAdapter.config.generateJobId(),
                typeName: "complete-token-replaced",
                input: null,
              },
            ],
          }),
        );
        const [job] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["complete-token-replaced"],
          limit: 1,
        });
        await stateAdapter.rescheduleJobs({ jobs: [{ jobId: job.id }] });
        await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["complete-token-replaced"],
          limit: 1,
        });
        const [before] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [
              {
                jobId: job.id,
                output: null,
                attemptToken: job.attemptToken!,
                workerId: job.attemptBy!,
              },
            ],
          }),
        );

        expect(completed).toBeUndefined();
        const [after] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        expect(after).toEqual(before);
      },
    },
    {
      name: "reports an undefined result for the token of an attempt whose chain was deleted and recreated under the same id",
      run: async ({ stateAdapter }, expect) => {
        const worker = await stateAdapter.startWorker({
          workerId: stateAdapter.config.generateWorkerId(),
          typeNames: ["complete-token-recreated"],
          concurrency: 2,
          leaseMs: 60_000,
        });
        const chainId = stateAdapter.config.generateJobId();
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: chainId, typeName: "complete-token-recreated", input: null }],
          }),
        );
        const [job] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["complete-token-recreated"],
          limit: 1,
        });
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.deleteChains({ txCtx, chainIds: [chainId] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: chainId, typeName: "complete-token-recreated", input: null }],
          }),
        );
        const [recreated] = await stateAdapter.startJobAttempts({
          workerId: worker.id,
          workerToken: worker.token,
          typeNames: ["complete-token-recreated"],
          limit: 1,
        });
        expect(recreated.id).toBe(job.id);
        expect(recreated.attempt).toBe(job.attempt);
        expect(recreated.attemptBy).toBe(job.attemptBy);

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [
              {
                jobId: chainId,
                output: null,
                attemptToken: job.attemptToken!,
                workerId: job.attemptBy!,
              },
            ],
          }),
        );

        expect(completed).toBeUndefined();
        const [stored] = await stateAdapter.getJobs({ jobIds: [chainId] });
        expect(stored!.status).toBe("running");
        expect(stored!.attemptToken).toBe(recreated.attemptToken);
      },
    },
  ],
};
