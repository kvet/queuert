import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const continueJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "continueJobs",
  cases: [
    {
      name: "inherits chainId from the parent and assigns a new job id",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root-job", input: null }],
          }),
        );

        const [{ job: completedHead, continuation: childJob }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: "child-job",
                  continueFromId: headJob.id,
                  input: null,
                  completedBy: "worker-1",
                },
              ],
            }),
        );

        expect(childJob.chainId).toBe(headJob.chainId);
        expect(childJob.id).not.toBe(headJob.id);
        expect(completedHead.continuedToId).toBe(childJob.id);
        expect(completedHead.completedAt).not.toBeNull();
        expect(completedHead.completedBy).toBe("worker-1");
      },
    },
    {
      name: "round-trips a scalar JSON input on the continuation",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root-scalar", input: null }],
          }),
        );

        const [{ continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [{ typeName: "child-scalar", continueFromId: headJob.id, input: "bare string" }],
          }),
        );

        const [stored] = await stateAdapter.getJobs({ jobIds: [continuation.id] });
        expect(stored!.input).toBe("bare string");
      },
    },
    {
      name: "completes the parent and links it to the continuation",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
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
            jobId: headJob.id,
            workerId: "worker-1",
            timeoutMs: 10_000,
          }),
        );

        const [{ continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [{ typeName: "child", continueFromId: headJob.id, input: null }],
          }),
        );

        const [headAfter] = await stateAdapter.getJobs({ jobIds: [headJob.id] });
        expect(headAfter!.continuedToId).toBe(continuation.id);
        expect(headAfter!.completedAt).not.toBeNull();
        expect(headAfter!.completedBy).toBe(null);
        expect(headAfter!.attemptAt).toBe(null);
        expect(headAfter!.attemptBy).toBe(null);
        expect(headAfter!.attemptUntil).toBe(null);
      },
    },
    {
      name: "rejects continuation referencing a non-existent parent",
      run: async ({ stateAdapter }, expect) => {
        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
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
          ),
        ).rejects.toThrow();
      },
    },
    {
      name: "rejects continuation from an already-completed parent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "completed-parent", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            jobs: [{ jobId: headJob.id, completedBy: null, output: { done: true } }],
          }),
        );

        const [completedParent] = await stateAdapter.getJobs({ jobIds: [headJob.id] });
        expect(completedParent!.completedAt).not.toBeNull();

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: "child-of-completed",
                  continueFromId: headJob.id,
                  input: null,
                },
              ],
            }),
          ),
        ).rejects.toThrow();
      },
    },
    {
      name: "rejects a second continuation from the same parent",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root", input: null }],
          }),
        );

        const [{ continuation: c1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "child",
                continueFromId: headJob.id,
                input: { v: 1 },
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
                  continueFromId: headJob.id,
                  input: { v: 2 },
                },
              ],
            }),
          ),
        ).rejects.toThrow();

        const [stored] = await stateAdapter.getJobs({ jobIds: [c1.id] });
        expect(stored!.input).toEqual({ v: 1 });
      },
    },
    {
      name: "lets only one of two concurrent continuations take a chain position",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
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
                    continueFromId: headJob.id,
                    input: { from },
                  },
                ],
              }),
            ),
          ),
        );

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      },
    },
    {
      name: "continues several chains in one batch, in input order",
      run: async ({ stateAdapter }, expect) => {
        const heads = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "batch-root", input: { n: 1 } },
              { typeName: "batch-root", input: { n: 2 } },
            ],
          }),
        );
        const [headA, headB] = heads.map((h) => h.job);

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              { typeName: "batch-step", continueFromId: headA.id, input: { n: 1 } },
              { typeName: "batch-step", continueFromId: headB.id, input: { n: 2 } },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results.map((r) => r.job.id)).toEqual([headA.id, headB.id]);
        expect(results[0].continuation.chainId).toBe(headA.chainId);
        expect(results[1].continuation.chainId).toBe(headB.chainId);
        expect(results[0].job.continuedToId).toBe(results[0].continuation.id);
        expect(results[1].job.continuedToId).toBe(results[1].continuation.id);
        expect(results[0].job.completedAt).toBeInstanceOf(Date);
        expect(results[1].job.completedAt).toBeInstanceOf(Date);
      },
    },
    {
      name: "rejects a batch that continues the same job twice",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: head }] = await stateAdapter.withTransaction(async (txCtx) =>
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
                { typeName: "batch-dup-step", continueFromId: head.id, input: { n: 1 } },
                { typeName: "batch-dup-step", continueFromId: head.id, input: { n: 2 } },
              ],
            }),
          ),
        ).rejects.toThrow();
      },
    },
    {
      name: "rejects a batch entry that continues a job the same batch creates",
      run: async ({ stateAdapter, generateId }, expect) => {
        const [{ job: head }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "batch-chain-root", input: null }],
          }),
        );

        // A fresh id that no row holds yet: entry 2 can only continue it if the
        // batch's own insert were visible to later entries, which it must not be.
        const successorId = (generateId ?? (() => crypto.randomUUID()))();

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: "batch-chain-step",
                  id: successorId,
                  continueFromId: head.id,
                  input: { n: 1 },
                },
                { typeName: "batch-chain-step", continueFromId: successorId, input: { n: 2 } },
              ],
            }),
          ),
        ).rejects.toThrow();

        // The whole batch is discarded, so the head is untouched.
        const [headAfter] = await stateAdapter.getJobs({ jobIds: [head.id] });
        expect(headAfter!.completedAt).toBeNull();
        expect(headAfter!.continuedToId).toBeNull();
      },
    },
    {
      name: "extends a chain across multiple sequential continuations",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "t", input: null }],
          }),
        );
        expect(headJob.id).toBe(headJob.chainId);

        const [{ continuation: cont1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [
              {
                typeName: "t2",
                continueFromId: headJob.id,
                input: null,
              },
            ],
          }),
        );
        expect(cont1.chainId).toBe(headJob.chainId);

        const [{ continuation: cont2 }] = await stateAdapter.withTransaction(async (txCtx) =>
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
        expect(cont2.chainId).toBe(headJob.chainId);
        expect(cont2.id).not.toBe(cont1.id);
      },
    },
    {
      name: "continues distinct parents independently",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root", input: null }],
          }),
        );

        const [{ continuation: existingContinuation }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: "step",
                  continueFromId: headJob.id,
                  input: { value: "first" },
                },
              ],
            }),
        );

        // The root is completed and its chain position taken, so continuing it again fails.
        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: "step",
                  continueFromId: headJob.id,
                  input: { value: "duplicate" },
                },
              ],
            }),
          ),
        ).rejects.toThrow();

        // Continuing the existing continuation extends the chain.
        const [{ continuation: next }] = await stateAdapter.withTransaction(async (txCtx) =>
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

        expect(next.chainId).toBe(headJob.chainId);
      },
    },
    {
      name: "caller-supplied id collision on continueJobs errors",
      run: async ({ stateAdapter, generateId }, expect) => {
        const sharedId = (generateId ?? (() => crypto.randomUUID()))();

        const [{ job: head1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "root1", input: null }],
          }),
        );
        const [{ job: head2 }] = await stateAdapter.withTransaction(async (txCtx) =>
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
                continueFromId: head1.id,
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
                  continueFromId: head2.id,
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
