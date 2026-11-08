import { createIdGenerator, jobTypes, populateScenarios } from "example-dashboard/scenarios";
import { type Client, createClient } from "queuert";
import { type InProcessStateAdapter, createInProcessStateAdapter } from "queuert/internal";

export type DashboardDemoView =
  | "overview"
  | "chain-types"
  | "job-types"
  | "chains-list"
  | "chain-detail"
  | "jobs-list"
  | "job-detail"
  | "workers-list"
  | "worker-detail"
  | "find";

export const seedDashboardDemo = async (): Promise<{
  client: Client<any, InProcessStateAdapter>;
  paths: Record<DashboardDemoView, string>;
}> => {
  const generateId = createIdGenerator(1);
  const stateAdapter = createInProcessStateAdapter({
    generateJobId: generateId,
    generateWorkerId: generateId,
  });
  const client = createClient({ stateAdapter, jobTypes });

  const { orderChain, blockerChain, retryChain, liveWorkerId } = await populateScenarios({
    client,
    stateAdapter,
    withTransaction: async (fn) => stateAdapter.withTransaction(async (ctx) => fn(ctx)),
  });

  return {
    client,
    paths: {
      overview: "/",
      "chain-types": "/chains/types",
      "job-types": "/jobs/types",
      "chains-list": "/chains?typeName=greet",
      "chain-detail": `/chains/${blockerChain.id}`,
      "jobs-list": "/jobs?typeName=greet",
      "job-detail": `/jobs/${retryChain.id}`,
      "workers-list": "/workers",
      "worker-detail": `/workers/${liveWorkerId}`,
      find: `/find?ids=${[orderChain.id, liveWorkerId, generateId()].join(",")}`,
    },
  };
};
