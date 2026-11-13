import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import { inTransaction as inTransactionOf } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const listChainsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listChains",
  cases: [
    {
      name: "listChains returns empty page when no jobs exist",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(result.items, []);
        assert.equal(result.nextCursor, null);
      }),
    },
    {
      name: "listChains filters independent (excludes chains used as blockers)",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: mainChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        const independentOnly = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            independent: true,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(independentOnly.items.length, 1);
        assert.equal(independentOnly.items[0].head.id, mainChain.head.id);

        const all = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(all.items.length, 2);
      }),
    },
    {
      name: "listChains returns chains as [headJob, tailJob] pairs",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "test-chain",
                  input: { step: 1 },
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
                  typeName: "test-chain-step2",
                  continueFromId: headChain.head.id,
                  input: { step: 2 },
                },
              ],
            }),
          ),
        );
        const { continuation } = continued!;

        const result = yield* step(
          stateAdapter.listChains({
            typeName: "test-chain",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(result.items.length, 1);

        const { head: headJob, tail: tailJob } = result.items[0];
        assert.equal(headJob.id, headChain.head.id);
        assert.notEqual(tailJob, undefined);
        assert.equal(tailJob!.id, continuation.id);
      }),
    },
    {
      name: "listChains sorts by createdAt desc by default",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [chain1] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "task", input: { order: 1 } },
              ],
            }),
          ),
        );
        yield* wait(sleep(5));
        const [chain2] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "task", input: { order: 2 } },
              ],
            }),
          ),
        );
        yield* wait(sleep(5));
        const [chain3] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "task", input: { order: 3 } },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(result.items.length, 3);
        assert.equal(result.items[0].head.id, chain3.head.id);
        assert.equal(result.items[1].head.id, chain2.head.id);
        assert.equal(result.items[2].head.id, chain1.head.id);
      }),
    },
    {
      name: "listChains paginates with cursor",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const jobs = [];
        for (let i = 0; i < 5; i++) {
          const [stateChain] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
              }),
            ),
          );
          jobs.push(stateChain);
        }

        const page1 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 2 },
          }),
        );
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 2, cursor: page1.nextCursor! },
          }),
        );
        assert.equal(page2.items.length, 2);
        assert.notEqual(page2.nextCursor, null);

        const page3 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 2, cursor: page2.nextCursor! },
          }),
        );
        assert.equal(page3.items.length, 1);
        assert.equal(page3.nextCursor, null);

        const allIds = [
          ...page1.items.map(({ head }) => head.id),
          ...page2.items.map(({ head }) => head.id),
          ...page3.items.map(({ head }) => head.id),
        ];
        assert.equal(new Set(allIds).size, 5);
      }),
    },
    {
      name: "listChains sorts asc when orderDirection is asc",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [chain1] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        yield* wait(sleep(5));
        const [chain2] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.equal(result.items.length, 2);
        assert.equal(result.items[0].head.id, chain1.head.id);
        assert.equal(result.items[1].head.id, chain2.head.id);
      }),
    },
    {
      name: "listChains paginates correctly in asc order",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        for (let i = 0; i < 3; i++) {
          yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
              }),
            ),
          );
          yield* wait(sleep(5));
        }

        const page1 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            orderDirection: "asc",
            page: { limit: 2 },
          }),
        );
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            orderDirection: "asc",
            page: { limit: 2, cursor: page1.nextCursor! },
          }),
        );
        assert.equal(page2.items.length, 1);
        assert.equal(page2.nextCursor, null);

        const allIds = [
          ...page1.items.map(({ head }) => head.id),
          ...page2.items.map(({ head }) => head.id),
        ];
        assert.equal(new Set(allIds).size, 3);
      }),
    },
    {
      name: "listChains filters by from/to date range",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [chainA] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        yield* wait(sleep(50));
        const [chainB] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        const midpoint = new Date((chainA.createdAt.getTime() + chainB.createdAt.getTime()) / 2);

        const after = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            from: midpoint,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(after.items.length, 1);
        assert.equal(after.items[0].head.id, chainB.head.id);

        const before = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            to: midpoint,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(before.items.length, 1);
        assert.equal(before.items[0].head.id, chainA.head.id);
      }),
    },
    {
      name: "listChains sorts completed chains by completedAt when orderBy is completedAt",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [chainA] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        yield* wait(sleep(5));
        const [chainB] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        // Start both jobs (oldest first)
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task"],
            limit: 1,
          }),
        );

        // Complete chainB first, then chainA, to get different completedAt order
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: chainB.id, output: null }],
            }),
          ),
        );
        yield* wait(sleep(5));

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: chainA.id, output: null }],
            }),
          ),
        );

        const byCreatedAt = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(byCreatedAt.items[0].head.id, chainB.id);
        assert.equal(byCreatedAt.items[1].head.id, chainA.id);

        const byCompletedAt = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(byCompletedAt.items[0].head.id, chainA.id);
        assert.equal(byCompletedAt.items[1].head.id, chainB.id);
      }),
    },
    {
      name: "listChains paginates completed chains with createdAt ordering",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const chainIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const [stateChain] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
              }),
            ),
          );
          chainIds.push(stateChain.head.id);
          yield* wait(sleep(5));
        }

        for (const id of chainIds) {
          yield* step(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["task"],
              limit: 1,
            }),
          );
          yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: id, output: null }],
              }),
            ),
          );
        }

        const page1 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 2 },
          }),
        );
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);
        assert.equal(page1.items[0].head.id, chainIds[2]);
        assert.equal(page1.items[1].head.id, chainIds[1]);

        const page2 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 2, cursor: page1.nextCursor! },
          }),
        );
        assert.equal(page2.items.length, 1);
        assert.equal(page2.nextCursor, null);
        assert.equal(page2.items[0].head.id, chainIds[0]);

        const allIds = [
          ...page1.items.map(({ head }) => head.id),
          ...page2.items.map(({ head }) => head.id),
        ];
        assert.equal(new Set(allIds).size, 3);
      }),
    },
    {
      name: "listChains paginates correctly with completedAt ordering",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const chainIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const [stateChain] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
              }),
            ),
          );
          chainIds.push(stateChain.head.id);
        }

        for (const id of chainIds) {
          yield* step(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["task"],
              limit: 1,
            }),
          );
          yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: id, output: null }],
              }),
            ),
          );
          yield* wait(sleep(5));
        }

        const page1 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 2 },
          }),
        );
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 2, cursor: page1.nextCursor! },
          }),
        );
        assert.equal(page2.items.length, 1);
        assert.equal(page2.nextCursor, null);

        const allIds = [
          ...page1.items.map(({ head }) => head.id),
          ...page2.items.map(({ head }) => head.id),
        ];
        assert.equal(new Set(allIds).size, 3);
      }),
    },
    {
      name: "listChains filters by status",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["test-type"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [chain1] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "test-type", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "test-type", input: null },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["test-type"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: chain1.id, output: null }],
            }),
          ),
        );

        const completed = yield* step(
          stateAdapter.listChains({
            typeName: "test-type",
            orderBy: "completedAt",
            status: "completed",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(completed.items.length, 1);
        assert.equal(completed.items[0].head.id, chain1.id);

        const running = yield* step(
          stateAdapter.listChains({
            typeName: "test-type",
            orderBy: "createdAt",
            status: "running",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(running.items.length, 1);
      }),
    },
    {
      name: "listChains filters by non-independent",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            }),
          ),
        );

        const nonIndependent = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            independent: false,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(nonIndependent.items.length, 1);
        assert.equal(nonIndependent.items[0].head.id, blockerChain.id);

        const independent = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            independent: true,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(independent.items.length, 1);
        assert.equal(independent.items[0].head.id, mainChain.id);
      }),
    },
    {
      name: "listChains paginates non-independent chains and sees blockers added in the transaction",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        function* createChain(typeName: string) {
          const [chain] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ id: stateAdapter.config.generateJobId(), typeName, input: null }],
              }),
            ),
          );
          return chain;
        }

        const mainChain = yield* createChain("task");
        const blockerChains: (typeof mainChain)[] = [];
        for (let index = 0; index < 4; index++) blockerChains.push(yield* createChain("task"));
        const otherTypeBlocker = yield* createChain("other");

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                {
                  jobId: mainChain.head.id,
                  blockedByChainIds: [...blockerChains, otherTypeBlocker].map((chain) => chain.id),
                },
              ],
            }),
          ),
        );

        const pagedIds: string[] = [];
        const pageSizes: number[] = [];
        let cursor: string | undefined;
        do {
          const page = yield* step(
            stateAdapter.listChains({
              typeName: "task",
              orderBy: "createdAt",
              independent: false,
              orderDirection: "desc",
              page: { limit: 2, cursor },
            }),
          );
          pagedIds.push(...page.items.map((item) => item.head.id));
          pageSizes.push(page.items.length);
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined && pageSizes.length < 5);
        assert.deepEqual(pageSizes, [2, 2]);
        assert.deepEqual(pagedIds.toSorted(), blockerChains.map((chain) => chain.id).toSorted());

        const future = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            orderBy: "createdAt",
            independent: false,
            from: new Date(Date.now() + 3_600_000),
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(future.items.length, 0);

        const inTransaction = yield* step(
          inTransactionOf(stateAdapter, function* (txCtx) {
            const [lateBlocker] = yield* step(
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
              }),
            );
            yield* step(
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [lateBlocker.id] }],
              }),
            );
            const listed = yield* step(
              stateAdapter.listChains({
                txCtx,
                typeName: "task",
                orderBy: "createdAt",
                independent: false,
                orderDirection: "desc",
                page: { limit: 10 },
              }),
            );
            return { lateBlockerId: lateBlocker.id, ids: listed.items.map((item) => item.head.id) };
          }),
        );
        assert.equal(inTransaction.ids.length, 5);
        assert.ok(inTransaction.ids.includes(inTransaction.lateBlockerId));
      }),
    },
    {
      name: "listChains filters running by independent",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        const [otherChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            }),
          ),
        );

        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task"],
            limit: 1,
          }),
        );

        const independent = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "running",
            independent: true,
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(independent.items.length, 2);
        const independentIds = independent.items.map(({ head }) => head.id).sort();
        assert.deepEqual(independentIds, [mainChain.id, otherChain.id].sort());

        const nonIndependent = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "running",
            independent: false,
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(nonIndependent.items.length, 1);
        assert.equal(nonIndependent.items[0].head.id, blockerChain.id);
      }),
    },
    {
      name: "listChains filters running by non-independent",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            }),
          ),
        );

        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task"],
            limit: 1,
          }),
        );

        const result = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "running",
            independent: false,
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].head.id, blockerChain.id);
      }),
    },
    {
      name: "listChains paginates running chains with cursor",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const chainIds: string[] = [];
        for (let i = 0; i < 4; i++) {
          const [stateChain] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
              }),
            ),
          );
          chainIds.push(stateChain.head.id);
          yield* wait(sleep(5));
        }

        for (let i = 0; i < 4; i++) {
          yield* step(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["task"],
              limit: 1,
            }),
          );
        }

        const page1 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "running",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 2 },
          }),
        );
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "running",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 2, cursor: page1.nextCursor! },
          }),
        );
        assert.equal(page2.items.length, 2);
        assert.equal(page2.nextCursor, null);

        const allIds = [
          ...page1.items.map(({ head }) => head.id),
          ...page2.items.map(({ head }) => head.id),
        ];
        assert.equal(new Set(allIds).size, 4);
      }),
    },
    {
      name: "listChains filters completed by independent",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        const [otherChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            }),
          ),
        );

        for (const id of [mainChain.id, blockerChain.id, otherChain.id]) {
          yield* step(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["task"],
              limit: 1,
            }),
          );
          yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: id, output: null }],
              }),
            ),
          );
        }

        const independent = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            independent: true,
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(independent.items.length, 2);
        const independentIds = independent.items.map(({ head }) => head.id).sort();
        assert.deepEqual(independentIds, [mainChain.id, otherChain.id].sort());

        const nonIndependent = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            independent: false,
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(nonIndependent.items.length, 1);
        assert.equal(nonIndependent.items[0].head.id, blockerChain.id);
      }),
    },
    {
      name: "listChains filters completed by non-independent",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [mainChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [{ jobId: mainChain.head.id, blockedByChainIds: [blockerChain.id] }],
            }),
          ),
        );

        for (const id of [mainChain.id, blockerChain.id]) {
          yield* step(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["task"],
              limit: 1,
            }),
          );
          yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: id, output: null }],
              }),
            ),
          );
        }

        const result = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            independent: false,
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].head.id, blockerChain.id);
      }),
    },
    {
      name: "listChains paginates completed chains with completedAt cursor",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const chainIds: string[] = [];
        for (let i = 0; i < 4; i++) {
          const [stateChain] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
              }),
            ),
          );
          chainIds.push(stateChain.head.id);
        }

        for (let i = 0; i < 4; i++) {
          yield* step(
            stateAdapter.startJobAttempts({
              workerId: worker.id,
              workerToken: worker.token,
              typeNames: ["task"],
              limit: 1,
            }),
          );
          yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.completeJobs({
                txCtx,
                jobs: [{ jobId: chainIds[i], output: null }],
              }),
            ),
          );
          yield* wait(sleep(5));
        }

        const page1 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 2 },
          }),
        );
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 2, cursor: page1.nextCursor! },
          }),
        );
        assert.equal(page2.items.length, 2);
        assert.equal(page2.nextCursor, null);

        const allIds = [
          ...page1.items.map(({ head }) => head.id),
          ...page2.items.map(({ head }) => head.id),
        ];
        assert.equal(new Set(allIds).size, 4);
      }),
    },
    {
      name: "listChains uses tail job completedAt for multi-job chain ordering",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const worker = yield* step(
          stateAdapter.startWorker({
            workerId: stateAdapter.config.generateWorkerId(),
            typeNames: ["task", "task-step2"],
            concurrency: 1,
            leaseMs: 60_000,
          }),
        );
        const [chainA] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );
        yield* wait(sleep(5));
        const [chainB] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "task", input: null }],
            }),
          ),
        );

        // Start headA (oldest pending "task")
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task"],
            limit: 1,
          }),
        );
        const [continuedTailA] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "task-step2",
                  continueFromId: chainA.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const { continuation: tailA } = continuedTailA!;

        // Start headB (next pending "task")
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: chainB.head.id, output: null }],
            }),
          ),
        );
        yield* wait(sleep(5));

        // chainB is completed (single job done), chainA is still running (tail pending)
        const completedBeforeTail = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(completedBeforeTail.items.length, 1);
        assert.equal(completedBeforeTail.items[0].head.id, chainB.head.id);

        const running = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "running",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(
          running.items.some(({ head }) => head.id === chainA.head.id),
          true,
        );

        // Now complete chainA's tail — it should appear in completed with a later completedAt
        yield* step(
          stateAdapter.startJobAttempts({
            workerId: worker.id,
            workerToken: worker.token,
            typeNames: ["task-step2"],
            limit: 1,
          }),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.completeJobs({
              txCtx,
              jobs: [{ jobId: tailA.id, output: null }],
            }),
          ),
        );

        const completedAfterTail = yield* step(
          stateAdapter.listChains({
            typeName: "task",
            status: "completed",
            orderBy: "completedAt",
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(completedAfterTail.items.length, 2);
        // chainA completed last (tail finished after chainB), so it should be first in desc order
        assert.equal(completedAfterTail.items[0].head.id, chainA.head.id);
        assert.equal(completedAfterTail.items[1].head.id, chainB.head.id);
      }),
    },
    {
      name: "listChains paginates chains created at the same time by id in both directions",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const created = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [0, 1, 2].map(() => ({
                id: stateAdapter.config.generateJobId(),
                typeName: "same-time-chain",
                input: null,
              })),
            }),
          ),
        );
        const [firstId, secondId, thirdId] = created.map((chain) => chain.id).toSorted();
        const listSameTimeChains = (orderDirection: "asc" | "desc", cursor?: string) =>
          stateAdapter.listChains({
            typeName: "same-time-chain",
            orderBy: "createdAt",
            orderDirection,
            page: { limit: 2, cursor },
          });

        const ascPage = yield* step(listSameTimeChains("asc"));
        assert.deepEqual(
          ascPage.items.map((chain) => chain.id),
          [firstId, secondId],
        );
        assert.deepEqual(
          (yield* step(listSameTimeChains("asc", ascPage.nextCursor!))).items.map(
            (chain) => chain.id,
          ),
          [thirdId],
        );

        const descPage = yield* step(listSameTimeChains("desc"));
        assert.deepEqual(
          descPage.items.map((chain) => chain.id),
          [thirdId, secondId],
        );
        assert.deepEqual(
          (yield* step(listSameTimeChains("desc", descPage.nextCursor!))).items.map(
            (chain) => chain.id,
          ),
          [firstId],
        );
      }),
    },
  ],
};

export const listChainsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "listChains",
    cases: [
      {
        name: "non-transactional listChains does not observe an uncommitted chain creation",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

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
              await stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "iso-list-chains",
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
          const listPromise = stateAdapter.listChains({
            typeName: "iso-list-chains",
            orderBy: "createdAt",
            orderDirection: "desc",
            page: { limit: 10 },
          });
          release!();
          await txPromise;

          const { items } = await listPromise;
          assert.equal(items.length, 0);
        },
      },
    ],
  };
