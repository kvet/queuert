import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getJobGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJob",
  cases: [
    {
      name: "returns undefined for nonexistent job ID",
      run: async ({ stateAdapter }, expect) => {
        // Create a real job to get a valid ID format, then look up a derived nonexistent one
        const [{ job: real }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "lookup-test",
                chainTypeName: "lookup-test",
                input: null,
              },
            ],
          }),
        );
        const nonexistentId = real.id.slice(0, -1) + (real.id.endsWith("0") ? "1" : "0");
        const job = await stateAdapter.getJob({ jobId: nonexistentId });
        expect(job).toBeUndefined();
      },
    },
    {
      name: "lock: exclusive blocks a concurrent locked read until the holding tx commits",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "lock-blocking-job",
                chainTypeName: "lock-blocking-job",
                input: { value: 1 },
              },
            ],
          }),
        );

        let releaseHolder: (() => void) | undefined;
        const holderGate = new Promise<void>((r) => {
          releaseHolder = r;
        });
        let signalLockHeld: (() => void) | undefined;
        const lockHeld = new Promise<void>((r) => {
          signalLockHeld = r;
        });

        // Tx A: acquire the exclusive lock on `seed`, then wait on the gate.
        const holderTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getJob({ txCtx, jobId: seed.id, lock: "exclusive" });
          signalLockHeld!();
          await holderGate;
        });

        await lockHeld;

        // Tx B: also try to lock the same row. Should not resolve while A holds.
        let waiterResolved = false;
        const waiterTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.getJob({ txCtx, jobId: seed.id, lock: "exclusive" }),
          )
          .then((job) => {
            waiterResolved = true;
            return job;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(waiterResolved).toBe(false);

        releaseHolder!();
        await holderTx;

        const observed = await waiterTx;
        expect(observed).toBeDefined();
        expect(observed!.id).toBe(seed.id);
        expect(observed!.input).toEqual({ value: 1 });
      },
    },
  ],
};
