import assert from "node:assert/strict";

import { caseBody, resource } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import type { ConformanceGroup } from "../../conformance/runner.ts";
import type { StateAdapterConformanceContext } from "../types.ts";

export const listChainJobsGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "listChainJobs",
  cases: [
    {
      name: "returns empty page for nonexistent chain",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const result = yield* step(
          stateAdapter.listChainJobs({
            chainId: crypto.randomUUID(),
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.deepEqual(result.items, []);
        assert.equal(result.nextCursor, null);
      }),
    },
    {
      name: "returns jobs in chain order asc by default",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "step-1", input: null }],
            }),
          ),
        );
        const [continuedStep2] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "step-2",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );
        const { continuation: step2 } = continuedStep2!;
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "step-3",
                  continueFromId: step2.id,
                  input: null,
                },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.head.chainId,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.equal(result.items.length, 3);
        assert.equal(result.items[0].typeName, "step-1");
        assert.equal(result.items[1].typeName, "step-2");
        assert.equal(result.items[2].typeName, "step-3");
        assert.deepEqual(
          result.items.map((item) => item.chainIndex),
          [0, 1, 2],
        );
        assert.deepEqual(
          result.items.map((item) => item.chain.id),
          [headChain.head.chainId, headChain.head.chainId, headChain.head.chainId],
        );
        assert.equal(result.items[0].chain.typeName, "step-1");
      }),
    },
    {
      name: "respects orderDirection desc",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "step-1", input: null }],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.continueJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "step-2",
                  continueFromId: headChain.head.id,
                  input: null,
                },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.head.chainId,
            orderDirection: "desc",
            page: { limit: 10 },
          }),
        );
        assert.equal(result.items.length, 2);
        assert.equal(result.items[0].typeName, "step-2");
        assert.equal(result.items[1].typeName, "step-1");
        assert.deepEqual(
          result.items.map((item) => item.chainIndex),
          [1, 0],
        );
      }),
    },
    {
      name: "paginates with cursor",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "step-0", input: null }],
            }),
          ),
        );
        let prevId = headChain.head.id;
        for (let i = 1; i < 5; i++) {
          const [continuedNext] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.continueJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: `step-${i}`,
                    continueFromId: prevId,
                    input: null,
                  },
                ],
              }),
            ),
          );
          const { continuation: next } = continuedNext!;
          prevId = next.id;
        }

        const page1 = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.head.chainId,
            orderDirection: "asc",
            page: { limit: 2 },
          }),
        );
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);
        assert.equal(page1.items[0].typeName, "step-0");
        assert.equal(page1.items[1].typeName, "step-1");
        assert.deepEqual(
          page1.items.map((item) => item.chainIndex),
          [0, 1],
        );

        const page2 = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.head.chainId,
            orderDirection: "asc",
            page: { limit: 2, cursor: page1.nextCursor! },
          }),
        );
        assert.equal(page2.items.length, 2);
        assert.notEqual(page2.nextCursor, null);
        assert.equal(page2.items[0].typeName, "step-2");
        assert.equal(page2.items[1].typeName, "step-3");
        assert.deepEqual(
          page2.items.map((item) => item.chainIndex),
          [2, 3],
        );

        const page3 = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.head.chainId,
            orderDirection: "asc",
            page: { limit: 2, cursor: page2.nextCursor! },
          }),
        );
        assert.equal(page3.items.length, 1);
        assert.equal(page3.nextCursor, null);
      }),
    },
    {
      name: "paginates with cursor in desc order",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [headChain] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "step-0", input: null }],
            }),
          ),
        );
        let prevId = headChain.head.id;
        for (let i = 1; i < 5; i++) {
          const [continuedNext] = yield* step(
            stateAdapter.withTransaction((txCtx) =>
              stateAdapter.continueJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: `step-${i}`,
                    continueFromId: prevId,
                    input: null,
                  },
                ],
              }),
            ),
          );
          const { continuation: next } = continuedNext!;
          prevId = next.id;
        }

        const page1 = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.head.chainId,
            orderDirection: "desc",
            page: { limit: 2 },
          }),
        );
        assert.equal(page1.items.length, 2);
        assert.notEqual(page1.nextCursor, null);
        assert.equal(page1.items[0].typeName, "step-4");
        assert.equal(page1.items[1].typeName, "step-3");

        const page2 = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.head.chainId,
            orderDirection: "desc",
            page: { limit: 2, cursor: page1.nextCursor! },
          }),
        );
        assert.equal(page2.items.length, 2);
        assert.notEqual(page2.nextCursor, null);
        assert.equal(page2.items[0].typeName, "step-2");
        assert.equal(page2.items[1].typeName, "step-1");

        const page3 = yield* step(
          stateAdapter.listChainJobs({
            chainId: headChain.head.chainId,
            orderDirection: "desc",
            page: { limit: 2, cursor: page2.nextCursor! },
          }),
        );
        assert.equal(page3.items.length, 1);
        assert.equal(page3.items[0].typeName, "step-0");
        assert.equal(page3.nextCursor, null);
      }),
    },
    {
      name: "only returns jobs from specified chain",
      run: caseBody(function* ({ createStateAdapter }) {
        const stateAdapter = yield* resource(createStateAdapter());

        const [chain1] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [{ id: stateAdapter.config.generateJobId(), typeName: "step-1", input: null }],
            }),
          ),
        );
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                { id: stateAdapter.config.generateJobId(), typeName: "other-type", input: null },
              ],
            }),
          ),
        );

        const result = yield* step(
          stateAdapter.listChainJobs({
            chainId: chain1.head.chainId,
            orderDirection: "asc",
            page: { limit: 10 },
          }),
        );
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].id, chain1.head.id);
      }),
    },
  ],
};

export const listChainJobsConcurrentTransactionsGroup: ConformanceGroup<StateAdapterConformanceContext> =
  {
    name: "listChainJobs",
    cases: [
      {
        name: "non-transactional listChainJobs does not observe an uncommitted continuation",
        run: async ({ createStateAdapter }) => {
          await using stateAdapter = await createStateAdapter();

          const [seedChain] = await stateAdapter.withTransaction((txCtx) =>
            stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  id: stateAdapter.config.generateJobId(),
                  typeName: "iso-chain-jobs-head",
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
              await stateAdapter.continueJobs({
                txCtx,
                jobs: [
                  {
                    id: stateAdapter.config.generateJobId(),
                    typeName: "iso-chain-jobs-cont",
                    continueFromId: seedChain.head.id,
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
          const listPromise = stateAdapter.listChainJobs({
            chainId: seedChain.head.chainId,
            orderDirection: "asc",
            page: { limit: 10 },
          });
          release!();
          await txPromise;

          const { items } = await listPromise;
          assert.equal(items.length, 1);
          assert.equal(items[0]?.id, seedChain.head.id);
        },
      },
    ],
  };
