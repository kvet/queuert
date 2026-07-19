import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const listJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "listJobs",
  cases: [
    {
      name: "listJobs returns empty page when no jobs exist",
      run: async ({ stateAdapter }, expect) => {
        const result = await stateAdapter.listJobs({
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toEqual([]);
        expect(result.nextCursor).toBeNull();
      },
    },
    {
      name: "listJobs returns all jobs across chains",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "chain-type",
                chainTypeName: "chain-type",
                input: { step: 1 },
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "chain-step2",
              continueFromId: root.id,
              input: { step: 2 },
            },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "other-type",
                chainTypeName: "other-type",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listJobs({
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(3);
      },
    },
    {
      name: "listJobs filters by chainId",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "chain-type",
                chainTypeName: "chain-type",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "chain-step2",
              continueFromId: root.id,
              input: null,
            },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "other-type",
                chainTypeName: "other-type",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listJobs({
          orderBy: "createdAt",
          chainId: [root.chainId],
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        for (const job of result.items) {
          expect(job.chainId).toBe(root.chainId);
        }
      },
    },
    {
      name: "listJobs filters by status completed",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "test-type",
                chainTypeName: "test-type",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "test-type",
                chainTypeName: "test-type",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: ["test-type"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: job.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );

        const result = await stateAdapter.listJobs({
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(job.id);
      },
    },
    {
      name: "listJobs filters by status pending",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "pending-type",
                chainTypeName: "pending-type",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "pending-type",
                chainTypeName: "pending-type",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["pending-type"],
          }),
        );

        const result = await stateAdapter.listJobs({
          orderBy: "scheduledAt",
          status: "pending",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].completedAt).toBeNull();
        expect(result.items[0].attemptAt).toBeNull();
      },
    },
    {
      name: "listJobs filters by status running",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "running-type",
                chainTypeName: "running-type",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "running-type",
                chainTypeName: "running-type",
                input: null,
              },
            ],
          }),
        );
        const { job: acquiredJob } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["running-type"],
          }),
        );

        const result = await stateAdapter.listJobs({
          orderBy: "attemptAt",
          status: "running",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(acquiredJob!.id);
        expect(result.items[0].attemptAt).not.toBeNull();
      },
    },
    {
      name: "listJobs filters pending jobs by blocked",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocker-filter",
                chainTypeName: "blocker-filter",
                input: null,
              },
            ],
          }),
        );
        const [{ job: unblockedJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocked-filter",
                chainTypeName: "blocked-filter",
                input: { kind: "unblocked" },
              },
            ],
          }),
        );
        const [{ job: blockedJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "blocked-filter",
                chainTypeName: "blocked-filter",
                input: { kind: "blocked" },
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        const blockedResult = await stateAdapter.listJobs({
          orderBy: "scheduledAt",
          status: "pending",
          blocked: true,
          typeName: ["blocked-filter"],
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(blockedResult.items).toHaveLength(1);
        expect(blockedResult.items[0].id).toBe(blockedJob.id);
        expect(blockedResult.items[0].blocked).toBe(true);

        const unblockedResult = await stateAdapter.listJobs({
          orderBy: "scheduledAt",
          status: "pending",
          blocked: false,
          typeName: ["blocked-filter"],
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(unblockedResult.items).toHaveLength(1);
        expect(unblockedResult.items[0].id).toBe(unblockedJob.id);
        expect(unblockedResult.items[0].blocked).toBe(false);
      },
    },
    {
      name: "listJobs filters completed jobs by continued",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: job1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "continued-filter",
                chainTypeName: "continued-filter",
                input: null,
              },
            ],
          }),
        );
        const [{ job: job2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "continued-filter",
                chainTypeName: "continued-filter",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["continued-filter"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["continued-filter"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: job1.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );

        const { job: continuation } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "next-step",
              continueFromId: job2.id,
              input: null,
            },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: job2.id,
            workerId: "worker-1",
            outcome: { continuedToId: continuation.id },
          }),
        );

        const continuedResult = await stateAdapter.listJobs({
          orderBy: "completedAt",
          status: "completed",
          continued: true,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(continuedResult.items).toHaveLength(1);
        expect(continuedResult.items[0].id).toBe(job2.id);
        expect(continuedResult.items[0].continuedToId).not.toBeNull();

        const notContinuedResult = await stateAdapter.listJobs({
          orderBy: "completedAt",
          status: "completed",
          continued: false,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(notContinuedResult.items).toHaveLength(1);
        expect(notContinuedResult.items[0].id).toBe(job1.id);
        expect(notContinuedResult.items[0].continuedToId).toBeNull();
      },
    },
    {
      name: "listJobs sorts completed jobs by completedAt when orderBy is completedAt",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(5);
        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["type-b"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: jobB.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["type-a"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: jobA.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );

        const byCreatedAt = await stateAdapter.listJobs({
          status: "completed",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCreatedAt.items[0].id).toBe(jobB.id);
        expect(byCreatedAt.items[1].id).toBe(jobA.id);

        const byCompletedAt = await stateAdapter.listJobs({
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCompletedAt.items[0].id).toBe(jobA.id);
        expect(byCompletedAt.items[1].id).toBe(jobB.id);
      },
    },
    {
      name: "listJobs sorts running jobs by attemptAt when orderBy is attemptAt",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-a",
                chainTypeName: "run-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(5);
        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-b",
                chainTypeName: "run-b",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["run-b"] }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["run-a"] }),
        );

        const byCreatedAt = await stateAdapter.listJobs({
          status: "running",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCreatedAt.items[0].id).toBe(jobB.id);
        expect(byCreatedAt.items[1].id).toBe(jobA.id);

        const byAttemptAt = await stateAdapter.listJobs({
          status: "running",
          orderBy: "attemptAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byAttemptAt.items[0].id).toBe(jobA.id);
        expect(byAttemptAt.items[1].id).toBe(jobB.id);
      },
    },
    {
      name: "listJobs sorts pending jobs by scheduledAt when orderBy is scheduledAt",
      run: async ({ stateAdapter }, expect) => {
        const future1 = new Date(Date.now() + 60_000);
        const future2 = new Date(Date.now() + 120_000);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "sched-a",
                chainTypeName: "sched-a",
                input: null,
                schedule: { at: future2 },
              },
            ],
          }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "sched-b",
                chainTypeName: "sched-b",
                input: null,
                schedule: { at: future1 },
              },
            ],
          }),
        );

        const byCreatedAt = await stateAdapter.listJobs({
          status: "pending",
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byCreatedAt.items[0].typeName).toBe("sched-b");
        expect(byCreatedAt.items[1].typeName).toBe("sched-a");

        const byScheduledAt = await stateAdapter.listJobs({
          status: "pending",
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(byScheduledAt.items[0].typeName).toBe("sched-a");
        expect(byScheduledAt.items[1].typeName).toBe("sched-b");
      },
    },
    {
      name: "listJobs paginates correctly with completedAt ordering",
      run: async ({ stateAdapter }, expect) => {
        const jobIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: `page-type-${i}`,
                  chainTypeName: `page-type-${i}`,
                  input: null,
                },
              ],
            }),
          );
          jobIds.push(job.id);
        }

        for (const [i, id] of jobIds.entries()) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.startJobAttempt({
              txCtx,
              workerId: "w1",
              typeNames: [`page-type-${i}`],
            }),
          );
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.finishJobAttempt({
              txCtx,
              jobId: id,
              workerId: "w1",
              outcome: { output: null },
            }),
          );
          await sleep(5);
        }

        const page1 = await stateAdapter.listJobs({
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listJobs({
          status: "completed",
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(1);
        expect(page2.nextCursor).toBeNull();

        const allIds = [...page1.items.map((j) => j.id), ...page2.items.map((j) => j.id)];
        expect(new Set(allIds).size).toBe(3);
      },
    },
    {
      name: "listJobs filters by typeName",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listJobs({
          orderBy: "createdAt",
          typeName: ["type-a"],
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].typeName).toBe("type-a");
      },
    },
    {
      name: "listJobs filters by chainTypeName",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "root-a",
                chainTypeName: "root-a",
                input: null,
              },
            ],
          }),
        );
        const [{ job: rootB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "root-b",
                chainTypeName: "root-b",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "child-b",
              continueFromId: rootB.id,
              input: null,
            },
          }),
        );

        const result = await stateAdapter.listJobs({
          orderBy: "createdAt",
          chainTypeName: ["root-b"],
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        for (const job of result.items) {
          expect(job.chainTypeName).toBe("root-b");
        }
      },
    },
    {
      name: "listJobs filters by id matching job ID",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: job1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listJobs({
          orderBy: "createdAt",
          jobId: [job1.id],
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].id).toBe(job1.id);
      },
    },
    {
      name: "listJobs paginates with cursor",
      run: async ({ stateAdapter }, expect) => {
        for (let i = 0; i < 4; i++) {
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "paginate-type",
                  chainTypeName: "paginate-type",
                  input: { i },
                },
              ],
            }),
          );
        }

        const page1 = await stateAdapter.listJobs({
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2 },
        });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await stateAdapter.listJobs({
          orderBy: "createdAt",
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).toBeNull();

        const allIds = [...page1.items.map((j) => j.id), ...page2.items.map((j) => j.id)];
        expect(new Set(allIds).size).toBe(4);
      },
    },
    {
      name: "listJobs sorts asc when orderDirection is asc",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: job1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(5);
        const [{ job: job2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listJobs({
          orderBy: "createdAt",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(2);
        expect(result.items[0].id).toBe(job1.id);
        expect(result.items[1].id).toBe(job2.id);
      },
    },
    {
      name: "listJobs filters by from/to date range",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-a",
                chainTypeName: "type-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(50);
        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "type-b",
                chainTypeName: "type-b",
                input: null,
              },
            ],
          }),
        );
        const midpoint = new Date((jobA.createdAt.getTime() + jobB.createdAt.getTime()) / 2);

        const after = await stateAdapter.listJobs({
          orderBy: "createdAt",
          from: midpoint,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(after.items).toHaveLength(1);
        expect(after.items[0].typeName).toBe("type-b");

        const before = await stateAdapter.listJobs({
          orderBy: "createdAt",
          to: midpoint,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(before.items).toHaveLength(1);
        expect(before.items[0].typeName).toBe("type-a");
      },
    },
    {
      name: "listJobs filters pending by chainTypeName",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "target-chain-type",
                chainTypeName: "target-chain-type",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "other-chain-type",
                chainTypeName: "other-chain-type",
                input: null,
              },
            ],
          }),
        );

        const result = await stateAdapter.listJobs({
          status: "pending",
          chainTypeName: ["target-chain-type"],
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].chainTypeName).toBe("target-chain-type");
      },
    },
    {
      name: "listJobs filters pending by from/to date range",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "pending-range-a",
                chainTypeName: "pending-range-a",
                input: null,
              },
            ],
          }),
        );
        await sleep(50);
        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "pending-range-b",
                chainTypeName: "pending-range-b",
                input: null,
              },
            ],
          }),
        );
        const midpoint = new Date((jobA.createdAt.getTime() + jobB.createdAt.getTime()) / 2);

        const after = await stateAdapter.listJobs({
          status: "pending",
          from: midpoint,
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(after.items).toHaveLength(1);
        expect(after.items[0].typeName).toBe("pending-range-b");

        const before = await stateAdapter.listJobs({
          status: "pending",
          to: midpoint,
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(before.items).toHaveLength(1);
        expect(before.items[0].typeName).toBe("pending-range-a");
      },
    },
    {
      name: "listJobs filters pending by typeName and blocked",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "combo-blocker",
                chainTypeName: "combo-blocker",
                input: null,
              },
            ],
          }),
        );
        const [{ job: unblockedJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "combo-type",
                chainTypeName: "combo-type",
                input: { kind: "unblocked" },
              },
            ],
          }),
        );
        const [{ job: blockedJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "combo-type",
                chainTypeName: "combo-type",
                input: { kind: "blocked" },
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        const blockedResult = await stateAdapter.listJobs({
          status: "pending",
          typeName: ["combo-type"],
          blocked: true,
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(blockedResult.items).toHaveLength(1);
        expect(blockedResult.items[0].id).toBe(blockedJob.id);

        const unblockedResult = await stateAdapter.listJobs({
          status: "pending",
          typeName: ["combo-type"],
          blocked: false,
          orderBy: "scheduledAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(unblockedResult.items).toHaveLength(1);
        expect(unblockedResult.items[0].id).toBe(unblockedJob.id);
      },
    },
    {
      name: "listJobs filters running by typeName",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-filter-a",
                chainTypeName: "run-filter-a",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-filter-b",
                chainTypeName: "run-filter-b",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["run-filter-a"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["run-filter-b"],
          }),
        );

        const result = await stateAdapter.listJobs({
          status: "running",
          typeName: ["run-filter-a"],
          orderBy: "attemptAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].typeName).toBe("run-filter-a");
      },
    },
    {
      name: "listJobs filters running by chainTypeName",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-chain-a",
                chainTypeName: "run-chain-a",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-chain-b",
                chainTypeName: "run-chain-b",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["run-chain-a"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["run-chain-b"],
          }),
        );

        const result = await stateAdapter.listJobs({
          status: "running",
          chainTypeName: ["run-chain-a"],
          orderBy: "attemptAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].chainTypeName).toBe("run-chain-a");
      },
    },
    {
      name: "listJobs sorts running by attemptUntil",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-until-a",
                chainTypeName: "run-until-a",
                input: null,
              },
            ],
          }),
        );
        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "run-until-b",
                chainTypeName: "run-until-b",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["run-until-a"],
          }),
        );
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["run-until-b"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: jobA.id,
            workerId: "worker-1",
            timeoutMs: 5_000,
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.extendJobAttempt({
            txCtx,
            jobId: jobB.id,
            workerId: "worker-1",
            timeoutMs: 60_000,
          }),
        );

        const desc = await stateAdapter.listJobs({
          status: "running",
          orderBy: "attemptUntil",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(desc.items[0].id).toBe(jobB.id);
        expect(desc.items[1].id).toBe(jobA.id);

        const asc = await stateAdapter.listJobs({
          status: "running",
          orderBy: "attemptUntil",
          orderDirection: "asc",
          page: { limit: 10 },
        });
        expect(asc.items[0].id).toBe(jobA.id);
        expect(asc.items[1].id).toBe(jobB.id);
      },
    },
    {
      name: "listJobs filters completed by typeName",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "comp-filter-a",
                chainTypeName: "comp-filter-a",
                input: null,
              },
            ],
          }),
        );
        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "comp-filter-b",
                chainTypeName: "comp-filter-b",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["comp-filter-a"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: jobA.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["comp-filter-b"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: jobB.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );

        const result = await stateAdapter.listJobs({
          status: "completed",
          typeName: ["comp-filter-a"],
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].typeName).toBe("comp-filter-a");
      },
    },
    {
      name: "listJobs filters completed by chainTypeName",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: jobA }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "comp-chain-a",
                chainTypeName: "comp-chain-a",
                input: null,
              },
            ],
          }),
        );
        const [{ job: jobB }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "comp-chain-b",
                chainTypeName: "comp-chain-b",
                input: null,
              },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["comp-chain-a"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: jobA.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["comp-chain-b"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: jobB.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );

        const result = await stateAdapter.listJobs({
          status: "completed",
          chainTypeName: ["comp-chain-a"],
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].chainTypeName).toBe("comp-chain-a");
      },
    },
    {
      name: "listJobs filters completed by typeName and continued",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: job1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "tc-type",
                chainTypeName: "tc-type",
                input: null,
              },
            ],
          }),
        );
        const [{ job: job2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "tc-type",
                chainTypeName: "tc-type",
                input: null,
              },
            ],
          }),
        );
        const [{ job: job3 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "other",
                chainTypeName: "other",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["tc-type"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["tc-type"],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["other"],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: job1.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: job3.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );

        const { job: continuation } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "tc-next",
              continueFromId: job2.id,
              input: null,
            },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: job2.id,
            workerId: "worker-1",
            outcome: { continuedToId: continuation.id },
          }),
        );

        const continuedResult = await stateAdapter.listJobs({
          status: "completed",
          typeName: ["tc-type"],
          continued: true,
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(continuedResult.items).toHaveLength(1);
        expect(continuedResult.items[0].id).toBe(job2.id);

        const notContinuedResult = await stateAdapter.listJobs({
          status: "completed",
          typeName: ["tc-type"],
          continued: false,
          orderBy: "completedAt",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(notContinuedResult.items).toHaveLength(1);
        expect(notContinuedResult.items[0].id).toBe(job1.id);
      },
    },
    {
      name: "listJobs returns continuation jobs with correct status in multi-job chains",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: head }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "multi-head",
                chainTypeName: "multi-head",
                input: null,
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["multi-head"] }),
        );
        const { job: tail } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: { typeName: "multi-tail", continueFromId: head.id, input: null },
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: head.id,
            workerId: "w1",
            outcome: { continuedToId: tail.id },
          }),
        );

        // Head is completed (continued), tail is pending
        const completed = await stateAdapter.listJobs({
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(completed.items).toHaveLength(1);
        expect(completed.items[0].id).toBe(head.id);
        expect(completed.items[0].continuedToId).toBe(tail.id);

        const pending = await stateAdapter.listJobs({
          orderBy: "createdAt",
          status: "pending",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(pending.items.some((j) => j.id === tail.id)).toBe(true);

        // Complete the tail and verify both jobs appear correctly
        await sleep(5);
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.startJobAttempt({ txCtx, workerId: "w1", typeNames: ["multi-tail"] }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: tail.id,
            workerId: "w1",
            outcome: { output: null },
          }),
        );

        const allCompleted = await stateAdapter.listJobs({
          orderBy: "completedAt",
          status: "completed",
          orderDirection: "desc",
          page: { limit: 10 },
        });
        expect(allCompleted.items).toHaveLength(2);
        // tail completed last, so it should be first in desc order
        expect(allCompleted.items[0].id).toBe(tail.id);
        expect(allCompleted.items[1].id).toBe(head.id);
      },
    },
    {
      name: "non-transactional listJobs does not observe an uncommitted insert",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
        let release: (() => void) | undefined;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        let signalTxReady: (() => void) | undefined;
        const txReady = new Promise<void>((r) => {
          signalTxReady = r;
        });

        const txPromise = stateAdapter
          .withTransaction(async (txCtx) => {
            await stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "iso-list",
                  chainTypeName: "iso-list",
                  input: null,
                },
              ],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const listPromise = stateAdapter.listJobs({
          orderBy: "createdAt",
          typeName: ["iso-list"],
          orderDirection: "desc",
          page: { limit: 10 },
        });
        release!();
        await txPromise;

        const { items } = await listPromise;
        expect(items).toHaveLength(0);
      },
    },
  ],
};
