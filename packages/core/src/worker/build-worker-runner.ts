import { createLatch, createResettableLatch } from "@queuert/helpers/latch";
import { isPositiveFinite } from "@queuert/helpers/number";
import { sleep } from "@queuert/helpers/sleep";

import {
  type BackoffConfig,
  backoffConfigViolations,
  calculateBackoffMs,
} from "../entities/backoff.ts";
import {
  type Processors,
  processorAttemptMiddlewareSymbol,
} from "../job-type-processors/job-type-processors.ts";
import { mergeProcessors } from "../job-type-processors/merge-job-type-processors.ts";
import type { ObservabilityHelper } from "../observability-adapter/observability-helper.ts";
import { resolveWorkerId } from "../state-adapter/adapter-config.ts";
import type { StateAdapterConfig } from "../state-adapter/state-adapter.ts";
import type { StampedProcessor, runWorker } from "./run-worker.ts";
import { type WorkerLeaseConfig, workerLeaseConfigViolations } from "./worker-lease.ts";
import type { WorkerRunner } from "./worker-runner.ts";

export const buildWorkerRunner = <
  THelpers extends {
    stateAdapter: { config: StateAdapterConfig<any, any> };
    observabilityHelper: ObservabilityHelper;
  },
>({
  factoryName,
  helpers,
  runRegistration,
  workerId: workerIdOption,
  concurrency: concurrencyOption,
  pollIntervalMs: pollIntervalMsOption,
  recoveryBackoffConfig: recoveryBackoffConfigOption,
  leaseConfig: leaseConfigOption,
  backoffConfig: backoffConfigOption,
  requiredAttemptMiddleware: requiredAttemptMiddlewareOption,
  processors: processorsOption,
}: {
  factoryName: string;
  helpers: THelpers;
  runRegistration: (
    options: Omit<Parameters<typeof runWorker>[0], "helpers"> & { helpers: THelpers },
  ) => Promise<boolean>;
  workerId?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  recoveryBackoffConfig?: BackoffConfig;
  leaseConfig?: WorkerLeaseConfig;
  backoffConfig?: BackoffConfig;
  requiredAttemptMiddleware?: readonly unknown[];
  processors: unknown;
}): WorkerRunner => {
  const merged = Array.isArray(processorsOption)
    ? processorsOption.length === 1
      ? (processorsOption[0] as Processors)
      : // ValidatedProcessorSlices duplicate-check is enforced at the createWorkerRunner signature
        // for fixed-length arrays only; mergeProcessors re-checks at runtime either way.
        mergeProcessors(processorsOption as never)
    : (processorsOption as Processors);

  const processors = merged as unknown as Record<string, StampedProcessor>;
  const typeNames = Object.keys(processors);

  const requiredAttemptMiddleware = requiredAttemptMiddlewareOption ?? [];
  if (requiredAttemptMiddleware.length > 0) {
    const violations: string[] = [];
    for (const typeName of typeNames) {
      const sliceMW = processors[typeName][processorAttemptMiddlewareSymbol] ?? [];
      const missing: number[] = [];
      let i = 0;
      for (let r = 0; r < requiredAttemptMiddleware.length; r++) {
        while (i < sliceMW.length && sliceMW[i] !== requiredAttemptMiddleware[r]) i++;
        if (i >= sliceMW.length) {
          missing.push(r);
        } else {
          i++;
        }
      }
      if (missing.length > 0) {
        violations.push(
          `  - "${typeName}": missing requiredAttemptMiddleware at position(s) [${missing.join(", ")}]`,
        );
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `${factoryName}: one or more processors are missing requiredAttemptMiddleware (each slice must include every required middleware instance as an in-order subsequence):\n${violations.join("\n")}`,
      );
    }
  }

  const pollIntervalMs = pollIntervalMsOption ?? 60_000;
  const recoveryBackoffConfig = recoveryBackoffConfigOption ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const defaultBackoffConfig = backoffConfigOption ?? {
    initialDelayMs: 10_000,
    multiplier: 2.0,
    maxDelayMs: 300_000,
  };
  const leaseConfig = leaseConfigOption ?? { durationMs: 60_000, heartbeatMs: 15_000 };
  const concurrency = concurrencyOption ?? 1;
  const configViolations = [
    ...(Number.isSafeInteger(concurrency) && concurrency > 0
      ? []
      : [`concurrency must be a positive integer (got ${String(concurrency)})`]),
    ...(isPositiveFinite(pollIntervalMs)
      ? []
      : [`pollIntervalMs must be a positive finite number (got ${String(pollIntervalMs)})`]),
    ...backoffConfigViolations("recoveryBackoffConfig", recoveryBackoffConfig),
    ...workerLeaseConfigViolations("leaseConfig", leaseConfig),
    ...backoffConfigViolations("backoffConfig", defaultBackoffConfig),
    ...typeNames.flatMap((typeName) =>
      backoffConfigViolations(
        `processors["${typeName}"].backoffConfig`,
        processors[typeName].backoffConfig,
      ),
    ),
  ];
  if (configViolations.length > 0) {
    throw new TypeError(
      `${factoryName}: invalid configuration:\n${configViolations.map((v) => `  - ${v}`).join("\n")}`,
    );
  }
  const { observabilityHelper } = helpers;
  const workerId = resolveWorkerId(helpers.stateAdapter.config, workerIdOption);

  const started = createResettableLatch(
    `${factoryName}: the worker runner is already started; await stop() before starting it again`,
  );
  const closed = createLatch(`${factoryName}: the worker runner is closed`);
  const stopping = createResettableLatch();
  let stopController = new AbortController();
  let runWorkersPromise = Promise.resolve();
  const stop = async () => {
    if (!started.tripped) return;
    stopController.abort();
    if (!stopping.trip()) {
      await runWorkersPromise;
      return;
    }
    await runWorkersPromise;
    stopping.reset();
    started.reset();
  };
  const close = async () => {
    closed.trip();
    await stop();
  };
  return {
    start: async () => {
      closed.throwIfTripped();
      started.throwIfTripped();
      started.trip();
      stopController = new AbortController();

      const runWorkers = async () => {
        let failures = 0;
        while (!stopController.signal.aborted) {
          const options = {
            helpers,
            workerId,
            typeNames,
            processors,
            concurrency,
            pollIntervalMs,
            recoveryBackoffConfig,
            defaultBackoffConfig,
            leaseConfig,
            stopSignal: stopController.signal,
          };
          const startedJob = await runRegistration(options).catch((error: unknown) => {
            observabilityHelper.workerError({ workerId }, error);
            return false;
          });
          failures = startedJob ? 1 : failures + 1;
          await sleep(calculateBackoffMs(failures, recoveryBackoffConfig), {
            signal: stopController.signal,
          });
        }
      };

      runWorkersPromise = runWorkers().catch((error: unknown) => {
        observabilityHelper.workerError({ workerId }, error);
      });
    },
    stop,
    close,
    [Symbol.asyncDispose]: close,
  };
};
