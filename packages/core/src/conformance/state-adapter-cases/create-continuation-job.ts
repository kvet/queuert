import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const createContinuationJobGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "createContinuationJob",
  cases: [
    {
      name: "inherits chainId from the parent and assigns a new job id",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "root-job",
                chainTypeName: "root-job",
                input: null,
              },
            ],
          }),
        );

        const { job: childJob } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "child-job",
              continueFromId: headJob.id,
              input: null,
            },
          }),
        );

        expect(childJob.chainId).toBe(headJob.chainId);
        expect(childJob.id).not.toBe(headJob.id);
      },
    },
    {
      name: "does not set the parent's continuedToId link",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "root", chainTypeName: "c", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: { typeName: "child", continueFromId: headJob.id, input: null },
          }),
        );

        const [headAfter] = await stateAdapter.getJobs({ jobIds: [headJob.id] });
        expect(headAfter!.continuedToId).toBe(null);
      },
    },
    {
      name: "rejects continuation referencing a non-existent parent",
      run: async ({ stateAdapter }, expect) => {
        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createContinuationJob({
              txCtx,
              job: {
                typeName: "child",
                continueFromId: "00000000-0000-0000-0000-000000000000",
                input: null,
              },
            }),
          ),
        ).rejects.toThrow();
      },
    },
    {
      name: "marks a second continuation from the same parent as deduplicated",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "root",
                chainTypeName: "c",
                input: null,
              },
            ],
          }),
        );

        const { job: c1, deduplicated: d1 } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "child",
              continueFromId: headJob.id,
              input: { v: 1 },
            },
          }),
        );

        const { job: c2, deduplicated: d2 } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "child",
              continueFromId: headJob.id,
              input: { v: 2 },
            },
          }),
        );

        expect(d1).toBe(false);
        expect(d2).toBe(true);
        expect(c2.id).toBe(c1.id);
        expect(c2.input).toEqual({ v: 1 });
      },
    },
    {
      name: "deduplicates concurrent continuations with same chain_index",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "chain-root",
                chainTypeName: "chain-root",
                input: null,
              },
            ],
          }),
        );

        const [result1, result2] = await Promise.all([
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createContinuationJob({
              txCtx,
              job: {
                typeName: "chain-step2",
                continueFromId: headJob.id,
                input: { from: "tx1" },
              },
            }),
          ),
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createContinuationJob({
              txCtx,
              job: {
                typeName: "chain-step2",
                continueFromId: headJob.id,
                input: { from: "tx2" },
              },
            }),
          ),
        ]);

        expect(result1.job.id).toBe(result2.job.id);
        expect(result1.deduplicated !== result2.deduplicated).toBe(true);
      },
    },
    {
      name: "extends a chain across multiple sequential continuations",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "t",
                chainTypeName: "t",
                input: null,
              },
            ],
          }),
        );
        expect(headJob.id).toBe(headJob.chainId);

        const { job: cont1 } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "t2",
              continueFromId: headJob.id,
              input: null,
            },
          }),
        );
        expect(cont1.chainId).toBe(headJob.chainId);

        const { job: cont2 } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "t3",
              continueFromId: cont1.id,
              input: null,
            },
          }),
        );
        expect(cont2.chainId).toBe(headJob.chainId);
        expect(cont2.id).not.toBe(cont1.id);
      },
    },
    {
      name: "creates continuation from an already-completed parent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "completed-parent",
                chainTypeName: "completed-parent",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: headJob.id,
            workerId: null,
            outcome: { output: { done: true } },
          }),
        );

        const [completedParent] = await stateAdapter.getJobs({ jobIds: [headJob.id] });
        expect(completedParent!.completedAt).not.toBeNull();

        const { job: childJob, deduplicated } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "child-of-completed",
              continueFromId: headJob.id,
              input: null,
            },
          }),
        );

        expect(deduplicated).toBe(false);
        expect(childJob.chainId).toBe(headJob.chainId);
        expect(childJob.id).not.toBe(headJob.id);
        expect(childJob.blocked).toBe(false);
        expect(childJob.completedAt).toBeNull();
      },
    },
    {
      name: "continues distinct parents independently",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "root",
                chainTypeName: "root",
                input: null,
              },
            ],
          }),
        );

        const { job: existingContinuation } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "step",
              continueFromId: headJob.id,
              input: { value: "first" },
            },
          }),
        );

        // Continuing the root again is idempotent — returns the existing continuation.
        const duplicate = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "step",
              continueFromId: headJob.id,
              input: { value: "duplicate" },
            },
          }),
        );

        // Continuing the existing continuation extends the chain.
        const next = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "step",
              continueFromId: existingContinuation.id,
              input: { value: "new" },
            },
          }),
        );

        expect(duplicate.deduplicated).toBe(true);
        expect(duplicate.job.id).toBe(existingContinuation.id);
        expect(next.deduplicated).toBe(false);
        expect(next.job.chainId).toBe(headJob.chainId);
      },
    },
    {
      name: "caller-supplied id collision on createContinuationJob errors",
      run: async ({ stateAdapter, generateId }, expect) => {
        const sharedId = (generateId ?? (() => crypto.randomUUID()))();

        const [{ job: head1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "root1", chainTypeName: "root1", input: null }],
          }),
        );
        const [{ job: head2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [{ typeName: "root2", chainTypeName: "root2", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "child",
              id: sharedId,
              continueFromId: head1.id,
              input: null,
            },
          }),
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createContinuationJob({
              txCtx,
              job: {
                typeName: "child",
                id: sharedId,
                continueFromId: head2.id,
                input: null,
              },
            }),
          ),
        ).rejects.toThrow();
      },
    },
  ],
};
