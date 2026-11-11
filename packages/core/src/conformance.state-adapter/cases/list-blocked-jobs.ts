import assert from "node:assert/strict";

import { sleep } from "@queuert/helpers";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const listBlockedJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listBlockedJobs",
  cases: [
    {
      name: "listBlockedJobs returns jobs blocked by a chain",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocker-type", input: null },
            ],
          }),
        );
        const [blockedChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocked-type", input: null },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "unrelated-type", input: null },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const result = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });

        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].id, blockedChain.head.id);
      },
    },
    {
      name: "listBlockedJobs returns empty page when no jobs are blocked",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "test-type", input: null }],
          }),
        );
        const result = await stateAdapter.listBlockedJobs({
          chainId: stateChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        assert.deepEqual(result.items, []);
        assert.equal(result.nextCursor, null);
      },
    },
    {
      name: "listBlockedJobs sorts asc when orderDirection is asc",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocker-type", input: null },
            ],
          }),
        );
        const [blockedChain1] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocked-a", input: null }],
          }),
        );
        await sleep(5);
        const [blockedChain2] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "blocked-b", input: null }],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedChain1.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [
              { jobId: blockedChain2.head.id, blockedByChainIds: [blockerChain.head.chainId] },
            ],
          }),
        );

        const desc = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        const asc = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });

        assert.equal(desc.items.length, 2);
        assert.equal(asc.items.length, 2);
        assert.equal(desc.items[0].id, blockedChain2.head.id);
        assert.equal(desc.items[1].id, blockedChain1.head.id);
        assert.equal(asc.items[0].id, blockedChain1.head.id);
        assert.equal(asc.items[1].id, blockedChain2.head.id);
      },
    },
    {
      name: "listBlockedJobs paginates with cursor",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocker-type", input: null },
            ],
          }),
        );
        const blockedChains = [];
        for (let i = 0; i < 4; i++) {
          const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: `blocked-${i}`, input: null },
              ],
            }),
          );
          blockedChains.push(stateChain);
          await stateAdapter.withTransaction(async (txCtx) =>
            stateAdapter.addJobsBlockers({
              txCtx,
              jobBlockers: [
                { jobId: stateChain.head.id, blockedByChainIds: [blockerChain.head.chainId] },
              ],
            }),
          );
        }

        const page1 = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 2 },
        });
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);

        const page2 = await stateAdapter.listBlockedJobs({
          chainId: blockerChain.head.chainId,
          orderDirection: "desc",
          page: { limit: 2, cursor: page1.nextCursor! },
        });
        assert.equal(page2.items.length, 2);
        assert.equal(page2.nextCursor, null);

        const allIds = [
          ...page1.items.map((item) => item.id),
          ...page2.items.map((item) => item.id),
        ];
        assert.equal(new Set(allIds).size, 4);
      },
    },
    {
      name: "listBlockedJobs paginates jobs created at the same time by id in both directions",
      run: async ({ createStateAdapter }) => {
        await using stateAdapter = await createStateAdapter();

        const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              { id: stateAdapter.config.generateJobId(), typeName: "blocker-type", input: null },
            ],
          }),
        );
        const created = await stateAdapter.withTransaction(async (txCtx) => {
          const chains = await stateAdapter.createJobs({
            txCtx,
            jobs: [0, 1, 2].map(() => ({
              id: stateAdapter.config.generateJobId(),
              typeName: "same-time-blocked",
              input: null,
            })),
          });
          await stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: chains.map((chain) => ({
              jobId: chain.head.id,
              blockedByChainIds: [blockerChain.head.chainId],
            })),
          });
          return chains;
        });
        const [firstId, secondId, thirdId] = created.map((chain) => chain.head.id).toSorted();
        const listSameTimeBlockedJobs = async (orderDirection: "asc" | "desc", cursor?: string) =>
          stateAdapter.listBlockedJobs({
            chainId: blockerChain.head.chainId,
            orderDirection,
            page: { limit: 2, cursor },
          });

        const ascPage = await listSameTimeBlockedJobs("asc");
        assert.deepEqual(
          ascPage.items.map((job) => job.id),
          [firstId, secondId],
        );
        assert.deepEqual(
          (await listSameTimeBlockedJobs("asc", ascPage.nextCursor!)).items.map((job) => job.id),
          [thirdId],
        );

        const descPage = await listSameTimeBlockedJobs("desc");
        assert.deepEqual(
          descPage.items.map((job) => job.id),
          [thirdId, secondId],
        );
        assert.deepEqual(
          (await listSameTimeBlockedJobs("desc", descPage.nextCursor!)).items.map((job) => job.id),
          [firstId],
        );
      },
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

          const [blockerChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
          const [targetChain] = await stateAdapter.withTransaction(async (txCtx) =>
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
