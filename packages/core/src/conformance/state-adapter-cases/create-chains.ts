import { InvalidJobIdError } from "../../errors.js";
import { type StateJob } from "../../state-adapter/state-adapter.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const createChainsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "createChains",
  cases: [
    {
      name: "assigns chainId correctly for new jobs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "chain-test",
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
      name: "generates unique job IDs",
      run: async ({ stateAdapter }, expect) => {
        const jobs = await stateAdapter.withTransaction(async (txCtx) => {
          const results: StateJob[] = [];
          for (let i = 0; i < 10; i++) {
            const [{ job }] = await stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "test-job",
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
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "test-job",
                chainTypeName: "test-job",
                input,
              },
            ],
          }),
        );

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [created.id] });

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(created.id);
        expect(retrieved?.typeName).toBe("test-job");
        expect(retrieved?.input).toEqual(input);
        expect(retrieved?.completedAt).toBeNull();
        expect(retrieved?.attemptAt).toBeNull();
      },
    },
    {
      name: "handles null values correctly",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "null-test",
                chainTypeName: "null-test",
                input: null,
              },
            ],
          }),
        );

        expect(job.blocked).toBe(false);
        expect(job.input).toBeNull();
        expect(job.output).toBeNull();
        expect(job.completedAt).toBeNull();
        expect(job.completedBy).toBeNull();
        expect(job.lastAttemptError).toBeNull();
        expect(job.lastAttemptAt).toBeNull();
        expect(job.attemptAt).toBeNull();
        expect(job.attemptBy).toBeNull();
        expect(job.attemptUntil).toBeNull();
        expect(job.deduplicationKey).toBeNull();
        expect(job.id).toBe(job.chainId);
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
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "json-test",
                chainTypeName: "json-test",
                input: complexInput,
              },
            ],
          }),
        );

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [job.id] });
        expect(retrieved?.input).toEqual(complexInput);
      },
    },
    {
      name: "deduplicates jobs with same deduplication key",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: first }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainTypeName: "dedup-test",
                input: { value: 1 },
                deduplication: { key: "same-key", scope: "running" },
              },
            ],
          }),
        );

        const [{ job: second, deduplicated }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainTypeName: "dedup-test",
                input: { value: 2 },
                deduplication: { key: "same-key", scope: "running" },
              },
            ],
          }),
        );

        expect(deduplicated).toBe(true);
        expect(second.id).toBe(first.id);

        const [{ deduplicated: notDeduped }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainTypeName: "dedup-test",
                input: { value: 3 },
                deduplication: { key: "different-key", scope: "running" },
              },
            ],
          }),
        );

        expect(notDeduped).toBe(false);
      },
    },
    {
      name: "deduplication scope 'running' does not match completed jobs",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: first }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "scope-test",
                chainTypeName: "scope-test",
                input: null,
                deduplication: { key: "scope-key", scope: "running" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: first.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const [{ deduplicated: incompleteDeduped }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "scope-test",
                  chainTypeName: "scope-test",
                  input: null,
                  deduplication: { key: "scope-key", scope: "running" },
                },
              ],
            }),
        );

        expect(incompleteDeduped).toBe(false);

        const [{ job: anyFirst }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "scope-test-any",
                chainTypeName: "scope-test-any",
                input: null,
                deduplication: { key: "any-key", scope: "any" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: anyFirst.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const [{ deduplicated: anyDeduped }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "scope-test-any",
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
      name: "deduplication scope 'running' matches multi-step chains that have continued",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "step1",
                chainTypeName: "step1",
                input: null,
                deduplication: { key: "multi-key", scope: "running" },
              },
            ],
          }),
        );

        const { job: step2 } = await stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: ["step1"] });
          const continuation = await stateAdapter.createContinuationJob({
            txCtx,
            job: { typeName: "step2", input: null, continueFromId: root.id },
          });
          await stateAdapter.finishJobAttempt({
            txCtx,
            jobId: root.id,
            workerId: "w",
            outcome: { continuedToId: continuation.job.id },
          });
          return continuation;
        });

        const [{ deduplicated: midChain }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "step1",
                chainTypeName: "step1",
                input: null,
                deduplication: { key: "multi-key", scope: "running" },
              },
            ],
          }),
        );

        expect(midChain).toBe(true);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: step2.id,
            workerId: "w",
            outcome: { output: null },
          }),
        );

        const [{ deduplicated: afterComplete }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "step1",
                  chainTypeName: "step1",
                  input: null,
                  deduplication: { key: "multi-key", scope: "running" },
                },
              ],
            }),
        );

        expect(afterComplete).toBe(false);
      },
    },
    {
      name: "deduplication scope 'running' picks running chain when completed chain exists with same key",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: first }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "coexist",
                chainTypeName: "coexist",
                input: null,
                deduplication: { key: "coexist-key", scope: "running" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: first.id,
            workerId: "w",
            outcome: { output: null },
          }),
        );

        const [{ job: second }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "coexist",
                chainTypeName: "coexist",
                input: null,
                deduplication: { key: "coexist-key", scope: "running" },
              },
            ],
          }),
        );

        expect(second.id).not.toBe(first.id);

        const [{ deduplicated, job: matched }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "coexist",
                chainTypeName: "coexist",
                input: null,
                deduplication: { key: "coexist-key", scope: "running" },
              },
            ],
          }),
        );

        expect(deduplicated).toBe(true);
        expect(matched.id).toBe(second.id);
      },
    },
    {
      name: "creates job with schedule options",
      run: async ({ stateAdapter }, expect) => {
        const before = Date.now();
        const [{ job: afterMsJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "schedule-test",
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
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "schedule-test-at",
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
      name: "clamps past schedule.at to now (scheduled_at is eligibility floor, never a past lie)",
      run: async ({ stateAdapter }, expect) => {
        const past = new Date(Date.now() - 60 * 60 * 1000);
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "schedule-past",
                chainTypeName: "schedule-past",
                input: null,
                schedule: { at: past },
              },
            ],
          }),
        );

        expect(job.scheduledAt.getTime() - past.getTime()).toBeGreaterThan(30 * 60 * 1000);
        expect(Math.abs(job.scheduledAt.getTime() - Date.now())).toBeLessThan(60 * 1000);
      },
    },
    {
      name: "stores and retrieves traceContext and chainTraceContext",
      run: async ({ stateAdapter }, expect) => {
        const chainTraceContext = "00-abc123-chain111-01";
        const traceContext = "00-abc123-job222-01";
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "trace-test",
                chainTypeName: "trace-test",
                input: null,
                chainTraceContext,
                traceContext,
              },
            ],
          }),
        );

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [job.id] });
        expect(retrieved?.chainTraceContext).toEqual(chainTraceContext);
        expect(retrieved?.traceContext).toEqual(traceContext);
      },
    },
    {
      name: "stores and retrieves dates correctly",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "date-test",
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
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "batch-a",
                chainTypeName: "batch-a",
                input: { value: 1 },
              },
              {
                typeName: "batch-b",
                chainTypeName: "batch-b",
                input: { value: 2 },
              },
              {
                typeName: "batch-c",
                chainTypeName: "batch-c",
                input: { value: 3 },
              },
            ],
          }),
        );

        expect(results).toHaveLength(3);
        for (const result of results) {
          expect(result.deduplicated).toBe(false);
          expect(result.job.completedAt).toBeNull();
          expect(result.job.attemptAt).toBeNull();
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
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainTypeName: "dedup-test",
                input: { value: "existing" },
                deduplication: { key: "dup-key-1", scope: "running" },
              },
            ],
          }),
        );

        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                chainTypeName: "dedup-test",
                input: { value: "new-1" },
                deduplication: { key: "dup-key-1", scope: "running" },
              },
              {
                typeName: "dedup-test",
                chainTypeName: "dedup-test",
                input: { value: "new-2" },
                deduplication: { key: "dup-key-unique", scope: "running" },
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
      name: "returns empty array for empty input",
      run: async ({ stateAdapter }, expect) => {
        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({ txCtx, jobs: [] }),
        );

        expect(results).toEqual([]);
      },
    },
    {
      name: "uses caller-supplied id when provided",
      run: async ({ stateAdapter, generateId }, expect) => {
        const userId = (generateId ?? (() => crypto.randomUUID()))();
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "id-test",
                id: userId,
                chainTypeName: "id-test",
                input: null,
              },
            ],
          }),
        );
        expect(job.id).toBe(userId);
        expect(job.chainId).toBe(userId);
      },
    },
    {
      name: "rejects caller-supplied id that fails validateId",
      run: async ({ stateAdapter, generateInvalidId }, expect) => {
        if (!generateInvalidId) {
          expect.skip("adapter has no validateId configured");
        }
        const badId = generateInvalidId!();
        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "invalid-id-test",
                  id: badId,
                  chainTypeName: "invalid-id-test",
                  input: null,
                },
              ],
            }),
          ),
        ).rejects.toThrow(InvalidJobIdError);
      },
    },
    {
      name: "dedup wins over caller-supplied id",
      run: async ({ stateAdapter, generateId }, expect) => {
        const [{ job: first }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "id-dedup",
                chainTypeName: "id-dedup",
                input: null,
                deduplication: { key: "dedup-id-key", scope: "running" },
              },
            ],
          }),
        );

        const userId = (generateId ?? (() => crypto.randomUUID()))();
        const [{ job: second, deduplicated }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "id-dedup",
                id: userId,
                chainTypeName: "id-dedup",
                input: null,
                deduplication: { key: "dedup-id-key", scope: "running" },
              },
            ],
          }),
        );

        expect(deduplicated).toBe(true);
        expect(second.id).toBe(first.id);
        expect(second.id).not.toBe(userId);
      },
    },
  ],
};
