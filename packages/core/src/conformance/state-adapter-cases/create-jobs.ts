import { InvalidJobIdError } from "../../errors.js";
import { type StateJobInfo } from "../../state-adapter/state-adapter.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const createJobsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "createJobs",
  cases: [
    {
      name: "assigns chainId correctly for new jobs",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "chain-test", input: null }],
          }),
        );

        expect(stateChain.head.chainId).toBe(stateChain.head.id);
        expect(stateChain.head.chainIndex).toBe(0);
      },
    },
    {
      name: "round-trips scalar JSON inputs",
      run: async ({ stateAdapter }, expect) => {
        const results = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { typeName: "scalar-input", input: "a bare string" },
              { typeName: "scalar-input", input: 42 },
              { typeName: "scalar-input", input: true },
            ],
          }),
        );

        const retrieved = await stateAdapter.getJobs({
          jobIds: results.map((r) => r.head.id),
        });

        expect(retrieved[0]!.input).toBe("a bare string");
        expect(retrieved[1]!.input).toBe(42);
        expect(retrieved[2]!.input).toBe(true);
      },
    },
    {
      name: "generates unique job IDs",
      run: async ({ stateAdapter }, expect) => {
        const jobs = await stateAdapter.withTransaction(async (txCtx) => {
          const results: StateJobInfo[] = [];
          for (let i = 0; i < 10; i++) {
            const [stateChain] = await stateAdapter.createJobs({
              txCtx,
              jobs: [{ typeName: "test-job", input: { value: i } }],
            });
            results.push(stateChain.head);
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
        const [createdChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "test-job",
                input,
              },
            ],
          }),
        );

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [createdChain.head.id] });

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(createdChain.head.id);
        expect(retrieved?.typeName).toBe("test-job");
        expect(retrieved?.input).toEqual(input);
        expect(retrieved?.completedAt).toBeNull();
        expect(retrieved?.attemptAt).toBeNull();
      },
    },
    {
      name: "handles null values correctly",
      run: async ({ stateAdapter }, expect) => {
        const [created] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "null-test", input: null }],
          }),
        );
        const job = created.head;

        expect(job.status).toBe("pending");
        expect(job.input).toBeNull();
        expect(job.output).toBeNull();
        expect(job.completedAt).toBeNull();
        expect(job.completedBy).toBeNull();
        expect(job.lastAttemptError).toBeNull();
        expect(job.lastAttemptAt).toBeNull();
        expect(job.attemptAt).toBeNull();
        expect(job.attemptBy).toBeNull();
        expect(job.attemptUntil).toBeNull();
        expect(job.id).toBe(job.chainId);
        expect(created.id).toBe(job.chainId);
        expect(created.typeName).toBe(job.typeName);
        expect(created.deduplicationKey).toBeNull();
        expect(created.status).toBe("running");
        expect(created.completedAt).toBeNull();
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

        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "json-test", input: complexInput }],
          }),
        );

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(retrieved?.input).toEqual(complexInput);
      },
    },
    {
      name: "deduplicates jobs with same deduplication key",
      run: async ({ stateAdapter }, expect) => {
        const [firstChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                input: { value: 1 },
                deduplication: { key: "same-key", scope: "running" },
              },
            ],
          }),
        );

        const [secondResult] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                input: { value: 2 },
                deduplication: { key: "same-key", scope: "running" },
              },
            ],
          }),
        );
        const { deduplicated } = secondResult;

        expect(deduplicated).toBe(true);
        expect(secondResult.head.id).toBe(firstChain.head.id);
        expect(secondResult.deduplicationKey).toBe("same-key");

        const [{ deduplicated: deduplicatedAfterCompletion }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "dedup-test",
                  input: { value: 3 },
                  deduplication: { key: "different-key", scope: "running" },
                },
              ],
            }),
        );

        expect(deduplicatedAfterCompletion).toBe(false);
      },
    },
    {
      name: "scopes the deduplication key by the chain's own type name",
      run: async ({ stateAdapter }, expect) => {
        const [firstChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-scope-a",
                input: null,
                deduplication: { key: "shared-key", scope: "running" },
              },
            ],
          }),
        );

        const [otherResult] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-scope-b",
                input: null,
                deduplication: { key: "shared-key", scope: "running" },
              },
            ],
          }),
        );
        const { deduplicated } = otherResult;

        expect(deduplicated).toBe(false);
        expect(otherResult.head.id).not.toBe(firstChain.head.id);
        expect(otherResult.typeName).toBe("dedup-scope-b");
        expect(otherResult.deduplicationKey).toBe("shared-key");
      },
    },
    {
      name: "deduplication scope 'running' does not match completed jobs",
      run: async ({ stateAdapter }, expect) => {
        const [firstChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "scope-test",
                input: null,
                deduplication: { key: "scope-key", scope: "running" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: firstChain.head.id, output: null }],
          }),
        );

        const [{ deduplicated: deduplicatedForIncompleteScope }] =
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "scope-test",
                  input: null,
                  deduplication: { key: "scope-key", scope: "running" },
                },
              ],
            }),
          );

        expect(deduplicatedForIncompleteScope).toBe(false);

        const [anyFirstChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "scope-test-any",
                input: null,
                deduplication: { key: "any-key", scope: "any" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: null,
            jobs: [{ jobId: anyFirstChain.head.id, output: null }],
          }),
        );

        const [{ deduplicated: deduplicatedForAnyScope }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "scope-test-any",
                  input: null,
                  deduplication: { key: "any-key", scope: "any" },
                },
              ],
            }),
        );

        expect(deduplicatedForAnyScope).toBe(true);
      },
    },
    {
      name: "deduplication scope 'running' matches multi-step chains that have continued",
      run: async ({ stateAdapter }, expect) => {
        const [rootChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "step1",
                input: null,
                deduplication: { key: "multi-key", scope: "running" },
              },
            ],
          }),
        );

        const step2 = await stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.startJobAttempt({ txCtx, workerId: "worker-1", typeNames: ["step1"] });
          const [continued] = await stateAdapter.continueJobs({
            txCtx,
            completedBy: "w",
            jobs: [{ typeName: "step2", input: null, continueFromId: rootChain.head.id }],
          });
          const { continuation } = continued!;
          return continuation;
        });

        const [{ deduplicated: deduplicatedMidChain }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "step1",
                  input: null,
                  deduplication: { key: "multi-key", scope: "running" },
                },
              ],
            }),
        );

        expect(deduplicatedMidChain).toBe(true);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "w",
            jobs: [{ jobId: step2.id, output: null }],
          }),
        );

        const [{ deduplicated: deduplicatedAfterComplete }] = await stateAdapter.withTransaction(
          async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "step1",
                  input: null,
                  deduplication: { key: "multi-key", scope: "running" },
                },
              ],
            }),
        );

        expect(deduplicatedAfterComplete).toBe(false);
      },
    },
    {
      name: "deduplication scope 'running' picks running chain when completed chain exists with same key",
      run: async ({ stateAdapter }, expect) => {
        const [firstChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "coexist",
                input: null,
                deduplication: { key: "coexist-key", scope: "running" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.completeJobs({
            txCtx,
            completedBy: "w",
            jobs: [{ jobId: firstChain.head.id, output: null }],
          }),
        );

        const [secondChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "coexist",
                input: null,
                deduplication: { key: "coexist-key", scope: "running" },
              },
            ],
          }),
        );

        expect(secondChain.head.id).not.toBe(firstChain.head.id);

        const [matchedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "coexist",
                input: null,
                deduplication: { key: "coexist-key", scope: "running" },
              },
            ],
          }),
        );
        const { deduplicated } = matchedChain;

        expect(deduplicated).toBe(true);
        expect(matchedChain.head.id).toBe(secondChain.head.id);
      },
    },
    {
      name: "creates job with schedule options",
      run: async ({ stateAdapter }, expect) => {
        const before = Date.now();
        const [afterMsChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "schedule-test", input: null, schedule: { afterMs: 5000 } }],
          }),
        );

        const afterMsDiff = afterMsChain.head.scheduledAt.getTime() - before;
        expect(afterMsDiff).toBeGreaterThanOrEqual(4900);
        expect(afterMsDiff).toBeLessThan(6000);

        const futureDate = new Date(Date.now() + 60_000);
        const [atChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "schedule-test-at", input: null, schedule: { at: futureDate } }],
          }),
        );

        expect(Math.abs(atChain.head.scheduledAt.getTime() - futureDate.getTime())).toBeLessThan(
          1000,
        );
      },
    },
    {
      name: "clamps past schedule.at to now (scheduled_at is eligibility floor, never a past lie)",
      run: async ({ stateAdapter }, expect) => {
        const past = new Date(Date.now() - 60 * 60 * 1000);
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "schedule-past", input: null, schedule: { at: past } }],
          }),
        );

        expect(stateChain.head.scheduledAt.getTime() - past.getTime()).toBeGreaterThan(
          30 * 60 * 1000,
        );
        expect(Math.abs(stateChain.head.scheduledAt.getTime() - Date.now())).toBeLessThan(
          60 * 1000,
        );
      },
    },
    {
      name: "stores and retrieves traceContext and chainTraceContext",
      run: async ({ stateAdapter }, expect) => {
        const chainTraceContext = "00-abc123-chain111-01";
        const traceContext = "00-abc123-job222-01";
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "trace-test",
                input: null,
                chainTraceContext,
                traceContext,
              },
            ],
          }),
        );

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(retrieved?.chain.traceContext).toEqual(chainTraceContext);
        expect(retrieved?.traceContext).toEqual(traceContext);
      },
    },
    {
      name: "stores and retrieves dates correctly",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "date-test", input: null }],
          }),
        );

        expect(stateChain.head.createdAt).toBeInstanceOf(Date);
        expect(stateChain.head.scheduledAt).toBeInstanceOf(Date);

        const timeDiff = Math.abs(Date.now() - stateChain.head.createdAt.getTime());
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
              { typeName: "batch-a", input: { value: 1 } },
              { typeName: "batch-b", input: { value: 2 } },
              { typeName: "batch-c", input: { value: 3 } },
            ],
          }),
        );

        expect(results).toHaveLength(3);
        for (const result of results) {
          expect(result.deduplicated).toBe(false);
          expect(result.head.completedAt).toBeNull();
          expect(result.head.attemptAt).toBeNull();
          expect(result.head.chainId).toBe(result.head.id);
        }
        expect(results[0].head.typeName).toBe("batch-a");
        expect(results[1].head.typeName).toBe("batch-b");
        expect(results[2].head.typeName).toBe("batch-c");
        expect(results[0].head.input).toEqual({ value: 1 });
        expect(results[1].head.input).toEqual({ value: 2 });
        expect(results[2].head.input).toEqual({ value: 3 });
      },
    },
    {
      name: "handles per-row deduplication in a batch",
      run: async ({ stateAdapter }, expect) => {
        const [existingChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "dedup-test",
                input: { value: "existing" },
                deduplication: { key: "dup-key-1", scope: "running" },
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
                input: { value: "new-1" },
                deduplication: { key: "dup-key-1", scope: "running" },
              },
              {
                typeName: "dedup-test",
                input: { value: "new-2" },
                deduplication: { key: "dup-key-unique", scope: "running" },
              },
            ],
          }),
        );

        expect(results).toHaveLength(2);
        expect(results[0].deduplicated).toBe(true);
        expect(results[0].head.id).toBe(existingChain.head.id);
        expect(results[1].deduplicated).toBe(false);
        expect(results[1].head.id).not.toBe(existingChain.head.id);
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
    {
      name: "uses caller-supplied id when provided",
      run: async ({ stateAdapter, generateId }, expect) => {
        const userId = (generateId ?? (() => crypto.randomUUID()))();
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "id-test",
                id: userId,
                input: null,
              },
            ],
          }),
        );
        expect(stateChain.head.id).toBe(userId);
        expect(stateChain.head.chainId).toBe(userId);
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
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "invalid-id-test",
                  id: badId,
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
        const [firstChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "id-dedup",
                input: null,
                deduplication: { key: "dedup-id-key", scope: "running" },
              },
            ],
          }),
        );

        const userId = (generateId ?? (() => crypto.randomUUID()))();
        const [secondChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "id-dedup",
                id: userId,
                input: null,
                deduplication: { key: "dedup-id-key", scope: "running" },
              },
            ],
          }),
        );
        const { deduplicated } = secondChain;

        expect(deduplicated).toBe(true);
        expect(secondChain.head.id).toBe(firstChain.head.id);
        expect(secondChain.head.id).not.toBe(userId);
      },
    },
    {
      name: "caller-supplied id collision on createJobs errors",
      run: async ({ stateAdapter, generateId }, expect) => {
        const userId = (generateId ?? (() => crypto.randomUUID()))();
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "collision-test",
                id: userId,
                input: null,
              },
            ],
          }),
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "collision-test-2",
                  id: userId,
                  input: null,
                },
              ],
            }),
          ),
        ).rejects.toThrow();
      },
    },
    {
      name: "caller-supplied id collision does not affect the existing chain",
      run: async ({ stateAdapter, generateId }, expect) => {
        const userId = (generateId ?? (() => crypto.randomUUID()))();
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "original",
                id: userId,
                input: { preserved: true },
              },
            ],
          }),
        );

        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "intruder",
                  id: userId,
                  input: { preserved: false },
                },
              ],
            }),
          ),
        ).rejects.toThrow();

        const [afterCollision] = await stateAdapter.getJobs({ jobIds: [userId] });
        expect(afterCollision!.typeName).toBe("original");
        expect(afterCollision!.input).toEqual({ preserved: true });
      },
    },
    {
      name: "intra-batch duplicate caller-supplied id errors",
      run: async ({ stateAdapter, generateId }, expect) => {
        const userId = (generateId ?? (() => crypto.randomUUID()))();
        await expect(
          stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "batch-dup-1",
                  id: userId,
                  input: null,
                },
                {
                  typeName: "batch-dup-2",
                  id: userId,
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
