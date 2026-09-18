import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const continueJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "continueJobs",
  cases: [
    {
      name: "inherits chainId from the parent and assigns a new job id",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root-job", input: null }],
          }),
        );

        const [completedResult] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            completedBy: "worker-1",
            jobs: [{ typeName: "child-job", continueFromId: headChain.head.id, input: null }],
          }),
        );
        const childJob = completedResult!.continuation;

        expect(childJob.chainId).toBe(headChain.head.chainId);
        expect(childJob.id).not.toBe(headChain.head.id);
        expect(completedResult!.continuedToId).toBe(childJob.id);
        expect(completedResult!.status).toBe("completed");
        expect(childJob.status).toBe("pending");
        expect(completedResult!.chain.status).toBe("running");
        expect(completedResult!.completedAt).not.toBeNull();
        expect(completedResult!.completedBy).toBe("worker-1");
      },
    },
    {
      name: "round-trips a scalar JSON input on the continuation",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root-scalar", input: null }],
          }),
        );

        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              { typeName: "child-scalar", continueFromId: headChain.head.id, input: "bare string" },
            ],
          }),
        );
        const { continuation } = continued!;

        const [stored] = await stateAdapter.getJobs({ jobIds: [continuation.id] });
        expect(stored!.input).toBe("bare string");
      },
    },
    {
      name: "completes the parent and links it to the continuation",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["root"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: headChain.head.id,
            workerId: "worker-1",
            timeoutMs: 10_000,
          }),
        );

        const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [{ typeName: "child", continueFromId: headChain.head.id, input: null }],
          }),
        );
        const { continuation } = continued!;

        const [headAfter] = await stateAdapter.getJobs({ jobIds: [headChain.head.id] });
        expect(headAfter!.continuedToId).toBe(continuation.id);
        expect(headAfter!.completedAt).not.toBeNull();
        expect(headAfter!.completedBy).toBe(null);
        expect(headAfter!.attemptAt).toBe(null);
        expect(headAfter!.attemptBy).toBe(null);
        expect(headAfter!.attemptUntil).toBe(null);
      },
    },
    {
      name: "reports an undefined result for a non-existent parent",
      run: async ({ stateAdapter }, expect) => {
        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "child",
                continueFromId: "00000000-0000-0000-0000-000000000000",
                input: null,
              },
            ],
          }),
        );

        expect(results).toHaveLength(1);
        expect(results[0]).toBeUndefined();
      },
    },
    {
      name: "reports an undefined result for an already-completed parent",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "completed-parent", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: headChain.head.id, output: { done: true } }],
          }),
        );

        const [completedParent] = await stateAdapter.getJobs({ jobIds: [headChain.head.id] });
        expect(completedParent!.completedAt).not.toBeNull();

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "child-of-completed",
                continueFromId: headChain.head.id,
                input: null,
              },
            ],
          }),
        );

        expect(results).toHaveLength(1);
        expect(results[0]).toBeUndefined();

        // Nothing was written for the entry that resolved to nothing.
        const chainJobs = await stateAdapter.listChainJobs({
          chainId: headChain.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(chainJobs.items).toHaveLength(1);
      },
    },
    {
      name: "reports an undefined result for a second continuation from the same parent",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root", input: null }],
          }),
        );

        const [continuedC1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "child",
                continueFromId: headChain.head.id,
                input: { v: 1 },
              },
            ],
          }),
        );
        const { continuation: c1 } = continuedC1!;

        // The first continuation completed the parent, so the second finds nothing to
        // continue -- a hole, reported before the taken chain position can be hit.
        const [second] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "child",
                continueFromId: headChain.head.id,
                input: { v: 2 },
              },
            ],
          }),
        );

        expect(second).toBeUndefined();

        const [stored] = await stateAdapter.getJobs({ jobIds: [c1.id] });
        expect(stored!.input).toEqual({ v: 1 });
      },
    },
    {
      name: "lets only one of two concurrent continuations take a chain position",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-root", input: null }],
          }),
        );

        const results = await Promise.allSettled(
          ["tx1", "tx2"].map(async (from) =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.continueJobs({
                txCtx,
                jobs: [
                  {
                    typeName: "chain-step2",
                    continueFromId: headChain.head.id,
                    input: { from },
                  },
                ],
              }),
            ),
          ),
        );

        // Exactly one takes the position. The loser either trips the chain-position
        // constraint (both saw an open parent) or finds the parent already completed
        // and reports a hole -- which of the two depends on how the engine serializes.
        const continued = results.filter(
          (result) => result.status === "fulfilled" && result.value[0] !== undefined,
        );
        expect(continued).toHaveLength(1);

        const chainJobs = await stateAdapter.listChainJobs({
          chainId: headChain.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(chainJobs.items).toHaveLength(2);
      },
    },
    {
      name: "continues several chains in one batch, in input order",
      run: async ({ stateAdapter }, expect) => {
        const [chainA, chainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "batch-root", input: { n: 1 } },
              { typeName: "batch-root", input: { n: 2 } },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              { typeName: "batch-step", continueFromId: chainA.head.id, input: { n: 1 } },
              { typeName: "batch-step", continueFromId: chainB.head.id, input: { n: 2 } },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results.map((r) => r!.id)).toEqual([chainA.head.id, chainB.head.id]);
        expect(results[0]!.continuation.chainId).toBe(chainA.head.chainId);
        expect(results[1]!.continuation.chainId).toBe(chainB.head.chainId);
        expect(results[0]!.continuedToId).toBe(results[0]!.continuation.id);
        expect(results[1]!.continuedToId).toBe(results[1]!.continuation.id);
        expect(results[0]!.completedAt).toBeInstanceOf(Date);
        expect(results[1]!.completedAt).toBeInstanceOf(Date);
      },
    },
    {
      name: "rejects a batch that continues the same job twice",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "batch-dup-root", input: null }],
          }),
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                { typeName: "batch-dup-step", continueFromId: stateChain.head.id, input: { n: 1 } },
                { typeName: "batch-dup-step", continueFromId: stateChain.head.id, input: { n: 2 } },
              ],
            }),
          ),
        ).rejects.toThrow();
      },
    },
    {
      name: "reports an undefined result for a batch entry continuing a job the same batch creates",
      run: async ({ stateAdapter, generateId }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "batch-chain-root", input: null }],
          }),
        );

        // A fresh id that no row holds yet: entry 2 can only continue it if the
        // batch's own insert were visible to later entries, which it must not be.
        const successorId = (generateId ?? (() => crypto.randomUUID()))();

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "batch-chain-step",
                id: successorId,
                continueFromId: stateChain.head.id,
                input: { n: 1 },
              },
              { typeName: "batch-chain-step", continueFromId: successorId, input: { n: 2 } },
            ],
          }),
        );

        expect(results[0]).toBeDefined();
        expect(results[1]).toBeUndefined();

        // Entry 1 stands on its own: the hole is entry 2's alone, and it wrote nothing.
        const [headAfter] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(headAfter!.continuedToId).toBe(successorId);

        const chainJobs = await stateAdapter.listChainJobs({
          chainId: stateChain.id,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(chainJobs.items).toHaveLength(2);
      },
    },
    {
      name: "extends a chain across multiple sequential continuations",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "t", input: null }],
          }),
        );
        expect(headChain.head.id).toBe(headChain.head.chainId);

        const [continuedCont1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "t2",
                continueFromId: headChain.head.id,
                input: null,
              },
            ],
          }),
        );
        const { continuation: cont1 } = continuedCont1!;
        expect(cont1.chainId).toBe(headChain.head.chainId);

        const [continuedCont2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "t3",
                continueFromId: cont1.id,
                input: null,
              },
            ],
          }),
        );
        const { continuation: cont2 } = continuedCont2!;
        expect(cont2.chainId).toBe(headChain.head.chainId);
        expect(cont2.id).not.toBe(cont1.id);
      },
    },
    {
      name: "continues distinct parents independently",
      run: async ({ stateAdapter }, expect) => {
        const [rootChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root", input: null }],
          }),
        );

        const [continuedExistingContinuation] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "step",
                continueFromId: rootChain.head.id,
                input: { value: "first" },
              },
            ],
          }),
        );
        const { continuation: existingContinuation } = continuedExistingContinuation!;

        // The root is completed, so continuing it again reports a hole.
        const [duplicate] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "step",
                continueFromId: rootChain.head.id,
                input: { value: "duplicate" },
              },
            ],
          }),
        );

        expect(duplicate).toBeUndefined();

        // Continuing the existing continuation extends the chain.
        const [continuedNext] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "step",
                continueFromId: existingContinuation.id,
                input: { value: "new" },
              },
            ],
          }),
        );
        const { continuation: next } = continuedNext!;

        expect(next.chainId).toBe(rootChain.head.chainId);
      },
    },
    {
      name: "caller-supplied id collision on continueJobs errors",
      run: async ({ stateAdapter, generateId }, expect) => {
        const sharedId = (generateId ?? (() => crypto.randomUUID()))();

        const [chain1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root1", input: null }],
          }),
        );
        const [chain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root2", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "child",
                id: sharedId,
                continueFromId: chain1.head.id,
                input: null,
              },
            ],
          }),
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: "child",
                  id: sharedId,
                  continueFromId: chain2.head.id,
                  input: null,
                },
              ],
            }),
          ),
        ).rejects.toThrow();
      },
    },
  ],
};
