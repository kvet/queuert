import { sleep } from "../../helpers/sleep.js";
import { type StateJob } from "../../state-adapter/state-adapter.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const createJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "createJobs",
  cases: [
    {
      name: "assigns chainId correctly for new jobs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "chain-test",
                input: null,
              },
            ],
          }),
        );

        expect(job.chainId).toBe(job.id);
      },
    },
    {
      name: "preserves provided chainId",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "root-job",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "root-job",
                input: null,
              },
            ],
          }),
        );

        const [{ job: childJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "child-job",
                chainId: rootJob.chainId,
                chainIndex: 1,
                chainTypeName: "root-job",
                input: null,
              },
            ],
          }),
        );

        expect(childJob.chainId).toBe(rootJob.chainId);
        expect(childJob.chainIndex).toBe(1);
      },
    },
    {
      name: "generates unique job IDs",
      run: async ({ stateAdapter }, expect) => {
        const jobs = await stateAdapter.withTransaction(async (txCtx) => {
          const results: StateJob[] = [];
          for (let i = 0; i < 10; i++) {
            const [{ job }] = await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "test-job",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "test-job",
                  input: { value: i },
                },
              ],
            });
            results.push(job);
          }
          return results;
        });

        const ids = jobs.map((j) => j.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      },
    },
    {
      name: "persists and retrieves jobs correctly",
      run: async ({ stateAdapter }, expect) => {
        const input = { nested: { value: 42 }, array: [1, 2, 3] };
        const [{ job: created }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "test-job",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "test-job",
                input,
              },
            ],
          }),
        );

        const retrieved = await stateAdapter.getJob({ jobId: created.id });

        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(created.id);
        expect(retrieved!.typeName).toBe("test-job");
        expect(retrieved!.input).toEqual(input);
        expect(retrieved!.status).toBe("pending");
      },
    },
    {
      name: "handles null values correctly",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "null-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "null-test",
                input: null,
              },
            ],
          }),
        );

        expect(job.input).toBeNull();
        expect(job.output).toBeNull();
        expect(job.completedAt).toBeNull();
        expect(job.completedBy).toBeNull();
        expect(job.lastAttemptError).toBeNull();
        expect(job.lastAttemptAt).toBeNull();
        expect(job.leasedBy).toBeNull();
        expect(job.leasedUntil).toBeNull();
        expect(job.deduplicationKey).toBeNull();
        expect(job.chainIndex).toBe(0);
      },
    },
    {
      name: "handles complex JSON input/output",
      run: async ({ stateAdapter }, expect) => {
        const complexInput = {
          string: "hello",
          number: 42,
          float: 3.14,
          boolean: true,
          null: null,
          array: [1, "two", { three: 3 }],
          nested: {
            deep: {
              value: "found",
            },
          },
          unicode: "日本語 🎉",
          empty: {},
          emptyArray: [],
        };

        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "json-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "json-test",
                input: complexInput,
              },
            ],
          }),
        );

        const retrieved = await stateAdapter.getJob({ jobId: job.id });
        expect(retrieved!.input).toEqual(complexInput);
      },
    },
    {
      name: "deduplicates jobs with same deduplication key",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: first }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "dedup-test",
                input: { value: 1 },
                deduplication: { key: "same-key" },
              },
            ],
          }),
        );

        const [{ job: second, deduplicated }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "dedup-test",
                input: { value: 2 },
                deduplication: { key: "same-key" },
              },
            ],
          }),
        );

        expect(deduplicated).toBe(true);
        expect(second.id).toBe(first.id);

        const [{ deduplicated: notDeduped }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "dedup-test",
                input: { value: 3 },
                deduplication: { key: "different-key" },
              },
            ],
          }),
        );

        expect(notDeduped).toBe(false);
      },
    },
    {
      name: "deduplicates continuation with same chain_index",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-root",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "chain-root",
                input: null,
              },
            ],
          }),
        );

        expect(rootJob.chainIndex).toBe(0);

        const [{ job: continuation1, deduplicated: dedup1 }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "chain-step2",
                  chainId: rootJob.chainId,
                  chainIndex: 1,
                  chainTypeName: "chain-root",
                  input: { value: 1 },
                },
              ],
            }),
        );

        expect(dedup1).toBe(false);
        expect(continuation1.chainIndex).toBe(1);

        const [{ job: continuation2, deduplicated: dedup2 }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "chain-step2",
                  chainId: rootJob.chainId,
                  chainIndex: 1,
                  chainTypeName: "chain-root",
                  input: { value: 2 },
                },
              ],
            }),
        );

        expect(dedup2).toBe(true);
        expect(continuation2.id).toBe(continuation1.id);
        expect(continuation2.input).toEqual({ value: 1 });
      },
    },
    {
      name: "deduplicates concurrent continuations with same chain_index",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-root",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "chain-root",
                input: null,
              },
            ],
          }),
        );

        const [[result1], [result2]] = await Promise.all([
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "chain-step2",
                  chainId: rootJob.chainId,
                  chainIndex: 1,
                  chainTypeName: "chain-root",
                  input: { from: "tx1" },
                },
              ],
            }),
          ),
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "chain-step2",
                  chainId: rootJob.chainId,
                  chainIndex: 1,
                  chainTypeName: "chain-root",
                  input: { from: "tx2" },
                },
              ],
            }),
          ),
        ]);

        expect(result1.job.id).toBe(result2.job.id);
        expect(result1.deduplicated !== result2.deduplicated).toBe(true);
      },
    },
    {
      name: "assigns sequential chain_index values",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "t",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "t",
                input: null,
              },
            ],
          }),
        );
        expect(rootJob.chainIndex).toBe(0);

        const [{ job: cont1 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "t2",
                chainId: rootJob.chainId,
                chainIndex: 1,
                chainTypeName: "t",
                input: null,
              },
            ],
          }),
        );
        expect(cont1.chainIndex).toBe(1);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({ txCtx, jobId: cont1.id, output: null, workerId: null }),
        );

        const [{ job: cont2 }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "t3",
                chainId: rootJob.chainId,
                chainIndex: 2,
                chainTypeName: "t",
                input: null,
              },
            ],
          }),
        );
        expect(cont2.chainIndex).toBe(2);
      },
    },
    {
      name: "deduplication scope 'incomplete' does not match completed jobs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: first }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "scope-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "scope-test",
                input: null,
                deduplication: { key: "scope-key", scope: "incomplete" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: first.id,
            output: null,
            workerId: null,
          }),
        );

        const [{ deduplicated: incompleteDeduped }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "scope-test",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "scope-test",
                  input: null,
                  deduplication: { key: "scope-key", scope: "incomplete" },
                },
              ],
            }),
        );

        expect(incompleteDeduped).toBe(false);

        const [{ job: anyFirst }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "scope-test-any",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "scope-test-any",
                input: null,
                deduplication: { key: "any-key", scope: "any" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: anyFirst.id,
            output: null,
            workerId: null,
          }),
        );

        const [{ deduplicated: anyDeduped }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "scope-test-any",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "scope-test-any",
                input: null,
                deduplication: { key: "any-key", scope: "any" },
              },
            ],
          }),
        );

        expect(anyDeduped).toBe(true);
      },
    },
    {
      name: "excludeChainIds skips specified chains during deduplication",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: first }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "exclude-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "exclude-test",
                input: null,
                deduplication: { key: "exclude-key" },
              },
            ],
          }),
        );

        // Without exclude — deduplicates
        const [{ deduplicated: withoutExclude }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "exclude-test",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "exclude-test",
                  input: null,
                  deduplication: { key: "exclude-key" },
                },
              ],
            }),
        );

        expect(withoutExclude).toBe(true);

        // With exclude — creates new chain
        const [{ job: second, deduplicated: withExclude }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "exclude-test",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "exclude-test",
                  input: null,
                  deduplication: { key: "exclude-key", excludeChainIds: [first.chainId] },
                },
              ],
            }),
        );

        expect(withExclude).toBe(false);
        expect(second.id).not.toBe(first.id);
      },
    },
    {
      name: "creates job with schedule options",
      run: async ({ stateAdapter }, expect) => {
        const before = Date.now();
        const [{ job: afterMsJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "schedule-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "schedule-test",
                input: null,
                schedule: { afterMs: 5000 },
              },
            ],
          }),
        );

        const afterMsDiff = afterMsJob.scheduledAt.getTime() - before;
        expect(afterMsDiff).toBeGreaterThanOrEqual(4900);
        expect(afterMsDiff).toBeLessThan(6000);

        const futureDate = new Date(Date.now() + 60_000);
        const [{ job: atJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "schedule-test-at",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "schedule-test-at",
                input: null,
                schedule: { at: futureDate },
              },
            ],
          }),
        );

        expect(Math.abs(atJob.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(1000);
      },
    },
    {
      name: "stores and retrieves traceContext and chainTraceContext",
      run: async ({ stateAdapter }, expect) => {
        const chainTraceContext = "00-abc123-chain111-01";
        const traceContext = "00-abc123-job222-01";
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "trace-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "trace-test",
                input: null,
                chainTraceContext,
                traceContext,
              },
            ],
          }),
        );

        const retrieved = await stateAdapter.getJob({ jobId: job.id });
        expect(retrieved!.chainTraceContext).toEqual(chainTraceContext);
        expect(retrieved!.traceContext).toEqual(traceContext);
      },
    },
    {
      name: "stores and retrieves dates correctly",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "date-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "date-test",
                input: null,
              },
            ],
          }),
        );

        expect(job.createdAt).toBeInstanceOf(Date);
        expect(job.scheduledAt).toBeInstanceOf(Date);

        const timeDiff = Math.abs(Date.now() - job.createdAt.getTime());
        expect(timeDiff).toBeLessThan(5000);
      },
    },
    {
      name: "creates multiple jobs in a single batch",
      run: async ({ stateAdapter }, expect) => {
        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "batch-a",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "batch-a",
                input: { value: 1 },
              },
              {
                typeName: "batch-b",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "batch-b",
                input: { value: 2 },
              },
              {
                typeName: "batch-c",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "batch-c",
                input: { value: 3 },
              },
            ],
          }),
        );

        expect(results).toHaveLength(3);
        for (const result of results) {
          expect(result.deduplicated).toBe(false);
          expect(result.job.status).toBe("pending");
          expect(result.job.chainId).toBe(result.job.id);
        }
        expect(results[0].job.typeName).toBe("batch-a");
        expect(results[1].job.typeName).toBe("batch-b");
        expect(results[2].job.typeName).toBe("batch-c");
        expect(results[0].job.input).toEqual({ value: 1 });
        expect(results[1].job.input).toEqual({ value: 2 });
        expect(results[2].job.input).toEqual({ value: 3 });
      },
    },
    {
      name: "handles per-row deduplication in a batch",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: existingJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "dedup-test",
                input: { value: "existing" },
                deduplication: { key: "dup-key-1" },
              },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "dedup-test",
                input: { value: "new-1" },
                deduplication: { key: "dup-key-1" },
              },
              {
                typeName: "dedup-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "dedup-test",
                input: { value: "new-2" },
                deduplication: { key: "dup-key-unique" },
              },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0].deduplicated).toBe(true);
        expect(results[0].job.id).toBe(existingJob.id);
        expect(results[1].deduplicated).toBe(false);
        expect(results[1].job.id).not.toBe(existingJob.id);
      },
    },
    {
      name: "handles per-row continuation deduplication in a batch",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "root",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "root",
                input: null,
              },
            ],
          }),
        );

        const [{ job: existingContinuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step",
                chainId: rootJob.chainId,
                chainIndex: 1,
                chainTypeName: "root",
                input: { value: "first" },
              },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step",
                chainId: rootJob.chainId,
                chainIndex: 1,
                chainTypeName: "root",
                input: { value: "duplicate" },
              },
              {
                typeName: "step",
                chainId: rootJob.chainId,
                chainIndex: 2,
                chainTypeName: "root",
                input: { value: "new" },
              },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0].deduplicated).toBe(true);
        expect(results[0].job.id).toBe(existingContinuation.id);
        expect(results[1].deduplicated).toBe(false);
        expect(results[1].job.chainIndex).toBe(2);
      },
    },
    {
      name: "deduplication windowMs matches only within time window",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: first }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "window-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "window-test",
                input: null,
                deduplication: { key: "win-key", scope: "any", windowMs: 100 },
              },
            ],
          }),
        );

        // Immediate duplicate within window — should deduplicate
        const [{ deduplicated: withinWindow }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "window-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "window-test",
                input: null,
                deduplication: { key: "win-key", scope: "any", windowMs: 100 },
              },
            ],
          }),
        );

        expect(withinWindow).toBe(true);

        // Wait for window to expire
        await sleep(150);

        // After window — should NOT deduplicate
        const [{ job: afterWindow, deduplicated: outsideWindow }] =
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "window-test",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "window-test",
                  input: null,
                  deduplication: { key: "win-key", scope: "any", windowMs: 100 },
                },
              ],
            }),
          );

        expect(outsideWindow).toBe(false);
        expect(afterWindow.id).not.toBe(first.id);
      },
    },
    {
      name: "deduplication windowMs with scope 'incomplete' respects both window and status",
      run: async ({ stateAdapter }, expect) => {
        // Create and complete a job
        const [{ job: completed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "win-scope-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "win-scope-test",
                input: null,
                deduplication: { key: "ws-key", scope: "incomplete", windowMs: 5000 },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJob({
            txCtx,
            jobId: completed.id,
            output: null,
            workerId: null,
          }),
        );

        // Same key, 'incomplete' scope — completed job should not match even within window
        const [{ deduplicated }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "win-scope-test",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "win-scope-test",
                input: null,
                deduplication: { key: "ws-key", scope: "incomplete", windowMs: 5000 },
              },
            ],
          }),
        );

        expect(deduplicated).toBe(false);
      },
    },
    {
      name: "returns empty array for empty input",
      run: async ({ stateAdapter }, expect) => {
        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({ txCtx, jobs: [] }),
        );

        expect(results).toEqual([]);
      },
    },
  ],
};
