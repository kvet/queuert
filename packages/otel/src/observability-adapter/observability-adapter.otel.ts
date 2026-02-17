import {
  type Meter,
  type Span,
  type SpanContext,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  context,
  trace,
} from "@opentelemetry/api";
import { type ObservabilityAdapter } from "queuert";

type OtelTraceContext = {
  chain: string;
  job: string;
};

const serializeSpanContext = (ctx: SpanContext): string =>
  `00-${ctx.traceId}-${ctx.spanId}-0${ctx.traceFlags}`;

const deserializeSpanContext = (traceparent: string): SpanContext => {
  const [, traceId, spanId, flags] = traceparent.split("-");
  return {
    traceId: traceId,
    spanId: spanId,
    traceFlags: parseInt(flags, 16),
    isRemote: true,
  };
};

// W3C traceparent format: 00-{traceId(32hex)}-{spanId(16hex)}-{flags(2hex)}
const TRACEPARENT_REGEX = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

const isValidTraceparent = (value: unknown): value is string =>
  typeof value === "string" && TRACEPARENT_REGEX.test(value);

const toException = (error: unknown): Error | string =>
  error instanceof Error ? error : String(error);

const isValidOtelTraceContext = (ctx: unknown): ctx is OtelTraceContext => {
  if (ctx === null || ctx === undefined || typeof ctx !== "object") return false;
  const obj = ctx as Record<string, unknown>;
  if (!isValidTraceparent(obj.chain)) return false;
  if (!isValidTraceparent(obj.job)) return false;
  return true;
};

/**
 * Creates an OpenTelemetry-based ObservabilityAdapter.
 *
 * Users must configure their OTEL SDK with desired exporters (Prometheus, OTLP, Jaeger, etc.)
 * before using this adapter.
 */
export const createOtelObservabilityAdapter = async ({
  meter,
  tracer,
}: {
  meter?: Meter;
  tracer?: Tracer;
} = {}): Promise<ObservabilityAdapter> => {
  // worker
  const workerStartedCounter = meter?.createCounter("queuert.worker.started");
  const workerErrorCounter = meter?.createCounter("queuert.worker.error");
  const workerStoppingCounter = meter?.createCounter("queuert.worker.stopping");
  const workerStoppedCounter = meter?.createCounter("queuert.worker.stopped");

  // job
  const jobCreatedCounter = meter?.createCounter("queuert.job.created");
  const jobAttemptStartedCounter = meter?.createCounter("queuert.job.attempt.started");
  const jobAttemptTakenByAnotherWorkerCounter = meter?.createCounter(
    "queuert.job.attempt.taken_by_another_worker",
  );
  const jobAttemptLeaseExpiredCounter = meter?.createCounter("queuert.job.attempt.lease_expired");
  const jobAttemptLeaseRenewedCounter = meter?.createCounter("queuert.job.attempt.lease_renewed");
  const jobAttemptFailedCounter = meter?.createCounter("queuert.job.attempt.failed");
  const jobAttemptCompletedCounter = meter?.createCounter("queuert.job.attempt.completed");
  const jobAttemptAlreadyCompletedCounter = meter?.createCounter(
    "queuert.job.attempt.already_completed",
  );
  const jobCompletedCounter = meter?.createCounter("queuert.job.completed");
  const jobReapedCounter = meter?.createCounter("queuert.job.reaped");

  // job chain
  const jobChainCreatedCounter = meter?.createCounter("queuert.job_chain.created");
  const jobChainCompletedCounter = meter?.createCounter("queuert.job_chain.completed");

  // blockers
  const jobBlockedCounter = meter?.createCounter("queuert.job.blocked");
  const jobUnblockedCounter = meter?.createCounter("queuert.job.unblocked");

  // notify adapter
  const notifyContextAbsenceCounter = meter?.createCounter(
    "queuert.notify_adapter.context_absence",
  );
  const notifyAdapterErrorCounter = meter?.createCounter("queuert.notify_adapter.error");

  // state adapter
  const stateAdapterErrorCounter = meter?.createCounter("queuert.state_adapter.error");

  // histograms
  const jobChainDurationHistogram = meter?.createHistogram("queuert.job_chain.duration", {
    unit: "s",
    description: "Duration of job chain from creation to completion",
  });
  const jobDurationHistogram = meter?.createHistogram("queuert.job.duration", {
    unit: "s",
    description: "Duration of job from creation to completion",
  });
  const jobAttemptDurationHistogram = meter?.createHistogram("queuert.job.attempt.duration", {
    unit: "s",
    description: "Duration of job attempt processing",
  });

  // gauges (UpDownCounters)
  const jobTypeIdleGauge = meter?.createUpDownCounter("queuert.job_type.idle", {
    description: "Workers idle for this job type",
  });
  const jobTypeProcessingGauge = meter?.createUpDownCounter("queuert.job_type.processing", {
    description: "Jobs of this type currently being processed",
  });

  const createChainConsumerSpan = (
    tracer: Tracer,
    tc: OtelTraceContext,
    chainTypeName: string,
    chainId: string,
    parentCtx: ReturnType<typeof trace.setSpan>,
  ) => {
    const chainProducerCtx = deserializeSpanContext(tc.chain);
    tracer
      .startSpan(
        `complete chain.${chainTypeName}`,
        {
          kind: SpanKind.CONSUMER,
          links: [{ context: chainProducerCtx }],
          attributes: {
            "queuert.chain.id": chainId,
            "queuert.chain.type": chainTypeName,
          },
        },
        parentCtx,
      )
      .end();
  };

  return {
    // worker
    workerStarted: ({ workerId }) => {
      workerStartedCounter?.add(1, { workerId });
    },
    workerError: ({ workerId }) => {
      workerErrorCounter?.add(1, { workerId });
    },
    workerStopping: ({ workerId }) => {
      workerStoppingCounter?.add(1, { workerId });
    },
    workerStopped: ({ workerId }) => {
      workerStoppedCounter?.add(1, { workerId });
    },

    // job
    jobCreated: ({ typeName, chainTypeName }) => {
      jobCreatedCounter?.add(1, { typeName, chainTypeName });
    },
    jobAttemptStarted: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptStartedCounter?.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptTakenByAnotherWorker: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptTakenByAnotherWorkerCounter?.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptAlreadyCompleted: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptAlreadyCompletedCounter?.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptLeaseExpired: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptLeaseExpiredCounter?.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptLeaseRenewed: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptLeaseRenewedCounter?.add(1, { typeName, chainTypeName, workerId });
    },
    jobReaped: ({ typeName, chainTypeName, workerId }) => {
      jobReapedCounter?.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptFailed: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptFailedCounter?.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptCompleted: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptCompletedCounter?.add(1, { typeName, chainTypeName, workerId });
    },
    jobCompleted: ({ typeName, chainTypeName, workerId, continuedWith }) => {
      jobCompletedCounter?.add(1, {
        typeName,
        chainTypeName,
        workerId: workerId ?? "null",
        continued: continuedWith ? "true" : "false",
      });
    },

    // job chain
    jobChainCreated: ({ typeName }) => {
      jobChainCreatedCounter?.add(1, { chainTypeName: typeName });
    },
    jobChainCompleted: ({ typeName }) => {
      jobChainCompletedCounter?.add(1, { chainTypeName: typeName });
    },

    // blockers
    jobBlocked: ({ typeName, chainTypeName }) => {
      jobBlockedCounter?.add(1, { typeName, chainTypeName });
    },
    jobUnblocked: ({ typeName, chainTypeName }) => {
      jobUnblockedCounter?.add(1, { typeName, chainTypeName });
    },

    // notify adapter
    notifyContextAbsence: ({ typeName, chainTypeName }) => {
      notifyContextAbsenceCounter?.add(1, { typeName, chainTypeName });
    },
    notifyAdapterError: ({ operation }) => {
      notifyAdapterErrorCounter?.add(1, { operation });
    },

    // state adapter
    stateAdapterError: ({ operation }) => {
      stateAdapterErrorCounter?.add(1, { operation });
    },

    // histograms
    jobChainDuration: ({ typeName, durationMs }) => {
      jobChainDurationHistogram?.record(durationMs / 1000, { chainTypeName: typeName });
    },
    jobDuration: ({ typeName, chainTypeName, durationMs }) => {
      jobDurationHistogram?.record(durationMs / 1000, { typeName, chainTypeName });
    },
    jobAttemptDuration: ({ typeName, chainTypeName, workerId, durationMs }) => {
      jobAttemptDurationHistogram?.record(durationMs / 1000, { typeName, chainTypeName, workerId });
    },

    // gauges
    jobTypeIdleChange: ({ delta, typeName, workerId }) => {
      jobTypeIdleGauge?.add(delta, { typeName, workerId });
    },
    jobTypeProcessingChange: ({ delta, typeName, workerId }) => {
      jobTypeProcessingGauge?.add(delta, { typeName, workerId });
    },

    // tracing
    startJobSpan(data) {
      if (!tracer) return undefined;

      let chainSpan: Span | null = null;
      let chainSpanContext: SpanContext;
      let chainTraceContext: string;

      if (data.isChainStart) {
        // Create chain PRODUCER span (kept open until end() to set chain ID)
        chainSpan = tracer.startSpan(`create chain.${data.chainTypeName}`, {
          kind: SpanKind.PRODUCER,
          attributes: {
            "queuert.chain.type": data.chainTypeName,
          },
        });
        chainSpanContext = chainSpan.spanContext();
        chainTraceContext = serializeSpanContext(chainSpanContext);
      } else {
        // Continuation: inherit chain context from origin
        // Validate origin trace context format (may be from a different adapter)
        if (!isValidOtelTraceContext(data.originTraceContext)) return undefined;
        chainTraceContext = data.originTraceContext.chain;
        chainSpanContext = deserializeSpanContext(chainTraceContext);
      }

      // Create job PRODUCER span as child of chain
      const chainCtx = trace.setSpanContext(context.active(), chainSpanContext);

      // Build links: origin job (for continuations)
      const jobLinks: { context: SpanContext }[] = [];
      if (isValidOtelTraceContext(data.originTraceContext)) {
        jobLinks.push({ context: deserializeSpanContext(data.originTraceContext.job) });
      }

      const jobSpan = tracer.startSpan(
        `create job.${data.jobTypeName}`,
        {
          kind: SpanKind.PRODUCER,
          links: jobLinks,
          attributes: {
            "queuert.chain.type": data.chainTypeName,
            "queuert.job.type": data.jobTypeName,
          },
        },
        chainCtx,
      );
      const jobTraceContext = serializeSpanContext(jobSpan.spanContext());

      return {
        getTraceContext: () =>
          ({ chain: chainTraceContext, job: jobTraceContext }) as OtelTraceContext,
        end(result) {
          if (result.status === "created") {
            // Set chain ID on both chain span (if new chain) and job span
            if (chainSpan) {
              chainSpan.setAttribute("queuert.chain.id", result.chainId);
            }
            jobSpan.setAttribute("queuert.chain.id", result.chainId);
            jobSpan.setAttribute("queuert.job.id", result.jobId);
          } else if (result.status === "deduplicated") {
            // Deduplication: span status stays UNSET (not an error), add attribute
            if (chainSpan) {
              chainSpan.setAttribute("queuert.chain.id", result.chainId);
              chainSpan.setAttribute("queuert.chain.deduplicated", true);
            }
            jobSpan.setAttribute("queuert.chain.id", result.chainId);
            jobSpan.setAttribute("queuert.job.id", result.jobId);
            jobSpan.setAttribute("queuert.chain.deduplicated", true);
            // Link to existing chain's trace if available
            if (isValidOtelTraceContext(result.existingTraceContext)) {
              jobSpan.addLink({
                context: deserializeSpanContext(result.existingTraceContext.chain),
              });
            }
          } else {
            if (chainSpan) {
              chainSpan.recordException(toException(result.error));
              chainSpan.setStatus({ code: SpanStatusCode.ERROR });
            }
            jobSpan.recordException(toException(result.error));
            jobSpan.setStatus({ code: SpanStatusCode.ERROR });
          }
          chainSpan?.end();
          jobSpan.end();
        },
      };
    },

    startAttemptSpan(data) {
      if (!tracer) return undefined;

      // Validate trace context format (may be from a different adapter)
      if (!isValidOtelTraceContext(data.traceContext)) return undefined;

      const tc = data.traceContext;
      const parentCtx = deserializeSpanContext(tc.job);
      const ctx = trace.setSpanContext(context.active(), parentCtx);

      const attemptSpan = tracer.startSpan(
        `start job-attempt.${data.jobTypeName}`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
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
        getTraceContext: () => tc,

        startPrepare() {
          const span = tracer.startSpan("prepare", { kind: SpanKind.INTERNAL }, attemptCtx);
          return {
            end: () => {
              span.end();
            },
          };
        },

        startComplete() {
          const span = tracer.startSpan("complete", { kind: SpanKind.INTERNAL }, attemptCtx);
          return {
            end: () => {
              span.end();
            },
          };
        },

        end(result) {
          if (result.status === "failed") {
            attemptSpan.recordException(toException(result.error));
            attemptSpan.setStatus({ code: SpanStatusCode.ERROR });
            attemptSpan.setAttribute("queuert.attempt.result", "failed");
            if (result.rescheduledAt) {
              attemptSpan.setAttribute(
                "queuert.rescheduled_at",
                result.rescheduledAt.toISOString(),
              );
            }
            if (result.rescheduledAfterMs !== undefined) {
              attemptSpan.setAttribute("queuert.rescheduled_after_ms", result.rescheduledAfterMs);
            }
          } else {
            attemptSpan.setStatus({ code: SpanStatusCode.OK });
            attemptSpan.setAttribute("queuert.attempt.result", "completed");

            if (result.continued) {
              attemptSpan.setAttribute("queuert.continued_with.job_id", result.continued.jobId);
              attemptSpan.setAttribute(
                "queuert.continued_with.job_type",
                result.continued.jobTypeName,
              );
            }

            if (result.chainCompleted) {
              createChainConsumerSpan(tracer, tc, data.chainTypeName, data.chainId, attemptCtx);
            }
          }

          attemptSpan.end();
        },
      };
    },

    startBlockerSpan(data) {
      if (!tracer) return undefined;
      if (!isValidOtelTraceContext(data.jobTraceContext)) return undefined;

      const tc = data.jobTraceContext;
      const jobParentCtx = trace.setSpanContext(context.active(), deserializeSpanContext(tc.job));

      const blockerAttributes = {
        "queuert.chain.id": data.chainId,
        "queuert.chain.type": data.chainTypeName,
        "queuert.job.id": data.jobId,
        "queuert.job.type": data.jobTypeName,
        "queuert.blocker.chain.id": data.blockerChainId,
        "queuert.blocker.chain.type": data.blockerChainTypeName,
        "queuert.blocker.index": data.blockerIndex,
      };

      const producerSpan = tracer.startSpan(
        `await chain.${data.blockerChainTypeName}`,
        {
          kind: SpanKind.PRODUCER,
          attributes: blockerAttributes,
        },
        jobParentCtx,
      );
      const producerTraceparent = serializeSpanContext(producerSpan.spanContext());

      return {
        getTraceContext: () => producerTraceparent,
        end: (endData?: { blockerTraceContext?: unknown }) => {
          if (
            endData?.blockerTraceContext &&
            isValidOtelTraceContext(endData.blockerTraceContext)
          ) {
            producerSpan.addLink({
              context: deserializeSpanContext(endData.blockerTraceContext.chain),
            });
          }
          producerSpan.end();
        },
      };
    },

    completeBlockerSpan(data) {
      if (!tracer) return;
      if (!isValidTraceparent(data.traceContext)) return;

      const producerCtx = trace.setSpanContext(
        context.active(),
        deserializeSpanContext(data.traceContext),
      );

      const consumerSpan = tracer.startSpan(
        `resolve chain.${data.blockerChainTypeName}`,
        {
          kind: SpanKind.CONSUMER,
        },
        producerCtx,
      );
      consumerSpan.end();
    },

    completeJobSpan(data) {
      if (!tracer) return;
      if (!isValidOtelTraceContext(data.traceContext)) return;

      const tc = data.traceContext;
      const jobParentCtx = trace.setSpanContext(context.active(), deserializeSpanContext(tc.job));

      const jobSpan = tracer.startSpan(
        `complete job.${data.jobTypeName}`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            "queuert.chain.id": data.chainId,
            "queuert.chain.type": data.chainTypeName,
            "queuert.job.id": data.jobId,
            "queuert.job.type": data.jobTypeName,
          },
        },
        jobParentCtx,
      );

      if (data.continued) {
        jobSpan.setAttribute("queuert.continued_with.job_id", data.continued.jobId);
        jobSpan.setAttribute("queuert.continued_with.job_type", data.continued.jobTypeName);
      }

      const jobConsumerCtx = trace.setSpan(context.active(), jobSpan);

      if (data.chainCompleted) {
        createChainConsumerSpan(tracer, tc, data.chainTypeName, data.chainId, jobConsumerCtx);
      }

      jobSpan.end();
    },
  };
};
