import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const getStartAttemptDelayMsGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "getStartAttemptDelayMs",
  cases: [
    {
      name: "returns 0 for an immediately available pending job",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "avail-test",
                chainTypeName: "avail-test",
                input: null,
              },
            ],
          }),
        );

        const ms = await stateAdapter.getStartAttemptDelayMs({ typeNames: ["avail-test"] });
        expect(ms).toBe(0);
      },
    },
    {
      name: "returns milliseconds until next scheduled job",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "future-test",
                chainTypeName: "future-test",
                input: null,
                schedule: { afterMs: 5000 },
              },
            ],
          }),
        );

        const ms = await stateAdapter.getStartAttemptDelayMs({ typeNames: ["future-test"] });
        expect(ms).not.toBeNull();
        expect(ms!).toBeGreaterThan(3000);
        expect(ms!).toBeLessThanOrEqual(5100);
      },
    },
    {
      name: "returns 0 when a ready-now job exists alongside a future-scheduled one",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "mixed-test",
                chainTypeName: "mixed-test",
                input: null,
              },
              {
                typeName: "mixed-test",
                chainTypeName: "mixed-test",
                input: null,
                schedule: { afterMs: 5000 },
              },
            ],
          }),
        );

        const ms = await stateAdapter.getStartAttemptDelayMs({ typeNames: ["mixed-test"] });
        expect(ms).toBe(0);
      },
    },
    {
      name: "returns null when no pending jobs of given type exist",
      run: async ({ stateAdapter }, expect) => {
        const ms = await stateAdapter.getStartAttemptDelayMs({
          typeNames: ["nonexistent-type"],
        });
        expect(ms).toBeNull();
      },
    },
    {
      name: "returns null when only pending job is blocked",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blockerJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "delay-blocker",
                chainTypeName: "delay-blocker",
                input: null,
              },
            ],
          }),
        );

        const [{ job: blockedJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "delay-blocked",
                chainTypeName: "delay-blocked",
                input: null,
                schedule: { afterMs: 5000 },
              },
            ],
          }),
        );

        await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.addJobsBlockers({
            txCtx,
            jobBlockers: [{ jobId: blockedJob.id, blockedByChainIds: [blockerJob.chainId] }],
          }),
        );

        const ms = await stateAdapter.getStartAttemptDelayMs({
          typeNames: ["delay-blocked"],
        });
        expect(ms).toBeNull();
      },
    },
    {
      name: "non-transactional getStartAttemptDelayMs does not observe an uncommitted insert",
      run: async ({ stateAdapter }, expect) => {
        if (stateAdapter.transactionConcurrency === "serialized") {
          expect.skip("requires concurrent transactions");
          return;
        }
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
            await stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "iso-next",
                  chainTypeName: "iso-next",
                  input: null,
                  schedule: { afterMs: 5000 },
                },
              ],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getStartAttemptDelayMs({ typeNames: ["iso-next"] });
        release!();
        await txPromise;

        const observed = await readPromise;
        expect(observed).toBeNull();
      },
    },
  ],
};
