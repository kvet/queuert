import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const concurrencyGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "concurrency",
  cases: [
    {
      name: "parallel withTransaction calls all commit successfully",
      run: async ({ stateAdapter }, expect) => {
        const count = 5;
        const results = await Promise.all(
          Array.from({ length: count }, async (_, i) =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    typeName: "parallel-tx",
                    chainTypeName: "parallel-tx",
                    input: { index: i },
                  },
                ],
              }),
            ),
          ),
        );

        const ids = new Set(results.map(([r]) => r.job.id));
        expect(ids.size).toBe(count);

        for (const [{ job }] of results) {
          const fetched = await stateAdapter.getJob({ jobId: job.id });
          expect(fetched).toBeDefined();
        }
      },
    },
    {
      name: "parallel non-transactional reads all return correct results",
      run: async ({ stateAdapter }, expect) => {
        const count = 10;
        const created = await Promise.all(
          Array.from({ length: count }, async (_, i) =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    typeName: "parallel-read",
                    chainTypeName: "parallel-read",
                    input: { index: i },
                  },
                ],
              }),
            ),
          ),
        );

        const jobIds = created.map(([r]) => r.job.id);
        const fetched = await Promise.all(
          jobIds.map(async (id) => stateAdapter.getJob({ jobId: id })),
        );

        expect(fetched.every((job) => job !== undefined)).toBe(true);
        expect(new Set(fetched.map((job) => job!.id)).size).toBe(count);
      },
    },
    {
      name: "parallel withTransaction and non-transactional reads do not deadlock",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: seedJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "mixed-concurrency",
                chainTypeName: "mixed-concurrency",
                input: null,
              },
            ],
          }),
        );

        const txWork = Promise.all(
          Array.from({ length: 3 }, async (_, i) =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    typeName: "mixed-tx",
                    chainTypeName: "mixed-tx",
                    input: { index: i },
                  },
                ],
              }),
            ),
          ),
        );

        const readWork = Promise.all(
          Array.from({ length: 5 }, async () => stateAdapter.getJob({ jobId: seedJob.id })),
        );

        const [txResults, readResults] = await Promise.all([txWork, readWork]);
        expect(txResults).toHaveLength(3);
        expect(readResults.every((job) => job?.id === seedJob.id)).toBe(true);
      },
    },
    {
      name: "parallel acquireJob calls return distinct jobs (no double-dispatch)",
      run: async ({ stateAdapter }, expect) => {
        const count = 5;
        await Promise.all(
          Array.from({ length: count }, async (_, i) =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    typeName: "acquire-concurrency",
                    chainTypeName: "acquire-concurrency",
                    input: { index: i },
                  },
                ],
              }),
            ),
          ),
        );

        const results = await Promise.all(
          Array.from({ length: count }, async () =>
            stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.acquireJob({ txCtx, typeNames: ["acquire-concurrency"] }),
            ),
          ),
        );

        const acquiredJobs = results.filter((r) => r.job !== undefined);
        const acquiredIds = new Set(acquiredJobs.map((r) => r.job!.id));

        expect(acquiredJobs).toHaveLength(count);
        expect(acquiredIds.size).toBe(count);
      },
    },
    {
      name: "starting a chain blocked by a concurrently-completing chain does not strand it as blocked",
      run: async ({ stateAdapter }, expect) => {
        const count = 20;

        const blockerJobs = await Promise.all(
          Array.from({ length: count }, async (_, index) => {
            const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    typeName: "race-blocker",
                    chainTypeName: "race-blocker",
                    input: { index },
                  },
                ],
              }),
            );
            return job;
          }),
        );

        const startChainBlockedBy = async (
          blockerChainId: string,
          index: number,
        ): Promise<string> =>
          stateAdapter.withTransaction(async (txCtx) => {
            const [{ job: mainJob }] = await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "race-main",
                  chainTypeName: "race-main",
                  input: { index },
                },
              ],
            });
            const [{ job }] = await stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainJob.id, blockedByChainIds: [blockerChainId] }],
            });
            return job.id;
          });

        const completeBlockerChain = async (blockerJobId: string, chainId: string): Promise<void> =>
          stateAdapter.withTransaction(async (txCtx) => {
            await stateAdapter.completeJob({
              txCtx,
              jobId: blockerJobId,
              output: null,
              workerId: "race-test",
            });
            await stateAdapter.unblockJobs({ txCtx, blockedByChainId: chainId });
          });

        const mainJobIds = await Promise.all(
          blockerJobs.flatMap((blockerJob, i) => [
            startChainBlockedBy(blockerJob.chainId, i),
            completeBlockerChain(blockerJob.id, blockerJob.chainId).then(() => undefined),
          ]),
        ).then((results) => results.filter((id): id is string => id !== undefined));

        const finalStates = await Promise.all(
          mainJobIds.map(async (jobId) => stateAdapter.getJob({ jobId })),
        );

        const stranded = finalStates.filter((job) => job?.status === "blocked");
        expect(stranded).toHaveLength(0);
      },
    },
  ],
};
