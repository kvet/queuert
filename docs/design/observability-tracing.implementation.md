# Tracing Implementation

This document provides implementation details for the tracing design. For the conceptual design, see [Tracing](observability-tracing.md).

## OTEL Implementation

The `@queuert/otel` package provides an OpenTelemetry implementation:

```typescript
import { trace, SpanKind, context, SpanStatusCode } from "@opentelemetry/api";

export const createOtelObservabilityAdapter = async ({
  meter = metrics.getMeter("queuert"),
  tracer, // Optional - if not provided, tracing methods return undefined
  metricPrefix = "queuert",
}: {
  meter?: Meter;
  tracer?: Tracer;
  metricPrefix?: string;
} = {}): Promise<ObservabilityAdapter> => {
  // ... metrics setup ...

  return {
    // ... existing metrics methods ...

    createProducerSpans(data) {
      if (!tracer) return undefined;

      const isChainStart = data.chainId === data.jobId;
      let chainTraceContext: string;

      if (isChainStart) {
        // Create chain PRODUCER span
        const chainLinks = data.rootChainTraceContext
          ? [{ context: deserializeSpanContext(data.rootChainTraceContext) }]
          : [];

        const chainSpan = tracer.startSpan(`chain ${data.chainTypeName}`, {
          kind: SpanKind.PRODUCER,
          links: chainLinks,
          attributes: {
            "messaging.operation.name": "publish",
            "messaging.destination.name": data.chainTypeName,
            "queuert.chain.id": data.chainId,
            "queuert.chain.type": data.chainTypeName,
            "queuert.chain.root_id": data.rootChainId,
          },
        });
        chainTraceContext = serializeSpanContext(chainSpan.spanContext());
        chainSpan.end();
      } else {
        // Continuation: inherit chain context
        chainTraceContext = data.chainTraceContext!;
      }

      // Create job PRODUCER span as child of chain
      const parentCtx = deserializeSpanContext(chainTraceContext);
      const ctx = trace.setSpanContext(context.active(), parentCtx);

      const jobLinks = [];
      if (data.originAttemptTraceContext) {
        jobLinks.push({ context: deserializeSpanContext(data.originAttemptTraceContext) });
      }
      for (const blockerCtx of data.blockerChainTraceContexts ?? []) {
        jobLinks.push({ context: deserializeSpanContext(blockerCtx) });
      }

      const jobSpan = tracer.startSpan(
        `job ${data.jobTypeName}`,
        {
          kind: SpanKind.PRODUCER,
          links: jobLinks,
          attributes: {
            "messaging.operation.name": "publish",
            "messaging.destination.name": data.jobTypeName,
            "queuert.chain.id": data.chainId,
            "queuert.chain.type": data.chainTypeName,
            "queuert.job.id": data.jobId,
            "queuert.job.type": data.jobTypeName,
            ...(data.originId && { "queuert.job.origin_id": data.originId }),
            ...(data.blockerChainIds?.length && {
              "queuert.job.blocker_chain_ids": data.blockerChainIds,
            }),
          },
        },
        ctx,
      );
      const jobTraceContext = serializeSpanContext(jobSpan.spanContext());
      jobSpan.end();

      return { chain: chainTraceContext, job: jobTraceContext };
    },

    startAttemptConsumerSpan(data) {
      if (!tracer) return undefined;

      const parentCtx = deserializeSpanContext(data.jobTraceContext);
      const ctx = trace.setSpanContext(context.active(), parentCtx);

      const attemptSpan = tracer.startSpan(
        `job-attempt ${data.jobTypeName}`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            "messaging.operation.name": "process",
            "messaging.destination.name": data.jobTypeName,
            "messaging.consumer.group.name": data.workerId,
            "queuert.chain.id": data.chainId,
            "queuert.chain.type": data.chainTypeName,
            "queuert.job.id": data.jobId,
            "queuert.job.type": data.jobTypeName,
            "queuert.job.attempt": data.attempt,
            "queuert.worker.id": data.workerId,
          },
        },
        ctx,
      );

      const attemptCtx = trace.setSpan(context.active(), attemptSpan);

      return {
        getTraceContext() {
          return serializeSpanContext(attemptSpan.spanContext());
        },

        startPrepare() {
          const span = tracer.startSpan(
            "prepare",
            {
              kind: SpanKind.INTERNAL,
            },
            attemptCtx,
          );
          return { end: () => span.end() };
        },

        startComplete() {
          const span = tracer.startSpan(
            "complete",
            {
              kind: SpanKind.INTERNAL,
            },
            attemptCtx,
          );
          return { end: () => span.end() };
        },

        end(result) {
          if (result.error) {
            attemptSpan.recordException(result.error as Error);
          }

          attemptSpan.setStatus({
            code: result.status === "completed" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
          });
          attemptSpan.setAttribute("queuert.attempt.result", result.status);

          if (result.continued) {
            attemptSpan.setAttribute("queuert.continued_with.job_id", result.continued.jobId);
            attemptSpan.setAttribute(
              "queuert.continued_with.job_type",
              result.continued.jobTypeName,
            );
          }

          // Create CONSUMER chain span if chain completed
          if (result.chainCompleted) {
            const chainProducerCtx = deserializeSpanContext(
              result.chainCompleted.chainTraceContext,
            );

            tracer
              .startSpan(
                `chain ${result.chainCompleted.chainTypeName}`,
                {
                  kind: SpanKind.CONSUMER,
                  links: [{ context: chainProducerCtx }],
                  attributes: {
                    "messaging.operation.name": "process",
                    "messaging.destination.name": result.chainCompleted.chainTypeName,
                    "queuert.chain.id": result.chainCompleted.chainId,
                    "queuert.chain.type": result.chainCompleted.chainTypeName,
                  },
                },
                attemptCtx,
              )
              .end();
          }

          attemptSpan.end();
        },
      };
    },
  };
};
```

## Helper Functions

```typescript
const serializeSpanContext = (ctx: SpanContext): string => {
  return `00-${ctx.traceId}-${ctx.spanId}-0${ctx.traceFlags}`;
};

const deserializeSpanContext = (traceparent: string): SpanContext => {
  const [, traceId, spanId, flags] = traceparent.split("-");
  return {
    traceId,
    spanId,
    traceFlags: parseInt(flags, 16),
    isRemote: true,
  };
};
```

## Integration Points

### startJobChain

```typescript
// Create chain and job spans (chainId === jobId triggers both)
const blockerChainTraceContexts = blockers
  .map((b) => b.traceContext?.chain)
  .filter((ctx): ctx is string => ctx != null);

const traceContext = observabilityAdapter.createProducerSpans({
  chainId: job.id,
  chainTypeName,
  rootChainId,
  jobId: job.id,
  jobTypeName,
  originId: null,
  blockerChainTraceContexts,
});

// Store context in job
await stateAdapter.createJob({
  ...job,
  traceContext,
});
```

### Worker Processing

```typescript
// Start attempt span
const attemptHandle = observabilityAdapter.startAttemptConsumerSpan({
  jobTraceContext: job.traceContext!.job,
  chainId: job.chainId,
  chainTypeName: job.chainTypeName,
  jobId: job.id,
  jobTypeName: job.typeName,
  attempt: job.attempt,
  workerId,
});

// Prepare phase
const prepareHandle = attemptHandle?.startPrepare();
try {
  // ... prepare logic ...
} finally {
  prepareHandle?.end();
}

// Complete phase
const completeHandle = attemptHandle?.startComplete();
try {
  // ... complete logic ...
} finally {
  completeHandle?.end();
}

// End attempt
attemptHandle?.end({
  status: "completed",
  chainCompleted: !continued
    ? {
        chainTraceContext: job.traceContext!.chain,
        chainId: job.chainId,
        chainTypeName: job.chainTypeName,
        output,
      }
    : undefined,
});
```

### continueWith

```typescript
// Get origin attempt context for linking
const originAttemptTraceContext = attemptHandle?.getTraceContext();

// Create continuation job span (chainId !== jobId inherits chain context)
const traceContext = observabilityAdapter.createProducerSpans({
  chainId: currentJob.chainId,
  chainTypeName: currentJob.chainTypeName,
  rootChainId: currentJob.rootChainId,
  jobId: newJobId,
  jobTypeName: continuationTypeName,
  originId: currentJob.id,
  chainTraceContext: currentJob.traceContext!.chain, // Inherited
  originAttemptTraceContext,
});

// Create continuation job
await stateAdapter.createJob({
  ...continuationJob,
  traceContext,
});
```

## Noop Behavior

When tracing is not configured (no `tracer` provided to the OTEL adapter), all tracing methods return `undefined`:

```typescript
const adapter = await createOtelObservabilityAdapter({
  meter: metrics.getMeter("queuert"),
  // No tracer - metrics only
});

adapter.createProducerSpans(data); // Returns undefined
adapter.startAttemptConsumerSpan(data); // Returns undefined
```

Integration code uses optional chaining to handle this gracefully:

```typescript
const traceContext = adapter.createProducerSpans(data);
const attemptHandle = adapter.startAttemptConsumerSpan(data);
attemptHandle?.startPrepare()?.end();
```
