// oxlint-disable no-empty-pattern
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { type ObservabilityAdapter } from "queuert";
import { type TestAPI } from "vitest";
import { createOtelObservabilityAdapter } from "../observability-adapter/observability-adapter.otel.js";

// Map method names to OTEL metric names
const methodToMetricName: Record<string, string> = {
  workerStarted: "worker.started",
  workerError: "worker.error",
  workerStopping: "worker.stopping",
  workerStopped: "worker.stopped",
  jobCreated: "job.created",
  jobAttemptStarted: "job.attempt.started",
  jobAttemptTakenByAnotherWorker: "job.attempt.taken_by_another_worker",
  jobAttemptAlreadyCompleted: "job.attempt.already_completed",
  jobAttemptLeaseExpired: "job.attempt.lease_expired",
  jobAttemptLeaseRenewed: "job.attempt.lease_renewed",
  jobAttemptFailed: "job.attempt.failed",
  jobAttemptCompleted: "job.attempt.completed",
  jobCompleted: "job.completed",
  jobReaped: "job.reaped",
  jobChainCreated: "job_chain.created",
  jobChainCompleted: "job_chain.completed",
  jobBlocked: "job.blocked",
  jobUnblocked: "job.unblocked",
  notifyContextAbsence: "notify_adapter.context_absence",
  notifyAdapterError: "notify_adapter.error",
  stateAdapterError: "state_adapter.error",
  // histograms
  jobChainDuration: "job_chain.duration",
  jobDuration: "job.duration",
  jobAttemptDuration: "job.attempt.duration",
  // gauges
  jobTypeIdleChange: "job_type.idle",
  jobTypeProcessingChange: "job_type.processing",
};

const spanKindMap: Record<string, SpanKind> = {
  PRODUCER: SpanKind.PRODUCER,
  CONSUMER: SpanKind.CONSUMER,
  INTERNAL: SpanKind.INTERNAL,
};

const spanStatusMap: Record<string, SpanStatusCode> = {
  UNSET: SpanStatusCode.UNSET,
  OK: SpanStatusCode.OK,
  ERROR: SpanStatusCode.ERROR,
};

type ExpectedSpan = {
  name: string;
  kind?: "PRODUCER" | "CONSUMER" | "INTERNAL";
  attributes?: Record<string, unknown>;
  status?: "UNSET" | "OK" | "ERROR";
  parentName?: string;
  links?: number;
};

export const extendWithObservabilityOtel = <T extends {}>(
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
      jobTypeIdleChange?: { delta: number; typeName?: string; workerId?: string }[];
      jobTypeProcessingChange?: { delta: number; typeName?: string; workerId?: string }[];
    }) => Promise<void>;
    expectSpans: (expected: ExpectedSpan[]) => Promise<void>;
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
      jobTypeIdleChange?: { delta: number; typeName?: string; workerId?: string }[];
      jobTypeProcessingChange?: { delta: number; typeName?: string; workerId?: string }[];
    }) => Promise<void>;
    expectSpans: (expected: ExpectedSpan[]) => Promise<void>;
    _otelExporter: InMemoryMetricExporter;
    _otelReader: PeriodicExportingMetricReader;
    _otelProvider: MeterProvider;
    _otelTraceExporter: InMemorySpanExporter;
    _otelTracerProvider: BasicTracerProvider;
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
    _otelTraceExporter: [async ({}, use) => use(new InMemorySpanExporter()), { scope: "test" }],
    _otelTracerProvider: [
      async ({ _otelTraceExporter }, use) => {
        const provider = new BasicTracerProvider({
          spanProcessors: [new SimpleSpanProcessor(_otelTraceExporter)],
        });
        await use(provider);
        await provider.shutdown();
      },
      { scope: "test" },
    ],
    observabilityAdapter: [
      async ({ _otelProvider, _otelTracerProvider }, use) => {
        await use(
          await createOtelObservabilityAdapter({
            meter: _otelProvider.getMeter("queuert-test"),
            tracer: _otelTracerProvider.getTracer("queuert-test"),
          }),
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
          for (const [method, calls] of Object.entries(expected) as [
            "jobTypeIdleChange" | "jobTypeProcessingChange",
            Array<{ delta: number; typeName?: string; workerId?: string }> | undefined,
          ][]) {
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
    expectSpans: [
      async ({ _otelTraceExporter, expect }, use) => {
        await use(async (expected) => {
          const spans = _otelTraceExporter.getFinishedSpans();

          // Build spanId -> name map for parent lookups
          const spanIdToName = new Map<string, string>();
          for (const span of spans) {
            spanIdToName.set(span.spanContext().spanId, span.name);
          }

          const actual = spans.map((span) => ({
            name: span.name,
            kind: span.kind,
            attributes: span.attributes,
            status: span.status.code,
            parentName: span.parentSpanId
              ? (spanIdToName.get(span.parentSpanId) ?? null)
              : undefined,
            links: span.links.length,
          }));

          expect(actual).toEqual(
            expected.map((entry) => {
              const matcher: Record<string, unknown> = { name: entry.name };
              if (entry.kind !== undefined) matcher.kind = spanKindMap[entry.kind];
              if (entry.attributes) matcher.attributes = expect.objectContaining(entry.attributes);
              if (entry.status !== undefined) matcher.status = spanStatusMap[entry.status];
              if (entry.parentName !== undefined) matcher.parentName = entry.parentName;
              if (entry.links !== undefined) matcher.links = entry.links;
              return expect.objectContaining(matcher);
            }),
          );
        });
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithObservabilityOtel<T>>;
};
