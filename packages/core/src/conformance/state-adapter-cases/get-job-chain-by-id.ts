import { type ConformanceGroup } from "../runner.js";
import { type StateAdapterConformanceContext } from "./types.js";

export const getJobChainByIdGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "getJobChainById",
  cases: [
    {
      name: "handles job chain relationships correctly",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-root",
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "chain-root",
                input: { step: 1 },
              },
            ],
          }),
        );

        const jobChain = await stateAdapter.getJobChainById({ chainId: rootJob.id });

        expect(jobChain).toBeDefined();
        expect(jobChain![0].id).toBe(rootJob.id);
        expect(jobChain![0].chainId).toBe(rootJob.id);
      },
    },
    {
      name: "returns [rootJob, lastJob] for multi-job chain",
      run: async ({ stateAdapter }, expect) => {
        const [{ job: rootJob }] = await stateAdapter.withTransaction(async (txCtx) =>
          stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "chain-root",
                chainId: undefined,
                chainIndex: 0,
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
                chainId: rootJob.chainId,
                chainIndex: 1,
                chainTypeName: "chain-root",
                input: null,
              },
            ],
          }),
        );

        const jobChain = await stateAdapter.getJobChainById({ chainId: rootJob.id });
        expect(jobChain).toBeDefined();
        expect(jobChain![0].id).toBe(rootJob.id);
        expect(jobChain![1]).toBeDefined();
        expect(jobChain![1]!.id).toBe(continuation.id);
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
                chainId: undefined,
                chainIndex: 0,
                chainTypeName: "chain-lookup-test",
                input: null,
              },
            ],
          }),
        );
        const nonexistentId = real.chainId.slice(0, -1) + (real.chainId.endsWith("0") ? "1" : "0");
        const chain = await stateAdapter.getJobChainById({
          chainId: nonexistentId,
        });
        expect(chain).toBeUndefined();
      },
    },
  ],
};
