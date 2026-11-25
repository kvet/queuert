import "../integrations/dashboard/demo/dispose-symbols.ts";
import * as queuert from "queuert";
import typescript from "typescript";
import { describe, expect, it } from "vitest";

import { type ChainEvent, createChainRecorder, reduceChains } from "./recorder.ts";
import { compileExercise, executeExercise } from "./runtime.ts";

const record = async (source: string) => {
  const events: ChainEvent[] = [];
  const result = await executeExercise({
    compiled: compileExercise(typescript, { "index.ts": source }, "export const check = () => {};"),
    modules: { queuert: createChainRecorder(queuert, (event) => events.push(event)) },
  });
  expect(result).toEqual({ status: "passed" });
  return events;
};

const header = `
import { createClient, createInProcessStateAdapter, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";
const stateAdapter = createInProcessStateAdapter({ mode: "async" });
`;

describe("blocked jobs", () => {
  const source = `${header}
const jobTypes = defineJobTypes<{
  "fetch-data": { entry: true; input: { url: string }; output: { data: string } };
  "process-all": {
    entry: true;
    input: { id: string };
    output: { count: number };
    blockers: [{ typeName: "fetch-data" }, ...{ typeName: "fetch-data" }[]];
  };
}>();
const client = createClient({ stateAdapter, jobTypes });
await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "fetch-data": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            applyJobOutcome({ ...txCtx, output: { data: job.input.url } }),
          );
        },
      },
      "process-all": {
        attemptHandler: async ({ job, applyJobOutcome }) => {
          await stateAdapter.withTransaction(async (txCtx) =>
            applyJobOutcome({ ...txCtx, output: { count: job.blockers.length } }),
          );
        },
      },
    },
  }),
});
const chain = await stateAdapter.withTransaction(async (txCtx) => {
  const fetchChains = await client.createChains({
    ...txCtx,
    items: [
      { typeName: "fetch-data", input: { url: "a" } },
      { typeName: "fetch-data", input: { url: "b" } },
    ],
  });
  return client.createChain({ ...txCtx, typeName: "process-all", input: { id: "r1" }, blockers: fetchChains });
});
await workerRunner.start();
await client.awaitChain({ chain, timeoutMs: 5000 });
`;

  it("marks a job blocked until its blocker chains complete while its chain stays running", async () => {
    const events = await record(source);
    const dependentOf = (count: number) =>
      reduceChains(events.slice(0, count)).find((chain) => chain.typeName === "process-all")!;

    const created = events.findIndex((event) => event.kind === "job-created" && event.blocked);
    const unblocked = events.findIndex((event) => event.kind === "job-unblocked");

    expect(dependentOf(created + 1).jobs[0].status).toBe("blocked");
    expect(dependentOf(created + 1).status).toBe("running");
    expect(dependentOf(unblocked + 1).jobs[0].status).toBe("pending");
    expect(dependentOf(unblocked + 1).status).toBe("running");
    expect(dependentOf(events.length).status).toBe("completed");
  });
});

describe("ChainView", () => {
  const renderView = async (events: ChainEvent[], shown: number) => {
    const { renderToString } = await import("@solidjs/web");
    const { ChainView } = await import("./ChainView.tsx");
    return renderToString(() => ChainView({ events, shown }));
  };

  const statuses = (html: string) =>
    [...html.matchAll(/<\/span>(blocked|pending|running|completed)<\/span>/g)].map(
      (match) => match[1],
    );

  it("shows a chain as running until it completes, whatever its tail job's status", async () => {
    const events: ChainEvent[] = [
      { kind: "chain-created", chainId: "c1", typeName: "report" },
      {
        kind: "job-created",
        jobId: "j1",
        chainId: "c1",
        typeName: "report",
        input: "{}",
        blocked: false,
      },
      { kind: "attempt-started", jobId: "j1", attempt: 1 },
      { kind: "job-completed", jobId: "j1", output: "{}" },
      { kind: "chain-completed", chainId: "c1", output: "{}" },
    ];

    expect(statuses(await renderView(events, 1))).toEqual(["running", "pending"]);
    expect(statuses(await renderView(events, 2))).toEqual(["running", "running"]);
    expect(statuses(await renderView(events, 3))).toEqual(["completed", "completed"]);
  });
});
