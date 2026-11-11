import assert from "node:assert/strict";

import { createClient } from "../../client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createFlakyNotifyAdapter } from "../support/flaky-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

export const notifyResilienceGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "notify-resilience",
  cases: [
    {
      name: "handles transient notify adapter errors gracefully",
      run: async ({ createStateAdapter, createNotifyAdapter }) => {
        await using stateAdapter: EndToEndStateAdapter = await createStateAdapter();
        await using notifyAdapter = await createCaseNotifyAdapter(createNotifyAdapter);
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const flaky = createFlakyNotifyAdapter(notifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter: flaky.notifyAdapter,
          jobTypes,
        });
        await using workerRunner = createWorkerRunner({
          client,
          concurrency: 1,
          recoveryBackoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
          pollIntervalMs: 1_000_000,
          processors: createProcessors({
            client,
            jobTypes,
            backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },
            processors: {
              test: {
                attemptHandler: async ({ job, complete }) =>
                  withCaseTransaction(stateAdapter, async (txCtx) =>
                    complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                  ),
              },
            },
          }),
        });

        await workerRunner.start();
        const chains = await withCaseTransaction(stateAdapter, async (txCtx) =>
          client.createChains({
            ...txCtx,
            items: Array.from({ length: 20 }, (_, i) => ({
              typeName: "test",
              input: { value: i },
            })),
          }),
        );

        await Promise.all(
          chains.map(async (chain) =>
            client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 5000 }),
          ),
        );
        await workerRunner.close();

        if (flaky.counts.calls > 5) {
          assert.ok(flaky.counts.errors > 0);
        }
      },
    },
  ],
};
