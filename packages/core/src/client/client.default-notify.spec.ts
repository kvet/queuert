import { sleep } from "@queuert/helpers/sleep";
import { describe, expect, test } from "vitest";

import { createProcessors } from "../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../job-types/define-job-types.ts";
import { noopNotifyAdapter } from "../notify-adapter/notify-adapter.noop.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import { createWorkerRunner } from "../worker/worker-runner.ts";
import { createClient } from "./client.ts";

const jobTypes = defineJobTypes<{
  "send-welcome-email": { entry: true; input: null; output: { sent: true } };
}>();

const runChain = async (
  options: Pick<Parameters<typeof createClient>[0], "notifyAdapter">,
): Promise<"completed" | "timed out"> => {
  const stateAdapter = createInProcessStateAdapter();
  const client = createClient({ stateAdapter, jobTypes, ...options });
  await using workerRunner = createWorkerRunner({
    client,
    pollIntervalMs: 60_000,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        "send-welcome-email": {
          attemptHandler: async ({ complete }) =>
            stateAdapter.withTransaction(async (txCtx) =>
              complete({ ...txCtx, output: { sent: true } }),
            ),
        },
      },
    }),
  });

  await workerRunner.start();
  await sleep(100);
  const chain = await stateAdapter.withTransaction(async (txCtx) =>
    client.createChain({ ...txCtx, typeName: "send-welcome-email", input: null }),
  );
  return await client
    .awaitChain(chain, { timeoutMs: 1000, pollIntervalMs: 60_000 })
    .then(() => "completed" as const)
    .catch(() => "timed out" as const);
};

describe("createClient without a notify adapter", () => {
  test("wakes its own worker runner and awaitChain without polling", async () => {
    expect(await runChain({})).toBe("completed");
  });

  test("leaves them to polling with an explicit adapter that delivers nothing", async () => {
    expect(await runChain({ notifyAdapter: noopNotifyAdapter })).toBe("timed out");
  });
});
