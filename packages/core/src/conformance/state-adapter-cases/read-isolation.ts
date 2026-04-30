import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const readIsolationGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "read isolation",
  cases: [
    {
      name: "non-transactional getJob does not observe an uncommitted insert",
      run: async ({ stateAdapter }, expect) => {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        let signalTxReady: (() => void) | undefined;
        const txReady = new Promise<void>((r) => {
          signalTxReady = r;
        });
        let insertedId: string | undefined;

        const txPromise = stateAdapter
          .withTransaction(async (txCtx) => {
            const [{ job }] = await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "iso-insert",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "iso-insert",
                  input: null,
                },
              ],
            });
            insertedId = job.id;
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getJob({ jobId: insertedId! });
        release!();
        await txPromise;

        const observed = await readPromise;
        expect(observed).toBeUndefined();
      },
    },
    {
      name: "non-transactional getJob does not observe an uncommitted status update",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "iso-update",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "iso-update",
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
            const acquired = await stateAdapter.acquireJob({
              txCtx,
              typeNames: ["iso-update"],
            });
            expect(acquired.job?.id).toBe(seed.id);
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getJob({ jobId: seed.id });
        release!();
        await txPromise;

        const observed = await readPromise;
        expect(observed?.status).toBe("pending");
        expect(observed?.attempt).toBe(0);
      },
    },
    {
      name: "non-transactional listJobs does not observe an uncommitted insert",
      run: async ({ stateAdapter }, expect) => {
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
                  typeName: "iso-list",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "iso-list",
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
        const listPromise = stateAdapter.listJobs({
          filter: { typeName: ["iso-list"] },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        release!();
        await txPromise;

        const { items } = await listPromise;
        expect(items).toHaveLength(0);
      },
    },
    {
      name: "non-transactional getJobBlockers does not observe an uncommitted blocker insert",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "iso-blocker-src",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "iso-blocker-src",
                input: null,
              },
            ],
          }),
        );
        const [{ job: target }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "iso-blocker-target",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "iso-blocker-target",
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
              jobBlockers: [{ jobId: target.id, blockedByChainIds: [blocker.chainId] }],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const blockersPromise = stateAdapter.getJobBlockers({ jobId: target.id });
        const targetReadPromise = stateAdapter.getJob({ jobId: target.id });
        release!();
        await txPromise;

        const observedBlockers = await blockersPromise;
        const observedTarget = await targetReadPromise;
        expect(observedBlockers).toHaveLength(0);
        expect(observedTarget?.status).toBe("pending");
      },
    },
    {
      name: "non-transactional getJob does not observe an uncommitted delete",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "iso-delete",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "iso-delete",
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
            await stateAdapter.deleteChains({ txCtx, chainIds: [seed.chainId] });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getJob({ jobId: seed.id });
        release!();
        await txPromise;

        const observed = await readPromise;
        expect(observed?.id).toBe(seed.id);
      },
    },
    {
      name: "non-transactional getChain does not observe an uncommitted chain creation",
      run: async ({ stateAdapter }, expect) => {
        let release: (() => void) | undefined;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        let signalTxReady: (() => void) | undefined;
        const txReady = new Promise<void>((r) => {
          signalTxReady = r;
        });
        let newChainId: string | undefined;

        const txPromise = stateAdapter
          .withTransaction(async (txCtx) => {
            const [{ job }] = await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "iso-chain-create",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "iso-chain-create",
                  input: null,
                },
              ],
            });
            newChainId = job.chainId;
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getChain({ chainId: newChainId! });
        release!();
        await txPromise;

        const observed = await readPromise;
        expect(observed).toBeUndefined();
      },
    },
    {
      name: "non-transactional getNextJobAvailableInMs does not observe an uncommitted insert",
      run: async ({ stateAdapter }, expect) => {
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
                  typeName: "iso-next",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "iso-next",
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
        const readPromise = stateAdapter.getNextJobAvailableInMs({ typeNames: ["iso-next"] });
        release!();
        await txPromise;

        const observed = await readPromise;
        expect(observed).toBeNull();
      },
    },
    {
      name: "non-transactional locked getJob does not observe an uncommitted status update",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "iso-locked-job",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "iso-locked-job",
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
            await stateAdapter.acquireJob({ txCtx, typeNames: ["iso-locked-job"] });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const readPromise = stateAdapter.getJob({ jobId: seed.id, lock: "exclusive" });
        release!();
        await txPromise;

        const observed = await readPromise;
        expect(observed?.status).toBe("pending");
        expect(observed?.attempt).toBe(0);
      },
    },
    {
      name: "non-transactional locked getChain does not observe an uncommitted continuation",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "iso-latest-root",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "iso-latest",
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
            await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "iso-latest-cont",
                  chainId: seed.chainId,
                  chainIndex: 1,
                  chainTypeName: "iso-latest",
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
        const readPromise = stateAdapter.getChain({
          chainId: seed.chainId,
          lock: "exclusive",
        });
        release!();
        await txPromise;

        const observed = await readPromise;
        expect(observed).toBeDefined();
        const [rootJob, lastJob] = observed!;
        expect(rootJob.id).toBe(seed.id);
        expect(rootJob.chainIndex).toBe(0);
        expect(lastJob).toBeUndefined();
      },
    },
    {
      name: "non-transactional listChains does not observe an uncommitted chain creation",
      run: async ({ stateAdapter }, expect) => {
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
                  typeName: "iso-list-chains",
                  chainId: undefined,
                  chainIndex: 0,
                  chainTypeName: "iso-list-chains",
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
          filter: { typeName: ["iso-list-chains"] },
          orderDirection: "desc",
          page: { limit: 10 },
        });
        release!();
        await txPromise;

        const { items } = await listPromise;
        expect(items).toHaveLength(0);
      },
    },
    {
      name: "non-transactional listChainJobs does not observe an uncommitted continuation",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: seed }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "iso-chain-jobs-root",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "iso-chain-jobs",
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
            await stateAdapter.createJobs({
              txCtx,
              jobs: [
                {
                  typeName: "iso-chain-jobs-cont",
                  chainId: seed.chainId,
                  chainIndex: 1,
                  chainTypeName: "iso-chain-jobs",
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
          chainId: seed.chainId,
          orderDirection: "asc",
          page: { limit: 10 },
        });
        release!();
        await txPromise;

        const { items } = await listPromise;
        expect(items).toHaveLength(1);
        expect(items[0]?.id).toBe(seed.id);
      },
    },
    {
      name: "non-transactional listBlockedJobs does not observe an uncommitted blocker insert",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: blocker }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "iso-listblocked-src",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "iso-listblocked-src",
                input: null,
              },
            ],
          }),
        );
        const [{ job: target }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "iso-listblocked-target",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "iso-listblocked-target",
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
              jobBlockers: [{ jobId: target.id, blockedByChainIds: [blocker.chainId] }],
            });
            signalTxReady!();
            await gate;
            throw new Error("rollback");
          })
          .catch(() => {});

        await txReady;
        const listPromise = stateAdapter.listBlockedJobs({
          chainId: blocker.chainId,
          orderDirection: "desc",
          page: { limit: 10 },
        });
        release!();
        await txPromise;

        const { items } = await listPromise;
        expect(items).toHaveLength(0);
      },
    },
  ],
};
