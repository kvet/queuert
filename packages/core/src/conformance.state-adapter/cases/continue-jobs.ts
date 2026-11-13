import assert from "node:assert/strict";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { caseBody, resource } from "@queuert/helpers/case-body";
import { all, tryCatch } from "@queuert/helpers/maybe-promise";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const continueJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "continueJobs",
  cases: [
    {
      name: "inherits chainId from the parent and assigns a new job id",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "head-job", input: null },
              ],
            }),
          ),
        );

        const [completedResult] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "child-job",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const childJob = completedResult!.continuation;

        assert.equal(childJob.chainId, headChain.head.chainId);
        assert.equal(childJob.chainIndex, 1);
        assert.notEqual(childJob.id, headChain.head.id);
        assert.equal(completedResult!.continuedToId, childJob.id);
        assert.equal(completedResult!.status, "completed");
        assert.equal(childJob.status, "pending");
        assert.equal(completedResult!.chain.status, "running");
        assert.notEqual(completedResult!.completedAt, null);
        assert.equal(completedResult!.completedBy, null);
      }),
    },
    {
      name: "schedules the continuation with a schedule.afterMs of 30 days",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "far-head", input: null },
              ],
            }),
          ),
        );

        const before = Date.now();
        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "far-child",
                  continueFromId: headChain.head.id,
                  input: null,
                  schedule: { afterMs: thirtyDaysMs },
                },
              ],
            }),
          ),
        );

        const diff = continued!.continuation.scheduledAt.getTime() - before;
        assert.ok(diff >= thirtyDaysMs - 1000);
        assert.ok(diff < thirtyDaysMs + 1000);
      }),
    },
    {
      name: "schedules the continuation with a fractional schedule.afterMs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const fractionalMs = 60_000.5;
        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "fractional-head",
                  input: null,
                },
              ],
            }),
          ),
        );

        const before = Date.now();
        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "fractional-child",
                  continueFromId: headChain.head.id,
                  input: null,
                  schedule: { afterMs: fractionalMs },
                },
              ],
            }),
          ),
        );

        const diff = continued!.continuation.scheduledAt.getTime() - before;
        assert.ok(diff >= fractionalMs - 1000);
        assert.ok(diff < fractionalMs + 1000);
      }),
    },
    {
      name: "round-trips a scalar JSON input on the continuation",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "head-scalar", input: null },
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
                  typeName: "child-scalar",
                  continueFromId: headChain.head.id,
                  input: "bare string",
                },
              ],
            }),
          ),
        );
        const { continuation } = continued!;

        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [continuation.id] }));
        assert.equal(stored!.input, "bare string");
      }),
    },
    {
      name: "completes the parent and links it to the continuation",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["head"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "head", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["head"],
            limit: 1,
          }),
        );

        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "child",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const { continuation } = continued!;

        const [headAfter] = yield* step(stateAdapter.getJobs({ jobIds: [headChain.head.id] }));
        assert.equal(headAfter!.continuedToId, continuation.id);
        assert.notEqual(headAfter!.completedAt, null);
        assert.equal(headAfter!.completedBy, null);
        assert.equal(headAfter!.attemptAt, null);
        assert.equal(headAfter!.attemptBy, null);
      }),
    },
    {
      name: "reports an undefined result for a non-existent parent",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "child",
                  continueFromId: "00000000-0000-0000-0000-000000000000",
                  input: null,
                },
              ],
            }),
          ),
        );

        assert.equal(results.length, 1);
        assert.equal(results[0], undefined);
      }),
    },
    {
      name: "reports an undefined result for an already-completed parent",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "completed-parent",
                  input: null,
                },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: headChain.head.id, output: { done: true } }],
            }),
          ),
        );

        const [completedParent] = yield* step(
          stateAdapter.getJobs({ jobIds: [headChain.head.id] }),
        );
        assert.notEqual(completedParent!.completedAt, null);

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "child-of-completed",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );

        assert.equal(results.length, 1);
        assert.equal(results[0], undefined);

        const chainJobs = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.equal(chainJobs.items.length, 1);
      }),
    },
    {
      name: "reports an undefined result for a second continuation from the same parent",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "head", input: null }],
            }),
          ),
        );

        const [continuedC1] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "child",
                  continueFromId: headChain.head.id,
                  input: { v: 1 },
                },
              ],
            }),
          ),
        );
        const { continuation: c1 } = continuedC1!;

        const [second] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "child",
                  continueFromId: headChain.head.id,
                  input: { v: 2 },
                },
              ],
            }),
          ),
        );

        assert.equal(second, undefined);

        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [c1.id] }));
        assert.deepEqual(stored!.input, { v: 1 });
      }),
    },
    {
      name: "lets only one of two concurrent continuations take a chain position",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "chain-head", input: null },
              ],
            }),
          ),
        );

        const results = yield* step(
          all(
            ["tx1", "tx2"].map((from) =>
              tryCatch(
                () =>
                  stateAdapter.withTransaction((txCtx) =>
                    stateAdapter.continueJobs({
                      txCtx,
                      jobs: [
                        {
                          id: stateAdapter.config.generateJobId(),
                          typeName: "chain-step2",
                          continueFromId: headChain.head.id,
                          input: { from },
                        },
                      ],
                    }),
                  ),
                () => undefined,
              ),
            ),
          ),
        );

        const continued = results.filter(
          (result) => result !== undefined && result[0] !== undefined,
        );
        assert.equal(continued.length, 1);

        const chainJobs = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.equal(chainJobs.items.length, 2);
      }),
    },
    {
      name: "continues several chains in one batch, in input order",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [chainA, chainB] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-head",
                  input: { n: 1 },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-head",
                  input: { n: 2 },
                },
              ],
            }),
          ),
        );

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-step",
                  continueFromId: chainA.head.id,
                  input: { n: 1 },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-step",
                  continueFromId: chainB.head.id,
                  input: { n: 2 },
                },
              ],
            }),
          ),
        );

        assert.equal(results.length, 2);
        assert.deepEqual(
          results.map((r) => r!.id),
          [chainA.head.id, chainB.head.id],
        );
        assert.equal(results[0]!.continuation.chainId, chainA.head.chainId);
        assert.equal(results[1]!.continuation.chainId, chainB.head.chainId);
        assert.equal(results[0]!.continuedToId, results[0]!.continuation.id);
        assert.equal(results[1]!.continuedToId, results[1]!.continuation.id);
        assert.ok(results[0]!.completedAt instanceof Date);
        assert.ok(results[1]!.completedAt instanceof Date);
      }),
    },
    {
      name: "rejects a batch that continues the same job twice",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-dup-head",
                  input: null,
                },
              ],
            }),
          ),
        );

        yield* step(
          assertRejects(() =>
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.continueJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "batch-dup-step",
                    continueFromId: stateChain.head.id,
                    input: { n: 1 },
                  },
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "batch-dup-step",
                    continueFromId: stateChain.head.id,
                    input: { n: 2 },
                  },
                ],
              }),
            ),
          ),
        );
      }),
    },
    {
      name: "reports an undefined result for a batch entry continuing a job the same batch creates",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-chain-head",
                  input: null,
                },
              ],
            }),
          ),
        );

        const successorId = stateAdapter.config.generateJobId();

        const results = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  typeName: "batch-chain-step",
                  id: successorId,
                  continueFromId: stateChain.head.id,
                  input: { n: 1 },
                },
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "batch-chain-step",
                  continueFromId: successorId,
                  input: { n: 2 },
                },
              ],
            }),
          ),
        );

        assert.notEqual(results[0], undefined);
        assert.equal(results[1], undefined);

        const [headAfter] = yield* step(stateAdapter.getJobs({ jobIds: [stateChain.head.id] }));
        assert.equal(headAfter!.continuedToId, successorId);

        const chainJobs = yield* step(
          stateAdapter.listChainJobs({
            chainId: stateChain.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.equal(chainJobs.items.length, 2);
      }),
    },
    {
      name: "extends a chain across multiple sequential continuations",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "t", input: null }],
            }),
          ),
        );
        assert.equal(headChain.head.id, headChain.head.chainId);
        assert.equal(headChain.head.chainIndex, 0);

        const [continuedCont1] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "t2",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const { continuation: cont1 } = continuedCont1!;
        assert.equal(cont1.chainId, headChain.head.chainId);
        assert.equal(cont1.chainIndex, 1);

        const [continuedCont2] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "t3",
                  continueFromId: cont1.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const { continuation: cont2 } = continuedCont2!;
        assert.equal(cont2.chainId, headChain.head.chainId);
        assert.equal(cont2.chainIndex, 2);
        assert.notEqual(cont2.id, cont1.id);
      }),
    },
    {
      name: "continues distinct parents independently",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "head", input: null }],
            }),
          ),
        );

        const [continuedExistingContinuation] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "step",
                  continueFromId: headChain.head.id,
                  input: { value: "first" },
                },
              ],
            }),
          ),
        );
        const { continuation: existingContinuation } = continuedExistingContinuation!;

        const [duplicate] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "step",
                  continueFromId: headChain.head.id,
                  input: { value: "duplicate" },
                },
              ],
            }),
          ),
        );

        assert.equal(duplicate, undefined);

        const [continuedNext] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "step",
                  continueFromId: existingContinuation.id,
                  input: { value: "new" },
                },
              ],
            }),
          ),
        );
        const { continuation: next } = continuedNext!;

        assert.equal(next.chainId, headChain.head.chainId);
      }),
    },
    {
      name: "caller-supplied id collision on continueJobs errors",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const sharedId = stateAdapter.config.generateJobId();

        const [chain1] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "head1", input: null }],
            }),
          ),
        );
        const [chain2] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "head2", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
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
          ),
        );

        yield* step(
          assertRejects(() =>
            stateAdapter.withTransaction((txCtx) =>
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
          ),
        );
      }),
    },
    {
      name: "continues a running job whose attempt token matches",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["continue-token-match"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continue-token-match",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [job] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["continue-token-match"],
            limit: 1,
          }),
        );

        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continue-token-match:next",
                  input: null,
                  continueFromId: job.id,
                  attemptToken: job.attemptToken!,
                  workerId: job.attemptBy!,
                },
              ],
            }),
          ),
        );

        assert.equal(continued!.status, "completed");
        assert.equal(continued!.completedBy, worker.id);
        assert.equal(continued!.attemptToken, null);
        assert.equal(continued!.continuation.attemptToken, null);
        assert.equal(continued!.continuedToId, continued!.continuation.id);
      }),
    },
    {
      name: "reports an undefined result for a token no attempt holds, inserting no successor",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["continue-token-unknown"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continue-token-unknown",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [job] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["continue-token-unknown"],
            limit: 1,
          }),
        );
        const [before] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));

        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continue-token-unknown:next",
                  input: null,
                  continueFromId: job.id,
                  attemptToken: crypto.randomUUID(),
                },
              ],
            }),
          ),
        );

        assert.equal(continued, undefined);
        const [after] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));
        assert.deepEqual(after, before);
        const chainJobs = yield* step(
          stateAdapter.listChainJobs({
            chainId: createdChain.id,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.equal(chainJobs.items.length, 1);
      }),
    },
    {
      name: "reports an undefined result for the token of an attempt the same worker has since replaced",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["continue-token-replaced"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [createdChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continue-token-replaced",
                  input: null,
                },
              ],
            }),
          ),
        );
        const [job] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["continue-token-replaced"],
            limit: 1,
          }),
        );
        yield* step(stateAdapter.rescheduleJobs({ jobs: [{ jobId: job.id }] }));
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["continue-token-replaced"],
            limit: 1,
          }),
        );
        const [before] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));

        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continue-token-replaced:next",
                  input: null,
                  continueFromId: job.id,
                  attemptToken: job.attemptToken!,
                  workerId: job.attemptBy!,
                },
              ],
            }),
          ),
        );

        assert.equal(continued, undefined);
        const [after] = yield* step(stateAdapter.getJobs({ jobIds: [createdChain.head.id] }));
        assert.deepEqual(after, before);
      }),
    },
    {
      name: "reports an undefined result for the token of an attempt whose chain was deleted and recreated under the same id",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["continue-token-recreated"],
            concurrency: 2,
            leaseMs: 60_000,
          }),
        );
        const chainId = stateAdapter.config.generateJobId();
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: chainId, typeName: "continue-token-recreated", input: null }],
            }),
          ),
        );
        const [job] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["continue-token-recreated"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.deleteChains({ txCtx, chainIds: [chainId] }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: chainId, typeName: "continue-token-recreated", input: null }],
            }),
          ),
        );
        const [recreated] = yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["continue-token-recreated"],
            limit: 1,
          }),
        );
        assert.equal(recreated.id, job.id);
        assert.equal(recreated.attempt, job.attempt);
        assert.equal(recreated.attemptBy, job.attemptBy);

        const [continued] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "continue-token-recreated:next",
                  input: null,
                  continueFromId: chainId,
                  attemptToken: job.attemptToken!,
                  workerId: job.attemptBy!,
                },
              ],
            }),
          ),
        );

        assert.equal(continued, undefined);
        const [stored] = yield* step(stateAdapter.getJobs({ jobIds: [chainId] }));
        assert.equal(stored!.status, "running");
        assert.equal(stored!.attemptToken, recreated.attemptToken);
      }),
    },
  ],
};
