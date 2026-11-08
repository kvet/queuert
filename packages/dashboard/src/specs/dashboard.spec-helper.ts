import { readRpcResponse } from "@queuert/rpc/testing";
import {
  type InProcessStateAdapter,
  createClient,
  createInProcessStateAdapter,
  defineJobTypes,
} from "queuert";
import type { StateJobInfo } from "queuert/internal";

import { createDashboard } from "../api/dashboard.ts";

export const parseBody = async (res: Response): Promise<any> => readRpcResponse(res);

export const rpcRequest = (url: string, fn: string, data?: unknown): Request =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fn, data }),
  });

type DashboardCall = (fn: string, data?: unknown) => Promise<Response>;

export const createTestDashboard = async (
  basePath?: string,
): Promise<{
  request: (path: string, init?: RequestInit) => Promise<Response>;
  call: DashboardCall;
  stateAdapter: InProcessStateAdapter;
}> => {
  const stateAdapter = createInProcessStateAdapter();
  const client = createClient({ stateAdapter, jobTypes: defineJobTypes() });
  const dashboard = createDashboard({ client, basePath });
  const prefix = basePath ?? "";
  const request = async (path: string, init?: RequestInit) =>
    dashboard.fetch(new Request(`http://test${prefix}${path}`, init));
  const call = async (fn: string, data?: unknown) =>
    dashboard.fetch(rpcRequest(`http://test${prefix}/api/rpc`, fn, data));
  return { request, call, stateAdapter };
};

export const createJob = async (
  stateAdapter: InProcessStateAdapter,
  typeName: string,
  input: unknown,
): Promise<StateJobInfo> => {
  const [stateChain] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.createJobs({
      txCtx,
      jobs: [{ id: stateAdapter.config.generateJobId(), typeName, input }],
    }),
  );
  return stateChain.head;
};

export const createContinuation = async (
  stateAdapter: InProcessStateAdapter,
  typeName: string,
  continueFromId: string,
  input: unknown,
): Promise<StateJobInfo> => {
  const [continued] = await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.continueJobs({
      txCtx,
      jobs: [{ id: stateAdapter.config.generateJobId(), typeName, continueFromId, input }],
    }),
  );
  return continued!.continuation;
};

export const startAttempt = async (
  stateAdapter: InProcessStateAdapter,
  typeName: string,
): Promise<void> => {
  const [worker] = await stateAdapter.getWorkers({ workerIds: ["worker-1"] });
  await stateAdapter.startJobAttempts({
    workerId: "worker-1",
    workerToken: worker!.token,
    typeNames: [typeName],
    limit: 1,
  });
};

export const startWorker = async (
  stateAdapter: InProcessStateAdapter,
  workerId: string,
  typeNames: string[],
): ReturnType<InProcessStateAdapter["startWorker"]> =>
  stateAdapter.startWorker({ workerId, typeNames, concurrency: 2, leaseMs: 60_000 });

export const completeJob = async (
  stateAdapter: InProcessStateAdapter,
  jobId: string,
  output: unknown,
): Promise<void> => {
  await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.completeJobs({
      txCtx,
      jobs: [{ jobId, output }],
    }),
  );
};

export const encodeRawCursor = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload)).toString("base64url");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createUuidStrictDashboard = async (): Promise<{
  call: DashboardCall;
  stateAdapter: InProcessStateAdapter;
  failures: { probe: boolean; reschedule: boolean; delete: boolean };
}> => {
  const inner = createInProcessStateAdapter();
  const failures = { probe: false, reschedule: false, delete: false };
  const assertUuids = (ids: string[]) => {
    const malformed = ids.find((id) => !UUID_PATTERN.test(id));
    if (malformed !== undefined) {
      throw new Error(`invalid input syntax for type uuid: "${malformed}"`);
    }
  };
  const stateAdapter: typeof inner = {
    ...inner,
    getChains: async (params) => {
      assertUuids(params.chainIds);
      return inner.getChains(params);
    },
    getJobs: async (params) => {
      assertUuids(params.jobIds);
      return inner.getJobs(params);
    },
    rescheduleJobs: async (params) => {
      assertUuids(params.jobs.map((job) => job.jobId));
      if (failures.reschedule) throw new Error("deadlock detected");
      return inner.rescheduleJobs(params);
    },
    listChainJobs: async (params) => {
      assertUuids([params.chainId]);
      return inner.listChainJobs(params);
    },
    listBlockedJobs: async (params) => {
      assertUuids([params.chainId]);
      return inner.listBlockedJobs(params);
    },
    getWorkers: async (params) => {
      assertUuids(params.workerIds);
      return inner.getWorkers(params);
    },
    listWorkerJobs: async (params) => {
      assertUuids([params.workerId]);
      return inner.listWorkerJobs(params);
    },
    deleteChains: async (params) => {
      if (failures.delete) {
        throw Object.assign(new Error("deadlock detected"), {
          detail: "Process 4242 waits for ShareLock",
          query: "DELETE FROM queuert.job",
        });
      }
      return inner.deleteChains(params);
    },
    getChainTypeNames: async (params) => {
      if (failures.probe) throw new Error("connection refused");
      return inner.getChainTypeNames(params);
    },
  };
  const client = createClient({ stateAdapter, jobTypes: defineJobTypes() });
  const dashboard = createDashboard({ client });
  const call = async (fn: string, data?: unknown) =>
    dashboard.fetch(rpcRequest("http://test/api/rpc", fn, data));
  return { call, stateAdapter: inner, failures };
};

export const addBlocker = async (
  stateAdapter: InProcessStateAdapter,
  jobId: string,
  blockerChainId: string,
): Promise<void> => {
  await stateAdapter.withTransaction(async (txCtx) =>
    stateAdapter.addJobsBlockers({
      txCtx,
      jobBlockers: [{ jobId, blockedByChainIds: [blockerChainId] }],
    }),
  );
};
