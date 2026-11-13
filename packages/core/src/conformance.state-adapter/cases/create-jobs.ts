import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import { inTransaction } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const createJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "createJobs",
  cases: [
    {
      name: "assigns chainId correctly for new jobs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "chain-test", input: null },
              ],
            }),
          ),
        );

        assert.equal(stateChain.head.chainId, stateChain.head.id);
        assert.equal(stateChain.head.chainIndex, 0);
      }),
    },
    {
      name: "round-trips scalar JSON inputs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "scalar-input",
                  input: "a bare string",
                },
                { id: stateAdapter.config.generateJobId(), typeName: "scalar-input", input: 42 },
                { id: stateAdapter.config.generateJobId(), typeName: "scalar-input", input: true },
              ],
            }),
          ),
        );

        const retrieved = yield* step(
          stateAdapter.getJobs({
            jobIds: results.map((r) => r.head.id),
          }),
        );

        assert.equal(retrieved[0]!.input, "a bare string");
        assert.equal(retrieved[1]!.input, 42);
        assert.equal(retrieved[2]!.input, true);
      }),
    },
    {
      name: "config.generateJobId produces unique ids that pass config.validateJobId",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const ids = Array.from({ length: 10 }, () => stateAdapter.config.generateJobId());
        assert.equal(new Set(ids).size, ids.length);
        for (const id of ids) {
          assert.equal(stateAdapter.config.validateJobId(id), true);
        }
      }),
    },
    {
      name: "persists and retrieves jobs correctly",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const input = { nested: { value: 42 }, array: [1, 2, 3] };
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "test-job", input }],
            }),
          ),
        );

        const [retrieved] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));

        assert.notEqual(retrieved, undefined);
        assert.equal(retrieved?.id, createdChain.head.id);
        assert.equal(retrieved?.typeName, "test-job");
        assert.deepEqual(retrieved?.input, input);
        assert.equal(retrieved?.completedAt, null);
        assert.equal(retrieved?.attemptAt, null);
      }),
    },
    {
      name: "handles null values correctly",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [created] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "null-test", input: null },
              ],
            }),
          ),
        );
        const job = created.head;

        assert.equal(job.status, "pending");
        assert.equal(job.input, null);
        assert.equal(job.output, null);
        assert.equal(job.completedAt, null);
        assert.equal(job.completedBy, null);
        assert.equal(job.lastAttemptError, null);
        assert.equal(job.lastAttemptAt, null);
        assert.equal(job.attemptAt, null);
        assert.equal(job.attemptBy, null);
        assert.equal(job.attemptToken, null);
        assert.equal(job.id, job.chainId);
        assert.equal(created.id, job.chainId);
        assert.equal(created.typeName, job.typeName);
        assert.equal(created.deduplicationKey, null);
        assert.equal(created.status, "running");
        assert.equal(created.completedAt, null);
      }),
    },
    {
      name: "handles complex JSON input/output",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

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

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "json-test",
                  input: complexInput,
                },
              ],
            }),
          ),
        );

        const [retrieved] = yield* step(stateAdapter.getJobs({ jobIds: [stateChain.head.id] }));
        assert.deepEqual(retrieved?.input, complexInput);
      }),
    },
    {
      name: "deduplicates jobs with same deduplication key",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [firstChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-test",
                  input: { value: 1 },
                  deduplication: { key: "same-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        const [secondResult] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-test",
                  input: { value: 2 },
                  deduplication: { key: "same-key", scope: "running" },
                },
              ],
            }),
          ),
        );
        const { deduplicated } = secondResult;

        assert.equal(deduplicated, true);
        assert.equal(secondResult.head.id, firstChain.head.id);
        assert.equal(secondResult.deduplicationKey, "same-key");

        const [{ deduplicated: deduplicatedAfterCompletion }] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-test",
                  input: { value: 3 },
                  deduplication: { key: "different-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(deduplicatedAfterCompletion, false);
      }),
    },
    {
      name: "scopes the deduplication key by the chain's own type name",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [firstChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-scope-a",
                  input: null,
                  deduplication: { key: "shared-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        const [otherResult] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-scope-b",
                  input: null,
                  deduplication: { key: "shared-key", scope: "running" },
                },
              ],
            }),
          ),
        );
        const { deduplicated } = otherResult;

        assert.equal(deduplicated, false);
        assert.notEqual(otherResult.head.id, firstChain.head.id);
        assert.equal(otherResult.typeName, "dedup-scope-b");
        assert.equal(otherResult.deduplicationKey, "shared-key");
      }),
    },
    {
      name: "deduplication scope 'running' does not match completed jobs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [firstChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "scope-test",
                  input: null,
                  deduplication: { key: "scope-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: firstChain.head.id, output: null }],
            }),
          ),
        );

        const [{ deduplicated: deduplicatedForIncompleteScope }] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "scope-test",
                  input: null,
                  deduplication: { key: "scope-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(deduplicatedForIncompleteScope, false);

        const [anyFirstChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "scope-test-any",
                  input: null,
                  deduplication: { key: "any-key", scope: "any" },
                },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: anyFirstChain.head.id, output: null }],
            }),
          ),
        );

        const [{ deduplicated: deduplicatedForAnyScope }] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "scope-test-any",
                  input: null,
                  deduplication: { key: "any-key", scope: "any" },
                },
              ],
            }),
          ),
        );

        assert.equal(deduplicatedForAnyScope, true);
      }),
    },
    {
      name: "deduplication scope 'running' matches multi-step chains that have continued",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["step1"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "step1",
                  input: null,
                  deduplication: { key: "multi-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        const step2 = yield* step(
          inTransaction(stateAdapter, function* (txCtx) {
            yield* step(
              stateAdapter.startJobAttempts({
                txCtx,
                workerId: worker.id,
                workerToken: worker.token,
                typeNames: ["step1"],
                limit: 1,
              }),
            );
            const [continued] = yield* step(
              stateAdapter.continueJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "step2",
                    input: null,
                    continueFromId: headChain.head.id,
                  },
                ],
              }),
            );
            const { continuation } = continued!;
            return continuation;
          }),
        );

        const [{ deduplicated: deduplicatedMidChain }] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "step1",
                  input: null,
                  deduplication: { key: "multi-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(deduplicatedMidChain, true);

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: step2.id, output: null }],
            }),
          ),
        );

        const [{ deduplicated: deduplicatedAfterComplete }] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "step1",
                  input: null,
                  deduplication: { key: "multi-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(deduplicatedAfterComplete, false);
      }),
    },
    {
      name: "a deduplicated match returns the chain's latest continuation as its tail",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tail-step1",
                  input: null,
                  deduplication: { key: "tail-key", scope: "any" },
                },
              ],
            }),
          ),
        );
        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tail-step2",
                  input: null,
                  continueFromId: headChain.head.id,
                },
              ],
            }),
          ),
        );
        const step2 = continued!.continuation;

        const [runningMatch] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tail-step1",
                  input: null,
                  deduplication: { key: "tail-key", scope: "any" },
                },
              ],
            }),
          ),
        );

        assert.equal(runningMatch.deduplicated, true);
        assert.equal(runningMatch.status, "running");
        assert.equal(runningMatch.head.id, headChain.head.id);
        assert.equal(runningMatch.tail?.id, step2.id);

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: step2.id, output: { total: 3 } }],
            }),
          ),
        );

        const [completedMatch] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "tail-step1",
                  input: null,
                  deduplication: { key: "tail-key", scope: "any" },
                },
              ],
            }),
          ),
        );

        assert.equal(completedMatch.deduplicated, true);
        assert.equal(completedMatch.status, "completed");
        assert.equal(completedMatch.tail?.id, step2.id);
        assert.deepEqual(completedMatch.tail?.output, { total: 3 });
      }),
    },
    {
      name: "deduplication scope 'running' picks running chain when completed chain exists with same key",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [firstChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "coexist",
                  input: null,
                  deduplication: { key: "coexist-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: firstChain.head.id, output: null }],
            }),
          ),
        );

        const [secondChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "coexist",
                  input: null,
                  deduplication: { key: "coexist-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.notEqual(secondChain.head.id, firstChain.head.id);

        const [matchedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "coexist",
                  input: null,
                  deduplication: { key: "coexist-key", scope: "running" },
                },
              ],
            }),
          ),
        );
        const { deduplicated } = matchedChain;

        assert.equal(deduplicated, true);
        assert.equal(matchedChain.head.id, secondChain.head.id);
      }),
    },
    {
      name: "creates job with schedule options",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const before = Date.now();
        const [afterMsChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "schedule-test",
                  input: null,
                  schedule: { afterMs: 5000 },
                },
              ],
            }),
          ),
        );

        const afterMsDiff = afterMsChain.head.scheduledAt.getTime() - before;
        assert.ok(afterMsDiff >= 4900);
        assert.ok(afterMsDiff < 6000);

        const futureDate = new Date(Date.now() + 60_000);
        const [atChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "schedule-test-at",
                  input: null,
                  schedule: { at: futureDate },
                },
              ],
            }),
          ),
        );

        assert.ok(Math.abs(atChain.head.scheduledAt.getTime() - futureDate.getTime()) < 1000);
      }),
    },
    {
      name: "schedules with a schedule.afterMs of 30 days",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const before = Date.now();
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "schedule-far",
                  input: null,
                  schedule: { afterMs: thirtyDaysMs },
                },
              ],
            }),
          ),
        );

        const diff = createdChain.head.scheduledAt.getTime() - before;
        assert.ok(diff >= thirtyDaysMs - 1000);
        assert.ok(diff < thirtyDaysMs + 1000);
      }),
    },
    {
      name: "schedules with a fractional schedule.afterMs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const fractionalMs = 60_000.5;
        const before = Date.now();
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "schedule-fractional",
                  input: null,
                  schedule: { afterMs: fractionalMs },
                },
              ],
            }),
          ),
        );

        const diff = createdChain.head.scheduledAt.getTime() - before;
        assert.ok(diff >= fractionalMs - 1000);
        assert.ok(diff < fractionalMs + 1000);
      }),
    },
    {
      name: "clamps past schedule.at to now (scheduled_at is eligibility floor, never a past lie)",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const past = new Date(Date.now() - 60 * 60 * 1000);
        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "schedule-past",
                  input: null,
                  schedule: { at: past },
                },
              ],
            }),
          ),
        );

        assert.ok(stateChain.head.scheduledAt.getTime() - past.getTime() > 30 * 60 * 1000);
        assert.ok(Math.abs(stateChain.head.scheduledAt.getTime() - Date.now()) < 60 * 1000);
      }),
    },
    {
      name: "stores and retrieves traceContext and chainTraceContext",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const chainTraceContext = "00-abc123-chain111-01";
        const traceContext = "00-abc123-job222-01";
        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "trace-test",
                  input: null,
                  chainTraceContext,
                  traceContext,
                },
              ],
            }),
          ),
        );

        const [retrieved] = yield* step(stateAdapter.getJobs({ jobIds: [stateChain.head.id] }));
        assert.deepEqual(retrieved?.chain.traceContext, chainTraceContext);
        assert.deepEqual(retrieved?.traceContext, traceContext);
      }),
    },
    {
      name: "stores and retrieves dates correctly",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "date-test", input: null },
              ],
            }),
          ),
        );

        assert.ok(stateChain.head.createdAt instanceof Date);
        assert.ok(stateChain.head.scheduledAt instanceof Date);

        const timeDiff = Math.abs(Date.now() - stateChain.head.createdAt.getTime());
        assert.ok(timeDiff < 5000);
      }),
    },
    {
      name: "creates multiple jobs in a single batch",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-a",
                  input: { value: 1 },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-b",
                  input: { value: 2 },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-c",
                  input: { value: 3 },
                },
              ],
            }),
          ),
        );

        assert.equal(results.length, 3);
        for (const result of results) {
          assert.equal(result.deduplicated, false);
          assert.equal(result.head.completedAt, null);
          assert.equal(result.head.attemptAt, null);
          assert.equal(result.head.chainId, result.head.id);
        }
        assert.equal(results[0].head.typeName, "batch-a");
        assert.equal(results[1].head.typeName, "batch-b");
        assert.equal(results[2].head.typeName, "batch-c");
        assert.deepEqual(results[0].head.input, { value: 1 });
        assert.deepEqual(results[1].head.input, { value: 2 });
        assert.deepEqual(results[2].head.input, { value: 3 });
      }),
    },
    {
      name: "handles per-row deduplication in a batch",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [existingChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-test",
                  input: { value: "existing" },
                  deduplication: { key: "dup-key-1", scope: "running" },
                },
              ],
            }),
          ),
        );

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-test",
                  input: { value: "new-1" },
                  deduplication: { key: "dup-key-1", scope: "running" },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-test",
                  input: { value: "new-2" },
                  deduplication: { key: "dup-key-unique", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.equal(results.length, 2);
        assert.equal(results[0].deduplicated, true);
        assert.equal(results[0].head.id, existingChain.head.id);
        assert.equal(results[1].deduplicated, false);
        assert.notEqual(results[1].head.id, existingChain.head.id);
      }),
    },
    {
      name: "deduplicates a batch entry against an earlier entry of the same batch",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-intra-batch",
                  input: { value: "first" },
                  deduplication: { key: "intra-batch-key", scope: "running" },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "dedup-intra-batch",
                  input: { value: "second" },
                  deduplication: { key: "intra-batch-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        assert.deepEqual(
          results.map((result) => result.deduplicated),
          [false, true],
        );
        assert.equal(results[1].id, results[0].id);
        assert.deepEqual(results[1].head.input, { value: "first" });

        const chains = yield* step(
          stateAdapter.listChains({
            typeName: "dedup-intra-batch",
            orderBy: "createdAt",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.equal(chains.items.length, 1);
      }),
    },
    {
      name: "returns empty array for empty input",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) => stateAdapter.createJobs({ txCtx, jobs: [] })),
        );

        assert.deepEqual(results, []);
      }),
    },
    {
      name: "uses caller-supplied id when provided",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const userId = stateAdapter.config.generateJobId();
        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );
        assert.equal(stateChain.head.id, userId);
        assert.equal(stateChain.head.chainId, userId);
      }),
    },
    {
      name: "dedup wins over caller-supplied id",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [firstChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "id-dedup",
                  input: null,
                  deduplication: { key: "dedup-id-key", scope: "running" },
                },
              ],
            }),
          ),
        );

        const userId = stateAdapter.config.generateJobId();
        const [secondChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );
        const { deduplicated } = secondChain;

        assert.equal(deduplicated, true);
        assert.equal(secondChain.head.id, firstChain.head.id);
        assert.notEqual(secondChain.head.id, userId);
      }),
    },
    {
      name: "caller-supplied id collision on createJobs errors",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const userId = stateAdapter.config.generateJobId();
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        yield* step(
          assertRejects(() =>
            stateAdapter.withTransaction((txCtx) =>
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
          ),
        );
      }),
    },
    {
      name: "caller-supplied id collision does not affect the existing chain",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const userId = stateAdapter.config.generateJobId();
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        yield* step(
          assertRejects(() =>
            stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        const [afterCollision] = yield* step(stateAdapter.getJobs({ jobIds: [userId] }));
        assert.equal(afterCollision!.typeName, "original");
        assert.deepEqual(afterCollision!.input, { preserved: true });
      }),
    },
    {
      name: "intra-batch duplicate caller-supplied id errors",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const userId = stateAdapter.config.generateJobId();
        yield* step(
          assertRejects(() =>
            stateAdapter.withTransaction((txCtx) =>
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
          ),
        );
      }),
    },
  ],
};
