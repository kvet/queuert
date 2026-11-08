import { sleep } from "@queuert/helpers";
import { describe, expect, test } from "vitest";

import { createClient } from "./client.ts";
import { createProcessors } from "./job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "./job-types/define-job-types.ts";
import { noopNotifyAdapter } from "./notify-adapter/notify-adapter.noop.spec-helper.ts";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.ts";
import { withTxHooks } from "./tx-hooks/tx-hooks.ts";
import { createWorkerRunner } from "./worker-runner.ts";

const jobTypes = defineJobTypes<{
  "send-welcome-email": { entry: true; input: null; output: { sent: true } };
}>();

const runChain = async (
  options: Pick<Parameters<typeof createClient>[0], "notifyAdapter">,
): Promise<"completed" | "timed out"> => {
  const stateAdapter = createInProcessStateAdapter();
  const client = createClient({ stateAdapter, jobTypes, ...options });
  const workerRunner = createWorkerRunner({
    client,
    pollIntervalMs: 60_000,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        "send-welcome-email": {
          attemptHandler: async ({ complete }) =>
            withTxHooks(async (txHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                complete({ ...txCtx, txHooks, output: { sent: true } }),
              ),
            ),
        },
      },
    }),
  });

  const stop = await workerRunner.start();
  try {
    await sleep(100);
    const chain = await withTxHooks(async (txHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({ ...txCtx, txHooks, typeName: "send-welcome-email", input: null }),
      ),
    );
    return await client
      .awaitChain(chain, { timeoutMs: 1000, pollIntervalMs: 60_000 })
      .then(() => "completed" as const)
      .catch(() => "timed out" as const);
  } finally {
    await stop();
  }
};

describe("createClient without a notify adapter", () => {
  test("wakes its own worker runner and awaitChain without polling", async () => {
    expect(await runChain({})).toBe("completed");
  });

  test("leaves them to polling with an explicit adapter that delivers nothing", async () => {
    expect(await runChain({ notifyAdapter: noopNotifyAdapter })).toBe("timed out");
  });
});
