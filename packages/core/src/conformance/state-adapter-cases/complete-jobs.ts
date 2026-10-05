import { sleep } from "../../helpers/sleep.js";
import { type StateAdapter } from "../../state-adapter/state-adapter.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

const createSignal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

/** A two-job chain whose pending tail completes the chain, so the chain head is its own row. */
const setupBlockerChain = async (
  stateAdapter: StateAdapter<any, any>,
  typeName: string,
): Promise<{ chainId: string; tailId: string }> => {
  const [chain] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createJobs({ txCtx, jobs: [{ typeName, input: null }] }),
  );
  const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.continueJobs({
      txCtx,
      jobs: [{ typeName: `${typeName}:step`, input: null, continueFromId: chain.id }],
    }),
  );
  return { chainId: chain.id, tailId: continued!.continuation.id };
};

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
            timeoutMsByTypeName: { "complete-test": 30_000 },
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
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

        const [completedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "batch-fail-test", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: completedChain.head.id, output: { first: true } }],
          }),
        );

        const missingJobId =
          createdChain.head.id.slice(0, -1) + (createdChain.head.id.endsWith("0") ? "1" : "0");

        await expect(
          stateAdapter.withTransaction(async (txCtx) => {
            const results = await stateAdapter.completeJobs({
              txCtx,
              completedBy: null,
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
            timeoutMsByTypeName: { "double-complete-test": 30_000 },
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: createdChain.head.id,
            fence: { attempt: 1, workerId: "worker-1" },
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

        const [secondCompletion] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-2",
            jobs: [{ jobId: createdChain.head.id, output: { second: true } }],
          }),
        );
        expect(secondCompletion).toBeUndefined();

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
            timeoutMsByTypeName: { "complete-clears-error": 30_000 },
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
            timeoutMsByTypeName: { "complete-clears-error": 30_000 },
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
        expect(chainBeforeCompletion!.status).toBe("running");
        expect(chainBeforeCompletion!.completedAt).toBeNull();

        const [completed] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "worker-1",
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
      name: "unblocks a dependent whose blocker was added before the chain completed, without a caller pre-lock",
      run: async ({ stateAdapter }, expect) => {
        const { chainId, tailId } = await setupBlockerChain(stateAdapter, "race-add-first");

        const addBlocker = async (txCtx: unknown, onAdded?: () => Promise<void>) => {
          const [blockerChain] = await stateAdapter.getChains({
            txCtx,
            chainIds: [chainId],
            lock: "write",
          });
          expect(blockerChain!.status).toBe("running");
          const [dependent] = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "race-add-first:dependent", input: null }],
          });
          const [blocked] = await stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: dependent.id, blockedByChainIds: [chainId] }],
          });
          expect(blocked.status).toBe("blocked");
          await onAdded?.();
          return dependent;
        };
        const completeChain = async (txCtx: unknown) => {
          const [completed] = await stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: tailId, output: null }],
          });
          const unblocked = await stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId });
          return { completed, unblocked };
        };

        let dependentId: string;
        let unblockedIds: string[];
        if (stateAdapter.transactionConcurrency === "serialized") {
          const dependent = await stateAdapter.withTransaction(async (txCtx) => addBlocker(txCtx));
          const { completed, unblocked } = await stateAdapter.withTransaction(completeChain);
          expect(completed).toBeDefined();
          dependentId = dependent.id;
          unblockedIds = unblocked.map((entry) => entry.job.id);
        } else {
          const added = createSignal();
          const adderGate = createSignal();
          const adderTx = stateAdapter.withTransaction(async (txCtx) =>
            addBlocker(txCtx, async () => {
              added.resolve();
              await adderGate.promise;
            }),
          );
          await added.promise;
          const completerTx = stateAdapter.withTransaction(completeChain);
          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          adderGate.resolve();
          const dependent = await adderTx;
          const { completed, unblocked } = await completerTx;
          expect(completed).toBeDefined();
          dependentId = dependent.id;
          unblockedIds = unblocked.map((entry) => entry.job.id);
        }

        expect(unblockedIds).toEqual([dependentId]);
        const [dependent] = await stateAdapter.getJobs({ jobIds: [dependentId] });
        expect(dependent!.status).toBe("pending");
        const [chain] = await stateAdapter.getChains({ chainIds: [chainId] });
        expect(chain!.status).toBe("completed");
      },
    },
    {
      name: "leaves a dependent pending when its blocker completed before the blocker was added, without a caller pre-lock",
      run: async ({ stateAdapter }, expect) => {
        const { chainId, tailId } = await setupBlockerChain(stateAdapter, "race-complete-first");

        const addBlocker = async (txCtx: unknown) => {
          const [blockerChain] = await stateAdapter.getChains({
            txCtx,
            chainIds: [chainId],
            lock: "write",
          });
          expect(blockerChain!.status).toBe("completed");
          const [dependent] = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "race-complete-first:dependent", input: null }],
          });
          const [withBlockers] = await stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: dependent.id, blockedByChainIds: [chainId] }],
          });
          expect(withBlockers.status).toBe("pending");
          return dependent;
        };
        const completeChain = async (txCtx: unknown, onCompleted?: () => Promise<void>) => {
          const [completed] = await stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: tailId, output: null }],
          });
          expect(completed).toBeDefined();
          const unblocked = await stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId });
          expect(unblocked).toEqual([]);
          await onCompleted?.();
        };

        let dependentId: string;
        if (stateAdapter.transactionConcurrency === "serialized") {
          await stateAdapter.withTransaction(async (txCtx) => completeChain(txCtx));
          const dependent = await stateAdapter.withTransaction(addBlocker);
          dependentId = dependent.id;
        } else {
          const completedSignal = createSignal();
          const completerGate = createSignal();
          const completerTx = stateAdapter.withTransaction(async (txCtx) =>
            completeChain(txCtx, async () => {
              completedSignal.resolve();
              await completerGate.promise;
            }),
          );
          await completedSignal.promise;
          const adderTx = stateAdapter.withTransaction(addBlocker);
          await sleep(LOCK_BLOCK_OBSERVATION_MS);
          completerGate.resolve();
          await completerTx;
          const dependent = await adderTx;
          dependentId = dependent.id;
        }

        const [dependent] = await stateAdapter.getJobs({ jobIds: [dependentId] });
        expect(dependent!.status).toBe("pending");
        const blockers = await stateAdapter.getJobBlockers({ jobId: dependentId });
        expect(blockers.map((blocker) => blocker.id)).toEqual([chainId]);
      },
    },
  ],
};
