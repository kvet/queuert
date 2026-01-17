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
  jobChainCreated: "queuert.job_chain.created",
  jobChainCompleted: "queuert.job_chain.completed",
  jobBlocked: "queuert.job.blocked",
  jobUnblocked: "queuert.job.unblocked",
  notifyContextAbsence: "queuert.notify_adapter.context_absence",
  notifyAdapterError: "queuert.notify_adapter.error",
  stateAdapterError: "queuert.state_adapter.error",
  // histograms
  jobChainDuration: "queuert.job_chain.duration",
  jobDuration: "queuert.job.duration",
  jobAttemptDuration: "queuert.job.attempt.duration",
  // gauges
  jobTypeIdleChange: "queuert.job_type.idle",
  jobTypeProcessingChange: "queuert.job_type.processing",
};

export const extendWithOtelObservability = <T extends {}>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    observabilityAdapter: ObservabilityAdapter;
    expectMetrics: (
      expected: { method: string; args?: Record<string, unknown> }[],
    ) => Promise<void>;
    expectHistograms: (
      expected: { method: string; args?: Record<string, unknown> }[],
    ) => Promise<void>;
    expectGauges: (expected: {
      jobTypeIdleChange?: Array<{ delta: number; typeName?: string; workerId?: string }>;
      jobTypeProcessingChange?: Array<{ delta: number; typeName?: string; workerId?: string }>;
    }) => Promise<void>;
  }
> => {
  return api.extend<{
    observabilityAdapter: ObservabilityAdapter;
    expectMetrics: (
      expected: { method: string; args?: Record<string, unknown> }[],
    ) => Promise<void>;
    expectHistograms: (
      expected: { method: string; args?: Record<string, unknown> }[],
    ) => Promise<void>;
    expectGauges: (expected: {
      jobTypeIdleChange?: Array<{ delta: number; typeName?: string; workerId?: string }>;
      jobTypeProcessingChange?: Array<{ delta: number; typeName?: string; workerId?: string }>;
    }) => Promise<void>;
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

          // Collect actual metric counts (excluding gauges)
          const gaugeNames = new Set([
            methodToMetricName.jobTypeIdleChange,
            methodToMetricName.jobTypeProcessingChange,
          ]);
          const actualCounts = new Map<string, number>();
          for (const scope of lastExport?.scopeMetrics ?? []) {
            for (const m of scope.metrics) {
              if (m.dataPointType === DataPointType.SUM && !gaugeNames.has(m.descriptor.name)) {
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
          // to OTEL attributes (e.g., typeName -> chainTypeName, rescheduledAfterMs not stored).
          // Attribute verification should be done via unit tests on the adapter itself.
        });
      },
      { scope: "test" },
    ],
    expectHistograms: [
      async ({ _otelReader, _otelExporter, expect }, use) => {
        await use(async (expected) => {
          await _otelReader.forceFlush();
          const lastExport = _otelExporter.getMetrics().at(-1);

          // Collect actual histogram counts
          const actualCounts = new Map<string, number>();
          for (const scope of lastExport?.scopeMetrics ?? []) {
            for (const m of scope.metrics) {
              if (m.dataPointType === DataPointType.HISTOGRAM) {
                let count = 0;
                for (const p of m.dataPoints) count += p.value.count;
                actualCounts.set(m.descriptor.name, count);
              }
            }
          }

          // Count expected histograms
          const expectedCounts = new Map<string, number>();
          for (const { method } of expected) {
            const name = methodToMetricName[method] ?? method;
            expectedCounts.set(name, (expectedCounts.get(name) ?? 0) + 1);
          }

          // Verify counts match
          expect(Object.fromEntries(actualCounts)).toEqual(Object.fromEntries(expectedCounts));
        });
      },
      { scope: "test" },
    ],
    expectGauges: [
      async ({ _otelReader, _otelExporter, expect }, use) => {
        // Track cumulative expected values per metric (keyed by "metricName:typeName")
        const cumulativeExpected = new Map<string, number>();

        await use(async (expected) => {
          await _otelReader.forceFlush();

          // Sum expected deltas into cumulative values (grouped by typeName)
          for (const [method, calls] of Object.entries(expected) as Array<
            [
              "jobTypeIdleChange" | "jobTypeProcessingChange",
              Array<{ delta: number; typeName?: string; workerId?: string }> | undefined,
            ]
          >) {
            if (!calls) continue;
            const metricName = methodToMetricName[method];
            for (const { delta, typeName } of calls) {
              const key = `${metricName}:${typeName ?? ""}`;
              cumulativeExpected.set(key, (cumulativeExpected.get(key) ?? 0) + delta);
            }
          }

          // Collect actual cumulative values from OTEL
          const lastExport = _otelExporter.getMetrics().at(-1);
          const actualCumulative = new Map<string, number>();
          const gaugeNames = new Set([
            methodToMetricName.jobTypeIdleChange,
            methodToMetricName.jobTypeProcessingChange,
          ]);

          for (const scope of lastExport?.scopeMetrics ?? []) {
            for (const m of scope.metrics) {
              if (m.dataPointType === DataPointType.SUM && gaugeNames.has(m.descriptor.name)) {
                for (const p of m.dataPoints) {
                  const attrs = p.attributes as Record<string, string>;
                  const key = `${m.descriptor.name}:${attrs.typeName ?? ""}`;
                  actualCumulative.set(key, (actualCumulative.get(key) ?? 0) + p.value);
                }
              }
            }
          }

          // Verify cumulative values match
          expect(Object.fromEntries(actualCumulative)).toEqual(
            Object.fromEntries(cumulativeExpected),
          );
        });
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithOtelObservability<T>>;
};
