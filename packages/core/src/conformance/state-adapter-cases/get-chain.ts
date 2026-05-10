import { sleep } from "../../helpers/sleep.js";
import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

const LOCK_BLOCK_OBSERVATION_MS = 100;

export const getChainGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getChain",
  cases: [
    {
      name: "handles chain relationships correctly",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-root",
                chainTypeName: "chain-root",
                input: { step: 1 },
              },
            ],
          }),
        );

        const chain = await stateAdapter.getChain({ chainId: rootJob.id });

        expect(chain).toBeDefined();
        expect(chain![0].id).toBe(rootJob.id);
        expect(chain![0].chainId).toBe(rootJob.id);
      },
    },
    {
      name: "returns [rootJob, lastJob] for multi-chain",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-root",
                chainTypeName: "chain-root",
                input: null,
              },
            ],
          }),
        );

        const [{ job: continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-step2",
                continueFromJobId: rootJob.id,
                input: null,
              },
            ],
          }),
        );

        const chain = await stateAdapter.getChain({ chainId: rootJob.id });
        expect(chain).toBeDefined();
        expect(chain![0].id).toBe(rootJob.id);
        expect(chain![1]).toBeDefined();
        expect(chain![1]!.id).toBe(continuation.id);
      },
    },
    {
      name: "returns [rootJob, undefined] for a single-root chain",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "single-root",
                chainTypeName: "single-root",
                input: null,
              },
            ],
          }),
        );

        const chain = await stateAdapter.getChain({ chainId: rootJob.id });

        expect(chain).toBeDefined();
        expect(chain![0].id).toBe(rootJob.id);
        expect(chain![1]).toBeUndefined();
      },
    },
    {
      name: "returns [rootJob, undefined] for a single-root chain with lock: exclusive",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "single-root-locked",
                chainTypeName: "single-root-locked",
                input: null,
              },
            ],
          }),
        );

        const chain = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.getChain({ txCtx, chainId: rootJob.id, lock: "exclusive" }),
        );

        expect(chain).toBeDefined();
        expect(chain![0].id).toBe(rootJob.id);
        expect(chain![1]).toBeUndefined();
      },
    },
    {
      name: "returns undefined for nonexistent chain ID",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: real }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-lookup-test",
                chainTypeName: "chain-lookup-test",
                input: null,
              },
            ],
          }),
        );
        const nonexistentId = real.chainId.slice(0, -1) + (real.chainId.endsWith("0") ? "1" : "0");
        const chain = await stateAdapter.getChain({
          chainId: nonexistentId,
        });
        expect(chain).toBeUndefined();
      },
    },
    {
      name: "lock: exclusive blocks a concurrent locked read until the holding tx commits",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-locked",
                chainTypeName: "chain-locked",
                input: null,
              },
            ],
          }),
        );

        const [{ job: continuation }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-locked-step2",
                continueFromJobId: rootJob.id,
                input: null,
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

        const holderTx = stateAdapter.withTransaction(async (txCtx) => {
          await stateAdapter.getChain({
            txCtx,
            chainId: rootJob.chainId,
            lock: "exclusive",
          });
          signalLockHeld!();
          await holderGate;
        });

        await lockHeld;

        let waiterResolved = false;
        const waiterTx = stateAdapter
          .withTransaction(async (txCtx) =>
            stateAdapter.getChain({ txCtx, chainId: rootJob.chainId, lock: "exclusive" }),
          )
          .then((chain) => {
            waiterResolved = true;
            return chain;
          });

        await sleep(LOCK_BLOCK_OBSERVATION_MS);
        expect(waiterResolved).toBe(false);

        releaseHolder!();
        await holderTx;

        const observed = await waiterTx;
        expect(observed).toBeDefined();
        expect(observed![0].id).toBe(rootJob.id);
        expect(observed![1]).toBeDefined();
        expect(observed![1]!.id).toBe(continuation.id);
      },
    },
  ],
};
