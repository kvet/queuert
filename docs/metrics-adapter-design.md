# ObservabilityAdapter Design

## Overview

A unified `ObservabilityAdapter` interface for metrics and tracing. OTEL is the standard - users configure their exporter (Prometheus, OTLP, Jaeger, etc.).

**Package structure:**

- `queuert` - Core interface (`ObservabilityAdapter` type, `createNoopObservabilityAdapter`)
- `@queuert/otel` - OTEL implementation (`createOtelObservabilityAdapter`)

## Design Principles

1. **Optional** - Like `NotifyAdapter`, defaults to noop if not provided
2. **OTEL-first** - One implementation, users pick their exporter
3. **Minimal surface** - Only essential metrics/spans, users can derive others
4. **Low overhead** - Synchronous metric calls, async tracing where needed
5. **Labeled** - All metrics include relevant dimensions for filtering/grouping

## Metrics Categories

### Counters (Monotonically Increasing)

**Common labels** (included in all metrics):

- `instanceId` - Queuert instance identifier

| Metric                   | Labels                                                  | Description                                  | Used for                           |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| `job_sequence_created`   | `sequenceTypeName`                                      | Job sequences started                        | Sequence throughput                |
| `job_created`            | `typeName`, `sequenceTypeName`                          | Jobs created (startJobSequence/continueWith) | Total job count                    |
| `job_blocked`            | `typeName`, `sequenceTypeName`                          | Jobs created in blocked state                | Deriving blocked count             |
| `job_unblocked`          | `typeName`, `sequenceTypeName`                          | Blocked jobs that became pending             | Deriving blocked count             |
| `job_attempt_started`    | `typeName`, `sequenceTypeName`, `workerId`              | Jobs acquired by a worker                    | Deriving pending/running counts    |
| `job_attempt_completed`  | `typeName`, `sequenceTypeName`, `workerId`              | Job attempts that succeeded                  | Attempt success rate               |
| `job_attempt_failed`     | `typeName`, `sequenceTypeName`, `workerId`              | Job attempts that failed                     | Error rates, retry tracking        |
| `job_completed`          | `typeName`, `sequenceTypeName`, `workerId`, `continued` | Jobs successfully completed                  | Deriving running count, throughput |
| `job_reaped`             | `typeName`, `sequenceTypeName`, `workerId`              | Jobs reclaimed by reaper                     | Lease health monitoring            |
| `job_sequence_completed` | `sequenceTypeName`, `workerId`                          | Sequences finished                           | End-to-end completion rate         |
| `worker_started`         | `workerId`                                              | Workers started                              | Worker churn                       |
| `worker_stopped`         | `workerId`                                              | Workers stopped                              | Worker health                      |
| `worker_error`           | `workerId`                                              | Unhandled errors in worker loop              | Worker health                      |
| `lease_renewed`          | `typeName`, `workerId`                                  | Successful lease renewals                    | Staged mode health                 |
| `lease_expired`          | `typeName`, `workerId`                                  | Lease expirations during processing          | Timeout issues                     |
| `notify_adapter_error`   | `operation`                                             | Notify adapter errors                        | Notify adapter health              |
| `notify_context_absence` | `typeName`, `sequenceTypeName`                          | Jobs created without withNotify context      | Notification reliability           |
| `state_error`            | TBD                                                     | State adapter errors                         | TBD                                |

### Histograms (Distributions)

| Metric           | Labels                         | Unit  | Description                          |
| ---------------- | ------------------------------ | ----- | ------------------------------------ |
| `job_duration`   | `typeName`, `sequenceTypeName` | ms    | Time from job started to completed   |
| `job_wait_time`  | `typeName`, `sequenceTypeName` | ms    | Time from job created to started     |
| `job_total_time` | `typeName`, `sequenceTypeName` | ms    | Time from job created to completed   |
| `job_attempts`   | `typeName`, `sequenceTypeName` | count | Number of attempts before completion |
| `poll_duration`  | `workerId`                     | ms    | Time spent polling for jobs          |

### Gauges (Point-in-Time Values)

**Process-local gauges** (each process reports its own):

- `active_workers` - Workers currently running in this process
- `processing_jobs` - Jobs currently being processed by this process

**Derived gauges** (computed from counters, see Prometheus examples below)

## Interface Design

The `ObservabilityAdapter` interface follows the same pattern as `LogHelper` (see `packages/core/src/log-helper.ts`):

- Methods mirror `LogHelper` signatures where applicable
- Accept `StateJob` and options objects (not flat label maps)
- OTEL implementation extracts labels from `StateJob` fields (`typeName`, `sequenceId`, `rootSequenceId`, etc.)

**Metrics methods** (beyond `LogHelper`):

- `jobBlocked` - when jobs are created in blocked state
- `jobUnblocked` - when blocked jobs transition to pending
- `leaseRenewed` / `leaseExpired` - lease lifecycle
- Histograms: `jobDuration`, `jobWaitTime`, `jobTotalTime`, `jobAttempts`, `pollDuration`
- Gauges: `setActiveWorkers`, `setProcessingJobs`, `setPendingJobs`, `setBlockedJobs`, `setRunningJobs`

**Tracing methods**:

- `withSequenceSpan` - wraps job sequence lifecycle in a span
- `withJobSpan` - wraps job lifecycle in a span (child of sequence)
- `withJobAttemptSpan` - wraps job attempt processing in a span (child of job)
- Trace correlation via `rootId` attribute (no stored trace context needed)

### Deriving Queue State (Prometheus Examples)

```promql
# Pending jobs by type (non-blocked created + unblocked - started + failed)
sum by (typeName) (queuert_job_created_total)
  - sum by (typeName) (queuert_job_blocked_total)
  + sum by (typeName) (queuert_job_unblocked_total)
  - sum by (typeName) (queuert_job_attempt_started_total)
  + sum by (typeName) (queuert_job_attempt_failed_total)

# Running jobs by type
sum by (typeName) (queuert_job_attempt_started_total)
  - sum by (typeName) (queuert_job_completed_total)
  - sum by (typeName) (queuert_job_attempt_failed_total)

# Blocked jobs by type
sum by (typeName) (queuert_job_blocked_total)
  - sum by (typeName) (queuert_job_unblocked_total)

# Queue throughput by sequence type (jobs/sec)
rate(queuert_job_completed_total[5m]) by (sequenceTypeName)

# Error rate by job type
rate(queuert_job_attempt_failed_total[5m]) / rate(queuert_job_attempt_started_total[5m]) by (typeName)

# Active workers across all instances
sum(queuert_active_workers)

# Jobs processed per worker
sum by (workerId) (rate(queuert_job_completed_total[5m]))
```

## OpenTelemetry Integration

### Implementation Sketch

```typescript
import { metrics, trace } from '@opentelemetry/api';

// Internal implementation in @queuert/otel
const createOtelObservabilityAdapter = (options: { instanceId: string }): ObservabilityAdapter => {
  const meter = metrics.getMeter('queuert');
  const tracer = trace.getTracer('queuert');

  const jobCreatedCounter = meter.createCounter('queuert.job.created');
  const jobCompletedCounter = meter.createCounter('queuert.job.completed');
  const jobDurationHistogram = meter.createHistogram('queuert.job.duration', { unit: 'ms' });
  // ... etc

  const withInstance = (labels: Record<string, string>) => ({ ...labels, instanceId: options.instanceId });

  return {
    // Metrics
    jobCreated: (job) =>
      jobCreatedCounter.add(1, withInstance({ typeName: job.typeName, sequenceTypeName: job.sequenceTypeName })),
    jobCompleted: (job, { continued }) =>
      jobCompletedCounter.add(1, withInstance({ typeName: job.typeName, continued: String(continued) })),
    jobDuration: (job, ms) =>
      jobDurationHistogram.record(ms, withInstance({ typeName: job.typeName })),

    // Tracing
    withJobSpan: async (job, options, fn) => {
      const span = tracer.startSpan(`queuert.job.process`, { attributes: { 'queuert.job.type_name': job.typeName } });
      try { return await fn(span); } finally { span.end(); }
    },
    withSequenceCreateSpan: async (typeName, fn) => {
      const span = tracer.startSpan(`queuert.sequence.create`, { attributes: { 'queuert.job.sequence_type_name': typeName } });
      try { return await fn(span); } finally { span.end(); }
    },
  };
};
```

### Tracing

Tracing answers "what happened to this specific job?" - complementing metrics.

**Design: Standard PRODUCER/CONSUMER pattern**

PRODUCER spans end immediately after creating work. CONSUMER spans are correlated via attributes, not parent-child relationships. This follows OTEL conventions for async messaging.

**Trace structure example:**

When querying by `queuert.root.id = "abc-123"` in Jaeger/Tempo:

```
# HTTP handler creates sequence (PRODUCER spans end immediately)
[HTTP Request: POST /signup] ─────────────────────────────────────────
  └─ [queuert.sequence: user-signup-flow] ──  (2ms, ends after DB insert)
     └─ event: sequence.created
     └─ [queuert.job: validate-email] ──      (1ms, ends after DB insert)
        └─ event: job.created

... queue wait time (not a span) ...

# Worker 1 processes first job (CONSUMER span)
[queuert.job.attempt: validate-email #1] ─────────────────────────────
  ├─ attributes: { queuert.root.id, queuert.first.id, queuert.job.id }
  ├─ [queuert.job.prepare] ───
  │   └─ [db-read] ───
  ├─ [email-validation-api] ─────
  ├─ [queuert.job.complete] ────
  │   └─ [db-write] ───
  │   └─ [queuert.job: create-user] ──        (PRODUCER, ends immediately)
  │      └─ event: job.created
  └─ event: attempt.completed

... queue wait time ...

# Worker 2 processes second job - first attempt fails
[queuert.job.attempt: create-user #1] ────────────────────────────────
  ├─ [queuert.job.prepare] ───
  │   └─ [db-read] ───
  ├─ [external-api] ───────                   ← failed here
  └─ event: attempt.failed

# Worker 1 retries second job - succeeds
[queuert.job.attempt: create-user #2] ────────────────────────────────
  ├─ [queuert.job.prepare] ───
  ├─ [external-api] ─────
  ├─ [send-welcome-email] ────
  ├─ [queuert.job.complete] ──────
  │   └─ [db-insert] ─────
  │   └─ [queuert.job: notify-admin] ──       (PRODUCER, ends immediately)
  └─ event: attempt.completed

... queue wait time ...

# Worker 3 processes final job
[queuert.job.attempt: notify-admin #1] ───────────────────────────────
  ├─ [queuert.job.complete] ────
  │   └─ [slack-notify] ────
  └─ event: attempt.completed, job.completed, sequence.completed
```

**Correlation via attributes (not parent-child):**

Spans are linked via shared attributes, not trace parent-child relationships:

- `queuert.root.id` - correlates all spans in a job tree
- `queuert.sequence.id` - correlates spans within a sequence
- `queuert.job.id` - correlates attempts for the same job

Query `queuert.root.id = "abc-123"` to see all related spans.

**HTTP request integration:**

```typescript
// HTTP handler - PRODUCER span is child of HTTP span
app.post('/orders', async (req, res) => {
  const sequence = await queuert.startJobSequence({
    client,
    typeName: 'process-order',
    input: { orderId: 123 },
  });
  // ↑ Creates queuert.sequence PRODUCER span (child of HTTP span)
  //   Span ends immediately after job is created in DB
  //   Worker CONSUMER spans are NOT children - correlated via attributes

  res.json({ id: first.id });
});
```

**Span structure:**

| Span Name              | Kind       | When Ends               | Parent              | Notes                           |
| ---------------------- | ---------- | ----------------------- | ------------------- | ------------------------------- |
| `queuert.sequence`     | `PRODUCER` | After job created in DB | current active      | Ends immediately                |
| `queuert.job`          | `PRODUCER` | After job created in DB | sequence or attempt | Ends immediately (continueWith) |
| `queuert.job.attempt`  | `CONSUMER` | After attempt completes | none (root span)    | Correlated via attributes       |
| `queuert.job.prepare`  | `INTERNAL` | After prepare callback  | job.attempt span    | Optional (auto-setup skips)     |
| `queuert.job.complete` | `INTERNAL` | After complete callback | job.attempt span    | Optional (absent on failure)    |

**Span events:**

| Event                | On Span      | When                                       |
| -------------------- | ------------ | ------------------------------------------ |
| `sequence.created`   | sequence     | Sequence created in DB                     |
| `job.created`        | sequence     | First job created                          |
| `job.created`        | job          | Job created (continueWith)                 |
| `attempt.completed`  | job.attempt  | Attempt succeeds                           |
| `attempt.failed`     | job.attempt  | Attempt fails                              |
| `job.completed`      | job.attempt  | Job finishes (on final successful attempt) |
| `sequence.completed` | job.attempt  | Sequence finishes (on final job's attempt) |
| `continued`          | job.complete | continueWith called                        |

**Span attributes:**

```typescript
{
  'queuert.job.id': job.id,
  'queuert.job.type_name': job.typeName,
  'queuert.job.sequence_type_name': job.sequenceTypeName,
  'queuert.sequence.id': job.sequenceId,
  'queuert.root.id': job.rootSequenceId,
  'queuert.worker.id': workerId,
  'queuert.job.attempt': job.attempts,
}
```

**Additional span events** (lifecycle markers):

- `blocked` - Job created with incomplete blockers (on job PRODUCER span)
- `unblocked` - Blockers completed, job now pending (on job.attempt CONSUMER span, if job was blocked)
- `lease.renewed` - Lease extended (on job.attempt span)
- `lease.expired` - Lease lost (on job.attempt span)

**Implementation sketch:**

```typescript
import { SpanKind } from '@opentelemetry/api';

// In executor.ts when processing a job attempt
const processJobAttempt = async (job: StateJob, workerId: string) => {
  return observabilityAdapter.withJobAttemptSpan(job, { workerId }, async (span) => {
    // User's process function runs here
    // Any spans they create become children of this attempt span
    await processFunction({ job, signal, prepare, complete });
  });
};

// OTEL implementation sets span kinds:
// - sequence/job spans: SpanKind.PRODUCER (creating async work)
// - attempt span: SpanKind.CONSUMER (processing queued work)
// - prepare/complete spans: SpanKind.INTERNAL (in-process operations)

// ObservabilityAdapter interface
interface ObservabilityAdapter {
  // ... metrics methods ...

  // Tracing
  withSequenceSpan: <T>(
    sequenceTypeName: string,
    fn: (span: Span) => Promise<T>,
  ) => Promise<T>;
  withJobSpan: <T>(
    job: StateJob,
    fn: (span: Span) => Promise<T>,
  ) => Promise<T>;
  withJobAttemptSpan: <T>(
    job: StateJob,
    options: { workerId: string },
    fn: (span: Span) => Promise<T>,
  ) => Promise<T>;
}
```

## Integration Points

### Metrics

| Metric                 | Location                                                      |
| ---------------------- | ------------------------------------------------------------- |
| `jobSequenceCreated`   | `queuert-helper.ts` startJobSequence                          |
| `jobCreated`           | `queuert-helper.ts` startJobSequence/continueWith             |
| `jobBlocked`           | `queuert-helper.ts` when job created with incomplete blockers |
| `jobUnblocked`         | `state-adapter` when blockers complete                        |
| `jobAttemptStarted`    | `executor.ts` acquireJob                                      |
| `jobAttemptCompleted`  | `executor.ts` after successful process                        |
| `jobAttemptFailed`     | `executor.ts` handleJobHandlerError                           |
| `jobCompleted`         | `queuert-helper.ts` finishJob                                 |
| `jobReaped`            | `reaper.ts`                                                   |
| `jobSequenceCompleted` | `queuert-helper.ts` finishJob                                 |
| `workerStarted`        | `executor.ts` start                                           |
| `workerStopped`        | `executor.ts` dispose                                         |
| `workerError`          | `executor.ts` catch block                                     |
| `leaseRenewed`         | `lease.ts` renewLease                                         |
| `leaseExpired`         | `job-process.ts`                                              |
| `notifyAdapterError`   | `log-helper.ts` (same location as log)                        |
| `notifyContextAbsence` | `log-helper.ts` (same location as log)                        |
| `pollDuration`         | `executor.ts` poll loop                                       |
| `setActiveWorkers`     | `executor.ts` start/dispose                                   |
| `setProcessingJobs`    | `executor.ts` process loop                                    |

### Tracing

| Span / Event                  | Location                                             |
| ----------------------------- | ---------------------------------------------------- |
| `sequence` span (PRODUCER)    | `queuert-helper.ts` startJobSequence                 |
| `job` span (PRODUCER)         | `queuert-helper.ts` job creation / continueWith      |
| `job.attempt` span (CONSUMER) | `executor.ts` processJob                             |
| `job.prepare` span            | `job-process.ts` prepare phase                       |
| `job.complete` span           | `job-process.ts` complete callback                   |
| `sequence.created` event      | `queuert-helper.ts` startJobSequence                 |
| `job.created` event           | `queuert-helper.ts` job creation                     |
| `blocked` event               | `queuert-helper.ts` when job created blocked         |
| `unblocked` event             | `executor.ts` when processing previously blocked job |
| `attempt.completed` event     | `executor.ts` after successful process               |
| `attempt.failed` event        | `executor.ts` handleJobHandlerError                  |
| `job.completed` event         | `executor.ts` on final successful attempt            |
| `sequence.completed` event    | `executor.ts` on final job's successful attempt      |
| `continued` event             | `queuert-helper.ts` continueWith                     |
| `lease.renewed` event         | `lease.ts` renewLease                                |
| `lease.expired` event         | `job-process.ts`                                     |

## Usage

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { createOtelObservabilityAdapter } from '@queuert/otel';

// 1. Configure OTEL SDK (once at app startup)
const sdk = new NodeSDK({
  metricReader: new PrometheusExporter({ port: 9464 }),
  traceExporter: new OTLPTraceExporter({ url: 'http://jaeger:4318/v1/traces' }),
});
sdk.start();

// 2. Use in queuert
const queuert = createQueuert({
  stateAdapter,
  observabilityAdapter: createOtelObservabilityAdapter({
    instanceId: 'worker-1',  // unique per instance
  }),
});
```

Alternative exporters: OTLP, Datadog, New Relic - use their OTEL exporters with the same pattern.

## Open Questions

1. **Blocker timing**
   - Track how long jobs stay blocked before unblocking?
   - Could be useful for identifying slow dependencies

2. **Scheduled jobs**
   - Track jobs created with `schedule` (deferred start)?
   - `scheduled` label on `jobCreated`?

## Implementation Plan

### Phase 1: Core Interface (in `queuert`)

1. Define `ObservabilityAdapter` type in `packages/core/src/observability-adapter/observability-adapter.ts`
2. Create `createNoopObservabilityAdapter()` for explicit noop usage
3. Add `observabilityAdapter` parameter to `createQueuert` (optional, defaults to noop)
4. Create `ObservabilityHelper` (similar to `LogHelper`) for internal metric/trace emission
5. Instrument lifecycle points (see Integration Points table)
6. Export types and noop adapter from `queuert`

### Phase 2: OTEL Implementation (in `@queuert/otel`)

1. Create `packages/otel` package with `queuert` as peer dependency
2. Implement `createOtelObservabilityAdapter()` using `@opentelemetry/api`
3. Handle metrics (counters, histograms, gauges) via OTEL Meter
4. Handle tracing (spans, context propagation) via OTEL Tracer
5. Export adapter factory from `@queuert/otel`

### Phase 3: Documentation

1. Update README with usage examples
2. Document exporter configurations (Prometheus, OTLP, Jaeger, etc.)

## Rejected Alternatives

### Derive from Log

While log events contain all the data, metrics have different requirements:

- Aggregation (counters, histograms) vs individual events
- Labels/dimensions matter for metrics, less so for logs
- Performance: metrics are typically sampled/aggregated, logs are verbose

### Event Emitter

More flexible but:

- Less typed
- Runtime subscription management complexity
- Harder to guarantee all metric points are covered

### Separate Prometheus and OTEL Adapters

Considered having `@queuert/prometheus` and `@queuert/otel` packages, but:

- OTEL can export to Prometheus natively
- Prometheus has an OTEL collector integration
- Maintaining two implementations doubles the work
- OTEL is the emerging standard for observability

Decision: OTEL-first with Prometheus as an exporter configuration.

### Metrics-Only Adapter

Initially designed as `MetricsAdapter`, but:

- Tracing is equally important for job queue debugging
- Same lifecycle points emit both metrics and traces
- Unified adapter simplifies integration

Decision: Combined `ObservabilityAdapter` for metrics + tracing.

### Blocked Jobs as Label vs Separate Counter

Considered using `job_created{blocked="true"}` / `job_created{blocked="false"}` labels, but:

- Breaks symmetry with `job_unblocked` counter (no corresponding `job_unblocked{...="true"}` label)
- Separate counters (`job_blocked`, `job_unblocked`) match the `LogHelper` pattern
- Cleaner Prometheus queries: `job_blocked_total - job_unblocked_total` vs label filtering

Decision: Separate `job_blocked` counter (subset of `job_created` that started blocked).

### Long-lived Spans for Job Lifecycle

Considered keeping `sequence` and `job` spans open until completion (showing full duration), but:

- PRODUCER spans ending immediately follows OTEL conventions for async messaging
- Long-lived spans require storing trace context in the database
- Jobs can take hours/days - keeping spans open that long is impractical
- Queue wait time is better captured via metrics (`job_wait_time` histogram)
- Correlation via attributes (`queuert.root.id`) works well for debugging

Decision: Standard PRODUCER/CONSUMER pattern - PRODUCER spans end immediately, CONSUMER spans are correlated via attributes.
