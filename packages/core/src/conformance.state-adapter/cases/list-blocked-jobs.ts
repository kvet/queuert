import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { sleep } from "@queuert/helpers/sleep";
import { step } from "@queuert/helpers/steps";

import { inTransaction } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const listBlockedJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listBlockedJobs",
  cases: [
    {
      name: "listBlockedJobs returns jobs blocked by a chain",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker-type", input: null },
              ],
            }),
          ),
        );
        const [blockedChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocked-type", input: null },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "unrelated-type",
                  input: null,
                },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.listBlockedJobs({
            chainId: blockerChain.head.chainId,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );

        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].id, blockedChain.head.id);
      }),
    },
    {
      name: "listBlockedJobs returns empty page when no jobs are blocked",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [stateChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "test-type", input: null },
              ],
            }),
          ),
        );
        const result = yield* step(
          stateAdapter.listBlockedJobs({
            chainId: stateChain.head.chainId,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(result.items, []);
        assert.equal(result.nextCursor, null);
      }),
    },
    {
      name: "listBlockedJobs sorts asc when orderDirection is asc",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker-type", input: null },
              ],
            }),
          ),
        );
        const [blockedChain1] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocked-a", input: null },
              ],
            }),
          ),
        );
        yield* wait(sleep(5));
        const [blockedChain2] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocked-b", input: null },
              ],
            }),
          ),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: blockedChain1.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: blockedChain2.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          ),
        );

        const desc = yield* step(
          stateAdapter.listBlockedJobs({
            chainId: blockerChain.head.chainId,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        const asc = yield* step(
          stateAdapter.listBlockedJobs({
            chainId: blockerChain.head.chainId,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );

        assert.equal(desc.items.length, 2);
        assert.equal(asc.items.length, 2);
        assert.equal(desc.items[0].id, blockedChain2.head.id);
        assert.equal(desc.items[1].id, blockedChain1.head.id);
        assert.equal(asc.items[0].id, blockedChain1.head.id);
        assert.equal(asc.items[1].id, blockedChain2.head.id);
      }),
    },
    {
      name: "listBlockedJobs paginates with cursor",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker-type", input: null },
              ],
            }),
          ),
        );
        const blockedChains = [];
        for (let i = 0; i < 4; i++) {
          const [stateChain] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.createJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: `blocked-${i}`,
                    input: null,
                  },
                ],
              }),
            ),
          );
          blockedChains.push(stateChain);
          yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [
                  { jobId: stateChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
                ],
              }),
            ),
          );
        }

        const page1 = yield* step(
          stateAdapter.listBlockedJobs({
            chainId: blockerChain.head.chainId,
            orderDirection: "desc",
            page: { limit: 2 },
          }),
        );
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = yield* step(
          stateAdapter.listBlockedJobs({
            chainId: blockerChain.head.chainId,
            orderDirection: "desc",
            page: { limit: 2, cursor: page1.nextCursor! },
          }),
        );
        assert.equal(page2.items.length, 2);
        assert.equal(page2.nextCursor, null);

        const allIds = [
          ...page1.items.map((item) => item.id),
          ...page2.items.map((item) => item.id),
        ];
        assert.equal(new Set(allIds).size, 4);
      }),
    },
    {
      name: "listBlockedJobs paginates jobs created at the same time by id in both directions",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [blockerChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "blocker-type", input: null },
              ],
            }),
          ),
        );
        const created = yield* step(
          inTransaction(stateAdapter, function* (txCtx) {
            const chains = yield* step(
              stateAdapter.createJobs({
                txCtx,
                jobs: [0, 1, 2].map(() => ({
                  id: stateAdapter.config.generateJobId(),
                  typeName: "same-time-blocked",
                  input: null,
                })),
              }),
            );
            yield* step(
              stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: chains.map((chain) => ({
                  jobId: chain.head.id,
                  blockedByChainIds: [blockerChain.head.chainId],
                })),
              }),
            );
            return chains;
          }),
        );
        const [firstId, secondId, thirdId] = created.map((chain) => chain.head.id).toSorted();
        const listSameTimeBlockedJobs = (orderDirection: "asc" | "desc", cursor?: string) =>
          stateAdapter.listBlockedJobs({
            chainId: blockerChain.head.chainId,
            orderDirection,
            page: { limit: 2, cursor },
          });

        const ascPage = yield* step(listSameTimeBlockedJobs("asc"));
        assert.deepEqual(
          ascPage.items.map((job) => job.id),
          [firstId, secondId],
        );
        assert.deepEqual(
          (yield* step(listSameTimeBlockedJobs("asc", ascPage.nextCursor!))).items.map(
            (job) => job.id,
          ),
          [thirdId],
        );

        const descPage = yield* step(listSameTimeBlockedJobs("desc"));
        assert.deepEqual(
          descPage.items.map((job) => job.id),
          [thirdId, secondId],
        );
        assert.deepEqual(
          (yield* step(listSameTimeBlockedJobs("desc", descPage.nextCursor!))).items.map(
            (job) => job.id,
          ),
          [firstId],
        );
      }),
    },
  ],
};

export const listBlockedJobsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "listBlockedJobs",
    cases: [
      {
        name: "non-transactional listBlockedJobs does not observe an uncommitted blocker insert",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [blockerChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "iso-listblocked-src",
                  input: null,
                },
              ],
            }),
          );
          const [targetChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "iso-listblocked-target",
                  input: null,
                },
              ],
            }),
          );

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
              await stateAdapter.addJobsBlockers({
                txCtx,
                jobBlockers: [
                  { jobId: targetChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
                ],
              });
              signalTxReady!();
              await gate;
              throw new Error("rollback");
            })
            .catch(() => {});

          await txReady;
          const listPromise = stateAdapter.listBlockedJobs({
            chainId: blockerChain.head.chainId,
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
