import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getChainsByDeduplicationGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getChainsByDeduplication",
  cases: [
    {
      name: "resolves chains by deduplication, positionally and scoped to the chain type",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: alive }, { job: other }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read",
                chainTypeName: "dedup-read",
                input: null,
                deduplication: { key: "conformance-key", scope: "running" },
              },
              {
                typeName: "dedup-read-other",
                chainTypeName: "dedup-read-other",
                input: null,
                deduplication: { key: "conformance-key", scope: "running" },
              },
            ],
          }),
        );

        const resolved = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read",
          deduplications: [
            { key: "conformance-key", scope: "running" },
            { key: "absent-key", scope: "running" },
            { key: "conformance-key", scope: "any" },
            { key: "conformance-key", scope: "running", excludeChainIds: [alive.chainId] },
            { key: "conformance-key", scope: "any", windowMs: 60_000 },
          ],
        });

        expect(resolved.map((chain) => chain?.[0].id)).toEqual([
          alive.id,
          undefined,
          alive.id,
          undefined,
          alive.id,
        ]);

        // The same key under another chain type resolves to that type's own chain.
        const [otherTyped] = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-other",
          deduplications: [{ key: "conformance-key", scope: "running" }],
        });
        expect(otherTyped?.[0].id).toBe(other.id);
        expect(other.id).not.toBe(alive.id);
      },
    },
    {
      name: "by-deduplication scope 'running' skips completed chains, 'any' resolves them",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read-scope",
                chainTypeName: "dedup-read-scope",
                input: null,
                deduplication: { key: "dedup-read-scope-key", scope: "running" },
              },
            ],
          }),
        );

        const beforeCompletion = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-scope",
          deduplications: [
            { key: "dedup-read-scope-key", scope: "running" },
            { key: "dedup-read-scope-key", scope: "any" },
          ],
        });
        expect(beforeCompletion.map((chain) => chain?.[0].id)).toEqual([root.id, root.id]);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: root.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const afterCompletion = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-scope",
          deduplications: [
            { key: "dedup-read-scope-key", scope: "running" },
            { key: "dedup-read-scope-key", scope: "any" },
          ],
        });
        expect(afterCompletion.map((chain) => chain?.[0].id)).toEqual([undefined, root.id]);
      },
    },
    {
      name: "by-deduplication scope 'running' resolves multi-step chains that have continued",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read-multi",
                chainTypeName: "dedup-read-multi",
                input: null,
                deduplication: { key: "dedup-read-multi-key", scope: "running" },
              },
            ],
          }),
        );

        const { job: step2 } = await stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.startJobAttempt({
            txCtx,
            workerId: "worker-1",
            typeNames: ["dedup-read-multi"],
          });
          const continuation = await stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "dedup-read-multi-step2",
              input: null,
              continueFromId: root.id,
            },
          });
          await stateAdapter.finishJobAttempt({
            txCtx,
            jobId: root.id,
            workerId: "worker-1",
            outcome: { continuedToId: continuation.job.id },
          });
          return continuation;
        });

        // The root is completed but the chain is not — `running` still resolves it.
        const [midChain] = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-multi",
          deduplications: [{ key: "dedup-read-multi-key", scope: "running" }],
        });
        expect(midChain?.[0].id).toBe(root.id);
        expect(midChain?.[1]?.id).toBe(step2.id);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: step2.id,
            workerId: "worker-1",
            outcome: { output: null },
          }),
        );

        const afterComplete = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-multi",
          deduplications: [
            { key: "dedup-read-multi-key", scope: "running" },
            { key: "dedup-read-multi-key", scope: "any" },
          ],
        });
        expect(afterComplete.map((chain) => chain?.[0].id)).toEqual([undefined, root.id]);
      },
    },
    {
      name: "by-deduplication scope 'running' resolves the running chain when a newer completed chain shares the key",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: running }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read-coexist",
                chainTypeName: "dedup-read-coexist",
                input: null,
                deduplication: { key: "dedup-read-coexist-key", scope: "running" },
              },
            ],
          }),
        );

        await sleep(50);

        // Excluded from dedup so it starts a fresh chain, making the completed chain the
        // newer of the two — `running` must still resolve the older, alive one.
        const [{ job: completed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read-coexist",
                chainTypeName: "dedup-read-coexist",
                input: null,
                deduplication: {
                  key: "dedup-read-coexist-key",
                  scope: "running",
                  excludeChainIds: [running.chainId],
                },
              },
            ],
          }),
        );
        expect(completed.id).not.toBe(running.id);

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: completed.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        const resolved = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-coexist",
          deduplications: [
            { key: "dedup-read-coexist-key", scope: "running" },
            { key: "dedup-read-coexist-key", scope: "any" },
          ],
        });
        expect(resolved.map((chain) => chain?.[0].id)).toEqual([running.id, completed.id]);
      },
    },
    {
      name: "by-deduplication excludeChainIds falls through to the next match",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: older }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read-exclude",
                chainTypeName: "dedup-read-exclude",
                input: null,
                deduplication: { key: "dedup-read-exclude-key", scope: "running" },
              },
            ],
          }),
        );

        await sleep(50);

        const [{ job: newer }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read-exclude",
                chainTypeName: "dedup-read-exclude",
                input: null,
                deduplication: {
                  key: "dedup-read-exclude-key",
                  scope: "running",
                  excludeChainIds: [older.chainId],
                },
              },
            ],
          }),
        );
        expect(newer.id).not.toBe(older.id);

        const resolved = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-exclude",
          deduplications: [
            { key: "dedup-read-exclude-key", scope: "running" },
            { key: "dedup-read-exclude-key", scope: "running", excludeChainIds: [newer.chainId] },
            {
              key: "dedup-read-exclude-key",
              scope: "running",
              excludeChainIds: [newer.chainId, older.chainId],
            },
          ],
        });
        expect(resolved.map((chain) => chain?.[0].id)).toEqual([newer.id, older.id, undefined]);
      },
    },
    {
      name: "by-deduplication windowMs matches only within the time window",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read-window",
                chainTypeName: "dedup-read-window",
                input: null,
                deduplication: { key: "dedup-read-window-key", scope: "any" },
              },
            ],
          }),
        );

        const [withinWindow] = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-window",
          deduplications: [{ key: "dedup-read-window-key", scope: "any", windowMs: 100 }],
        });
        expect(withinWindow?.[0].id).toBe(root.id);

        await sleep(150);

        const outsideWindow = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-window",
          deduplications: [
            { key: "dedup-read-window-key", scope: "any", windowMs: 100 },
            { key: "dedup-read-window-key", scope: "any" },
          ],
        });
        expect(outsideWindow.map((chain) => chain?.[0].id)).toEqual([undefined, root.id]);
      },
    },
    {
      name: "by-deduplication windowMs with scope 'running' respects both window and status",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: root }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read-window-scope",
                chainTypeName: "dedup-read-window-scope",
                input: null,
                deduplication: { key: "dedup-read-window-scope-key", scope: "running" },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.finishJobAttempt({
            txCtx,
            jobId: root.id,
            workerId: null,
            outcome: { output: null },
          }),
        );

        // Well inside the window, but completed — `running` still resolves nothing.
        const resolved = await stateAdapter.getChainsByDeduplication({
          chainTypeName: "dedup-read-window-scope",
          deduplications: [
            { key: "dedup-read-window-scope-key", scope: "running", windowMs: 60_000 },
            { key: "dedup-read-window-scope-key", scope: "any", windowMs: 60_000 },
          ],
        });
        expect(resolved.map((chain) => chain?.[0].id)).toEqual([undefined, root.id]);
      },
    },
    {
      name: "resolves chains by deduplication with lock: exclusive",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-read-locked",
                chainTypeName: "dedup-read-locked",
                input: null,
                deduplication: { key: "conformance-locked-key", scope: "running" },
              },
            ],
          }),
        );

        const { job: continuation } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "dedup-read-locked-step2",
              continueFromId: headJob.id,
              input: null,
            },
          }),
        );

        const [chain, missing] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getChainsByDeduplication({
            txCtx,
            chainTypeName: "dedup-read-locked",
            deduplications: [
              { key: "conformance-locked-key", scope: "running" },
              { key: "conformance-locked-absent", scope: "running" },
            ],
            lock: "exclusive",
          }),
        );

        expect(chain).toBeDefined();
        expect(chain![0].id).toBe(headJob.id);
        expect(chain![1]!.id).toBe(continuation.id);
        expect(missing).toBeUndefined();
      },
    },
    {
      name: "by-deduplication lock: exclusive blocks a concurrent locked read until the holding tx commits",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-lock-contention",
                chainTypeName: "dedup-lock-contention",
                input: null,
                deduplication: { key: "conformance-contention-key", scope: "running" },
              },
            ],
          }),
        );

        const { job: continuation } = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createContinuationJob({
            txCtx,
            job: {
              typeName: "dedup-lock-contention-step2",
              continueFromId: headJob.id,
              input: null,
            },
          }),
        );

        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const deduplications = [{ key: "conformance-contention-key", scope: "running" as const }];

        let releaseHolder: (() => void) | undefined;
        const holderGate = new Promise<void>((r) => {
          releaseHolder = r;
        });
        let signalLockHeld: (() => void) | undefined;
        const lockHeld = new Promise<void>((r) => {
          signalLockHeld = r;
        });

        const holderTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getChainsByDeduplication({
            txCtx,
            chainTypeName: "dedup-lock-contention",
            deduplications,
            lock: "exclusive",
          });
          signalLockHeld!();
          await holderGate;
        });

        await lockHeld;

        let waiterResolved = false;
        const waiterTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.getChainsByDeduplication({
              txCtx,
              chainTypeName: "dedup-lock-contention",
              deduplications,
              lock: "exclusive",
            }),
          )
          .then((chain) => {
            waiterResolved = true;
            return chain;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(waiterResolved).toBe(false);

        releaseHolder!();
        await holderTx;

        const [observed] = await waiterTx;
        expect(observed).toBeDefined();
        expect(observed![0].id).toBe(headJob.id);
        expect(observed![1]!.id).toBe(continuation.id);
      },
    },
    {
      name: "by-deduplication lock: exclusive observes the write it waited for",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }

        const [{ job: headJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "dedup-lock-freshness",
                chainTypeName: "dedup-lock-freshness",
                input: null,
                deduplication: { key: "conformance-freshness-key", scope: "running" },
              },
            ],
          }),
        );

        let releaseWriter: (() => void) | undefined;
        const writerGate = new Promise<void>((r) => {
          releaseWriter = r;
        });
        let signalWriteStaged: (() => void) | undefined;
        const writeStaged = new Promise<void>((r) => {
          signalWriteStaged = r;
        });

        // Completes the chain but holds the transaction open, so a reader that locks the
        // row must wait — and must then see the committed completion, not the snapshot it
        // started with.
        const writerTx = stateAdapter.withTransaction(async (txCtx) => {
          const { job } = await stateAdapter.startJobAttempt({
            txCtx,
            typeNames: ["dedup-lock-freshness"],
            workerId: "freshness-writer",
          });
          await stateAdapter.finishJobAttempt({
            txCtx,
            jobId: job!.id,
            workerId: "freshness-writer",
            outcome: { output: { done: true } },
          });
          signalWriteStaged!();
          await writerGate;
        });

        await writeStaged;

        const readPromise = stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getChainsByDeduplication({
            txCtx,
            chainTypeName: "dedup-lock-freshness",
            deduplications: [{ key: "conformance-freshness-key", scope: "running" }],
            lock: "exclusive",
          }),
        );

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        releaseWriter!();
        await writerTx;

        const [observed] = await readPromise;
        expect(observed).toBeDefined();
        expect(observed![0].id).toBe(headJob.id);
        expect(observed![0].completedAt).not.toBeNull();
      },
    },
  ],
};
