import assert from "node:assert/strict";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const completeJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "completeJobs",
  cases: [
    {
      name: "completes a job with output",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.deepEqual(completed!.output, { result: 42 });
        assert.equal(completed!.continuedToId, null);
        assert.ok(completed!.completedAt instanceof Date);
        assert.equal(completed!.completedBy, worker.id);
        assert.equal(completed!.attemptBy, null);
        assert.equal(completed!.attemptToken, null);
        assert.equal(completed!.attemptAt, null);
      },
    },
    {
      name: "completes multiple jobs in one call, returning results in input order",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.deepEqual(
          completed.map((c) => c!.id),
          [secondChain.head.id, firstChain.head.id],
        );
        assert.deepEqual(completed[0]!.output, { done: 2 });
        assert.deepEqual(completed[1]!.output, { done: 1 });
      },
    },
    {
      name: "reports an undefined result for a missing or already-completed job",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        await assert.rejects(
          stateAdapter.withTransaction(async (txCtx) => {
            const results = await stateAdapter.completeJobs({
              txCtx,
              jobs: [
                { jobId: createdChain.head.id, output: { ok: true } },
                { jobId: missingJobId, output: { ok: true } },
                { jobId: completedChain.head.id, output: { second: true } },
              ],
            });
            assert.equal(results.length, 3);
            assert.ok(results[0]?.completedAt instanceof Date);
            assert.equal(results[1], undefined);
            assert.equal(results[2], undefined);
            throw new Error("caller aborts");
          }),
          /caller aborts/,
        );

        const [after, alreadyCompleted] = await stateAdapter.getJobs({
          jobIds: [createdChain.head.id, completedChain.head.id],
        });
        assert.equal(after!.completedAt, null);
        assert.deepEqual(alreadyCompleted!.output, { first: true });
      },
    },
    {
      name: "completes a job without an attempt token with a null completedBy",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.ok(completed!.completedAt instanceof Date);
        assert.equal(completed!.completedBy, null);
      },
    },
    {
      name: "completes a job whose output is undefined, storing it as null",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.ok(completed!.completedAt instanceof Date);
        assert.equal(completed!.output, null);

        const [stored] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        assert.ok(stored!.completedAt instanceof Date);
        assert.equal(stored!.output, null);
      },
    },
    {
      name: "leaves an already-completed job untouched on double-completion",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.ok(completed!.completedAt instanceof Date);
        assert.deepEqual(completed!.output, { first: true });

        const [secondCompletion] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: createdChain.head.id, output: { second: true } }],
          }),
        );
        assert.equal(secondCompletion, undefined);

        const [after] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        assert.deepEqual(after!.output, { first: true });
        assert.equal(after!.completedBy, worker.id);
        assert.equal(after!.attemptToken, null);
      },
    },
    {
      name: "clears lastAttemptError when completing a job that previously failed",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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
        assert.equal(failed!.lastAttemptError, "first attempt failed");

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

        assert.ok(completed!.completedAt instanceof Date);
        assert.equal(completed!.lastAttemptError, null);
        assert.equal(completed!.attemptAt, null);
      },
    },
    {
      name: "completing the only job in a chain completes the chain",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(completed!.id, createdChain.head.id);
        assert.equal(completed!.status, "completed");
        assert.ok(completed!.completedAt instanceof Date);
        assert.equal(completed!.chain.id, createdChain.head.chainId);
        assert.equal(completed!.chain.status, "completed");
        assert.ok(completed!.chain.completedAt instanceof Date);

        const [chain] = await stateAdapter.getChains({ chainIds: [createdChain.head.chainId] });
        assert.equal(chain!.tail, undefined);
        assert.ok(chain!.head.completedAt instanceof Date);
        assert.equal(chain!.head.completedBy, null);
        assert.deepEqual(chain!.head.output, { done: true });
        assert.ok(chain!.completedAt instanceof Date);
      },
    },
    {
      name: "completing the tail of a multi-job chain completes the chain",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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
        assert.equal(chainBeforeCompletion!.status, "running");
        assert.equal(chainBeforeCompletion!.completedAt, null);

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: tail.id, output: { final: true } }],
          }),
        );

        assert.equal(completed!.id, tail.id);
        assert.equal(completed!.chain.id, headChain.head.chainId);
        assert.equal(completed!.chain.status, "completed");
        assert.ok(completed!.chain.completedAt instanceof Date);

        const [chain] = await stateAdapter.getChains({ chainIds: [headChain.head.chainId] });
        assert.equal(chain!.status, "completed");
        assert.ok(chain!.completedAt instanceof Date);
        assert.equal(chain!.tail!.id, tail.id);
        assert.deepEqual(chain!.tail!.output, { final: true });
      },
    },
    {
      name: "reports an undefined result for a token no attempt holds, leaving the job and its chain head untouched",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(completed, undefined);
        assert.deepEqual(await stateAdapter.getJobs({ jobIds }), before);
      },
    },
    {
      name: "reports an undefined result for the token of an attempt the same worker has since replaced",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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

        assert.equal(completed, undefined);
        const [after] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });
        assert.deepEqual(after, before);
      },
    },
    {
      name: "reports an undefined result for the token of an attempt whose chain was deleted and recreated under the same id",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

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
        assert.equal(recreated.id, job.id);
        assert.equal(recreated.attempt, job.attempt);
        assert.equal(recreated.attemptBy, job.attemptBy);

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

        assert.equal(completed, undefined);
        const [stored] = await stateAdapter.getJobs({ jobIds: [chainId] });
        assert.equal(stored!.status, "running");
        assert.equal(stored!.attemptToken, recreated.attemptToken);
      },
    },
  ],
};
