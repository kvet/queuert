import assert from "node:assert/strict";

import { caseBody, resource, wait } from "@queuert/helpers/case-body";
import { step } from "@queuert/helpers/steps";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import { defineJobTypes } from "../../job-types/define-job-types.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createFlakyNotifyAdapter } from "../support/flaky-notify-adapter.ts";
import { withCaseTransaction } from "../support/with-case-transaction.ts";
import type { EndToEndStateAdapter } from "../types.ts";

export const notifyResilienceGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "notify-resilience",
  cases: [
    {
      name: "handles transient notify adapter errors gracefully",
      run: caseBody(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = (yield* resource(createStateAdapter())) as EndToEndStateAdapter;
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const jobTypes = defineJobTypes<{
          test: { entry: true; input: { value: number }; output: { result: number } };
        }>();
        const flaky = createFlakyNotifyAdapter(notifyAdapter);
        const client = createClient({
          stateAdapter,
          notifyAdapter: flaky.notifyAdapter,
          jobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
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
                    withCaseTransaction(stateAdapter, (txCtx) =>
                      complete({ ...txCtx, output: { result: job.input.value * 2 } }),
                    ),
                },
              },
            }),
          }),
        );

        yield* wait(workerRunner.start());
        const chains = yield* step(
          withCaseTransaction(stateAdapter, (txCtx) =>
            client.createChains({
              ...txCtx,
              items: Array.from({ length: 20 }, (_, i) => ({
                typeName: "test",
                input: { value: i },
              })),
            }),
          ),
        );

        yield* wait(
          Promise.all(
            chains.map(async (chain) =>
              client.awaitChain(chain, { pollIntervalMs: 100, timeoutMs: 5000 }),
            ),
          ),
        );
        yield* wait(workerRunner.close());

        if (flaky.counts.calls > 5) {
          assert.ok(flaky.counts.errors > 0);
        }
      }),
    },
  ],
};
