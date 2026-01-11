// oxlint-disable no-empty-pattern
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { type ObservabilityAdapter } from "queuert";
import { type TestAPI } from "vitest";
import { createOtelObservabilityAdapter } from "../observability-adapter/observability-adapter.otel.js";

// Map method names to OTEL metric names
const methodToMetricName: Record<string, string> = {
  workerStarted: "queuert.worker.started",
  workerError: "queuert.worker.error",
  workerStopping: "queuert.worker.stopping",
  workerStopped: "queuert.worker.stopped",
  jobCreated: "queuert.job.created",
  jobAttemptStarted: "queuert.job.attempt.started",
  jobAttemptTakenByAnotherWorker: "queuert.job.attempt.taken_by_another_worker",
  jobAttemptAlreadyCompleted: "queuert.job.attempt.already_completed",
  jobAttemptLeaseExpired: "queuert.job.attempt.lease_expired",
  jobAttemptLeaseRenewed: "queuert.job.attempt.lease_renewed",
  jobAttemptFailed: "queuert.job.attempt.failed",
  jobAttemptCompleted: "queuert.job.attempt.completed",
  jobCompleted: "queuert.job.completed",
  jobReaped: "queuert.job.reaped",
  jobSequenceCreated: "queuert.job_sequence.created",
  jobSequenceCompleted: "queuert.job_sequence.completed",
  jobBlocked: "queuert.job.blocked",
  jobUnblocked: "queuert.job.unblocked",
  notifyContextAbsence: "queuert.notify_adapter.context_absence",
  notifyAdapterError: "queuert.notify_adapter.error",
  stateAdapterError: "queuert.state_adapter.error",
};

export const extendWithOtelObservability = <T extends {}>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    observabilityAdapter: ObservabilityAdapter;
    expectMetrics: (
      expected: { method: string; args?: Record<string, unknown> }[],
    ) => Promise<void>;
  }
> => {
  return api.extend<{
    observabilityAdapter: ObservabilityAdapter;
    expectMetrics: (
      expected: { method: string; args?: Record<string, unknown> }[],
    ) => Promise<void>;
    _otelExporter: InMemoryMetricExporter;
    _otelReader: PeriodicExportingMetricReader;
    _otelProvider: MeterProvider;
  }>({
    _otelExporter: [
      async ({}, use) => use(new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)),
      { scope: "test" },
    ],
    _otelReader: [
      async ({ _otelExporter }, use) =>
        use(
          new PeriodicExportingMetricReader({ exporter: _otelExporter, exportIntervalMillis: 50 }),
        ),
      { scope: "test" },
    ],
    _otelProvider: [
      async ({ _otelReader }, use) => {
        const provider = new MeterProvider({ readers: [_otelReader] });
        await use(provider);
        await provider.shutdown();
      },
      { scope: "test" },
    ],
    observabilityAdapter: [
      async ({ _otelProvider }, use) => {
        await use(
          createOtelObservabilityAdapter({ meter: _otelProvider.getMeter("queuert-test") }),
        );
      },
      { scope: "test" },
    ],
    expectMetrics: [
      async ({ _otelReader, _otelExporter, expect }, use) => {
        await use(async (expected) => {
          await _otelReader.forceFlush();
          const lastExport = _otelExporter.getMetrics().at(-1);

          // Collect actual metric counts
          const actualCounts = new Map<string, number>();
          for (const scope of lastExport?.scopeMetrics ?? []) {
            for (const m of scope.metrics) {
              if (m.dataPointType === DataPointType.SUM) {
                let count = 0;
                for (const p of m.dataPoints) count += p.value;
                actualCounts.set(m.descriptor.name, count);
              }
            }
          }

          // Count expected metrics
          const expectedCounts = new Map<string, number>();
          for (const { method } of expected) {
            const name = methodToMetricName[method] ?? method;
            expectedCounts.set(name, (expectedCounts.get(name) ?? 0) + 1);
          }

          // Verify counts match
          expect(Object.fromEntries(actualCounts)).toEqual(Object.fromEntries(expectedCounts));

          // Note: We only verify counts here, not attribute details.
          // The test expectations use ObservabilityAdapter method args which don't map 1:1
          // to OTEL attributes (e.g., typeName -> sequenceTypeName, rescheduledAfterMs not stored).
          // Attribute verification should be done via unit tests on the adapter itself.
        });
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithOtelObservability<T>>;
};
