import { ChainNotFoundError } from "../../errors.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

// TODO!!!: Add job blockers is confusing. Should be setJobBlockers
export const addJobsBlockersGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "addJobsBlockers",
  cases: [
    {
      name: "adds blockers and reports the blocker chain as incomplete",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        expect(result.completedAt).toBeNull();
        expect(result.attemptAt).toBeNull();
        expect(result.blocked).toBe(true);
        expect(result.blockers).toHaveLength(1);
        expect(result.blockers[0].id).toBe(blockerChain.head.chainId);
        expect(result.blockers[0].completedAt).toBeNull();
      },
    },
    {
      name: "reports a completed blocker chain and leaves the job unblocked",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: blockerChain.head.id, output: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        expect(result.completedAt).toBeNull();
        expect(result.attemptAt).toBeNull();
        expect(result.blocked).toBe(false);
        expect(result.blockers).toHaveLength(1);
        expect(result.blockers[0].completedAt).toBeInstanceOf(Date);
      },
    },
    {
      name: "throws ChainNotFoundError for an unknown blocker chain",
      run: async ({ stateAdapter }, expect) => {
        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const missingChainId =
          mainChain.head.chainId.slice(0, -1) + (mainChain.head.chainId.endsWith("0") ? "1" : "0");

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [missingChainId] }],
            }),
          ),
        ).rejects.toThrow(ChainNotFoundError);

        const [unchanged] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(unchanged!.blocked).toBe(false);
        expect(await stateAdapter.getJobBlockers({ jobId: mainChain.head.id })).toHaveLength(0);
      },
    },
    {
      name: "adds blockers to multiple jobs in a single batch",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain1, blockerChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "blocker", input: null },
              { typeName: "blocker", input: null },
            ],
          }),
        );

        const [mainChain1, mainChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "main", input: null },
              { typeName: "main", input: null },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain1.head.id, blockedByChainIds: [blockerChain1.head.chainId] },
              {
                jobId: mainChain2.head.id,
                blockedByChainIds: [blockerChain1.head.chainId, blockerChain2.head.chainId],
              },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0].id).toBe(mainChain1.head.id);
        expect(results[0].completedAt).toBeNull();
        expect(results[0].attemptAt).toBeNull();
        expect(results[0].blocked).toBe(true);
        expect(results[0].blockers.map((blocker) => blocker.id)).toEqual([
          blockerChain1.head.chainId,
        ]);

        expect(results[1].id).toBe(mainChain2.head.id);
        expect(results[1].completedAt).toBeNull();
        expect(results[1].attemptAt).toBeNull();
        expect(results[1].blocked).toBe(true);
        expect(results[1].blockers.map((blocker) => blocker.id)).toEqual([
          blockerChain1.head.chainId,
          blockerChain2.head.chainId,
        ]);
      },
    },
    {
      name: "batch handles mix of blocked and unblocked jobs",
      run: async ({ stateAdapter }, expect) => {
        const [completedBlockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "test",
            jobs: [{ jobId: completedBlockerChain.head.id, output: null }],
          }),
        );

        const [incompleteBlockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [mainChain1, mainChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "main", input: null },
              { typeName: "main", input: null },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain1.head.id,
                blockedByChainIds: [completedBlockerChain.head.chainId],
              },
              {
                jobId: mainChain2.head.id,
                blockedByChainIds: [incompleteBlockerChain.head.chainId],
              },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0].id).toBe(mainChain1.head.id);
        expect(results[0].completedAt).toBeNull();
        expect(results[0].attemptAt).toBeNull();
        expect(results[0].blocked).toBe(false);
        expect(results[0].blockers[0].completedAt).toBeInstanceOf(Date);

        expect(results[1].id).toBe(mainChain2.head.id);
        expect(results[1].completedAt).toBeNull();
        expect(results[1].attemptAt).toBeNull();
        expect(results[1].blocked).toBe(true);
        expect(results[1].blockers[0].id).toBe(incompleteBlockerChain.head.chainId);
        expect(results[1].blockers[0].completedAt).toBeNull();
      },
    },
    {
      name: "returns the blocker chain's own trace context",
      run: async ({ stateAdapter }, expect) => {
        const blockerChainTraceContext = "00-test123-chain456-01";
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blocker",
                input: null,
                chainTraceContext: blockerChainTraceContext,
              },
            ],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        expect(result.blockers).toHaveLength(1);
        expect(result.blockers[0].traceContext).toEqual(blockerChainTraceContext);
      },
    },
    {
      name: "returns blockers in the same order as blockedByChainIds",
      run: async ({ stateAdapter }, expect) => {
        const chainTraceA = "00-aaa111-chain-aaa-01";
        const chainTraceB = "00-bbb222-chain-bbb-01";

        const [blockerChainA] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blockerA",
                input: null,
                chainTraceContext: chainTraceA,
              },
            ],
          }),
        );

        const [blockerChainB] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "blockerB",
                input: null,
                chainTraceContext: chainTraceB,
              },
            ],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [blockerChainA.head.chainId, blockerChainB.head.chainId],
              },
            ],
          }),
        );

        expect(result.blockers).toHaveLength(2);
        expect(result.blockers[0].traceContext).toEqual(chainTraceA);
        expect(result.blockers[1].traceContext).toEqual(chainTraceB);
      },
    },
    {
      name: "rejects a continuation job id as a blocker chain id",
      run: async ({ stateAdapter }, expect) => {
        const [headChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({ txCtx, jobs: [{ typeName: "blocker", input: null }] }),
        );
        const [{ continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.continueJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null, continueFromId: headChain.head.id }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({ txCtx, jobs: [{ typeName: "main", input: null }] }),
        );

        // Only a head row identifies a chain, so a continuation's id is not a chain id.
        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [continuation.id] }],
            }),
          ),
        ).rejects.toThrow();

        const [after] = await stateAdapter.getJobs({ jobIds: [mainChain.head.id] });
        expect(after!.blocked).toBe(false);
        expect(await stateAdapter.getJobBlockers({ jobId: mainChain.head.id })).toHaveLength(0);
      },
    },
    {
      name: "duplicate blocker chain ids do not break addJobsBlockers",
      run: async ({ stateAdapter }, expect) => {
        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "blocker", input: null }],
          }),
        );

        const [mainChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "main", input: null }],
          }),
        );

        const [result] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              {
                jobId: mainChain.head.id,
                blockedByChainIds: [
                  blockerChain.head.chainId,
                  blockerChain.head.chainId,
                  blockerChain.head.chainId,
                ],
              },
            ],
          }),
        );

        expect(result.blocked).toBe(true);
        expect(result.blockers.map((blocker) => blocker.id)).toEqual([
          blockerChain.head.chainId,
          blockerChain.head.chainId,
          blockerChain.head.chainId,
        ]);
      },
    },
  ],
};
