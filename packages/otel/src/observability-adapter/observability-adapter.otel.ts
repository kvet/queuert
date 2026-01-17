import { type Meter, metrics } from "@opentelemetry/api";
import type { ObservabilityAdapter } from "queuert";

/**
 * Creates an OpenTelemetry-based ObservabilityAdapter.
 *
 * Users must configure their OTEL SDK with desired exporters (Prometheus, OTLP, Jaeger, etc.)
 * before using this adapter.
 */
export const createOtelObservabilityAdapter = ({
  meter = metrics.getMeter("queuert"),
  metricPrefix = "queuert",
}: {
  meter?: Meter;
  metricPrefix?: string;
} = {}): ObservabilityAdapter => {
  // worker
  const workerStartedCounter = meter.createCounter(`${metricPrefix}.worker.started`);
  const workerErrorCounter = meter.createCounter(`${metricPrefix}.worker.error`);
  const workerStoppingCounter = meter.createCounter(`${metricPrefix}.worker.stopping`);
  const workerStoppedCounter = meter.createCounter(`${metricPrefix}.worker.stopped`);

  // job
  const jobCreatedCounter = meter.createCounter(`${metricPrefix}.job.created`);
  const jobAttemptStartedCounter = meter.createCounter(`${metricPrefix}.job.attempt.started`);
  const jobAttemptTakenByAnotherWorkerCounter = meter.createCounter(
    `${metricPrefix}.job.attempt.taken_by_another_worker`,
  );
  const jobAttemptLeaseExpiredCounter = meter.createCounter(
    `${metricPrefix}.job.attempt.lease_expired`,
  );
  const jobAttemptLeaseRenewedCounter = meter.createCounter(
    `${metricPrefix}.job.attempt.lease_renewed`,
  );
  const jobAttemptFailedCounter = meter.createCounter(`${metricPrefix}.job.attempt.failed`);
  const jobAttemptCompletedCounter = meter.createCounter(`${metricPrefix}.job.attempt.completed`);
  const jobAttemptAlreadyCompletedCounter = meter.createCounter(
    `${metricPrefix}.job.attempt.already_completed`,
  );
  const jobCompletedCounter = meter.createCounter(`${metricPrefix}.job.completed`);
  const jobReapedCounter = meter.createCounter(`${metricPrefix}.job.reaped`);

  // job chain
  const jobChainCreatedCounter = meter.createCounter(`${metricPrefix}.job_chain.created`);
  const jobChainCompletedCounter = meter.createCounter(`${metricPrefix}.job_chain.completed`);

  // blockers
  const jobBlockedCounter = meter.createCounter(`${metricPrefix}.job.blocked`);
  const jobUnblockedCounter = meter.createCounter(`${metricPrefix}.job.unblocked`);

  // notify adapter
  const notifyContextAbsenceCounter = meter.createCounter(
    `${metricPrefix}.notify_adapter.context_absence`,
  );
  const notifyAdapterErrorCounter = meter.createCounter(`${metricPrefix}.notify_adapter.error`);

  // state adapter
  const stateAdapterErrorCounter = meter.createCounter(`${metricPrefix}.state_adapter.error`);

  // histograms
  const jobChainDurationHistogram = meter.createHistogram(`${metricPrefix}.job_chain.duration`, {
    unit: "ms",
    description: "Duration of job chain from creation to completion",
  });
  const jobDurationHistogram = meter.createHistogram(`${metricPrefix}.job.duration`, {
    unit: "ms",
    description: "Duration of job from creation to completion",
  });
  const jobAttemptDurationHistogram = meter.createHistogram(
    `${metricPrefix}.job.attempt.duration`,
    { unit: "ms", description: "Duration of job attempt processing" },
  );

  // gauges (UpDownCounters)
  const jobTypeIdleGauge = meter.createUpDownCounter(`${metricPrefix}.job_type.idle`, {
    description: "Workers idle for this job type",
  });
  const jobTypeProcessingGauge = meter.createUpDownCounter(`${metricPrefix}.job_type.processing`, {
    description: "Jobs of this type currently being processed",
  });

  return {
    // worker
    workerStarted: ({ workerId }) => {
      workerStartedCounter.add(1, { workerId });
    },
    workerError: ({ workerId }) => {
      workerErrorCounter.add(1, { workerId });
    },
    workerStopping: ({ workerId }) => {
      workerStoppingCounter.add(1, { workerId });
    },
    workerStopped: ({ workerId }) => {
      workerStoppedCounter.add(1, { workerId });
    },

    // job
    jobCreated: ({ typeName, chainTypeName }) => {
      jobCreatedCounter.add(1, { typeName, chainTypeName });
    },
    jobAttemptStarted: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptStartedCounter.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptTakenByAnotherWorker: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptTakenByAnotherWorkerCounter.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptAlreadyCompleted: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptAlreadyCompletedCounter.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptLeaseExpired: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptLeaseExpiredCounter.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptLeaseRenewed: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptLeaseRenewedCounter.add(1, { typeName, chainTypeName, workerId });
    },
    jobReaped: ({ typeName, chainTypeName, workerId }) => {
      jobReapedCounter.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptFailed: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptFailedCounter.add(1, { typeName, chainTypeName, workerId });
    },
    jobAttemptCompleted: ({ typeName, chainTypeName, workerId }) => {
      jobAttemptCompletedCounter.add(1, { typeName, chainTypeName, workerId });
    },
    jobCompleted: ({ typeName, chainTypeName, workerId, continuedWith }) => {
      jobCompletedCounter.add(1, {
        typeName,
        chainTypeName,
        workerId: workerId ?? "null",
        continued: continuedWith ? "true" : "false",
      });
    },

    // job chain
    jobChainCreated: ({ typeName }) => {
      jobChainCreatedCounter.add(1, { chainTypeName: typeName });
    },
    jobChainCompleted: ({ typeName }) => {
      jobChainCompletedCounter.add(1, { chainTypeName: typeName });
    },

    // blockers
    jobBlocked: ({ typeName, chainTypeName }) => {
      jobBlockedCounter.add(1, { typeName, chainTypeName });
    },
    jobUnblocked: ({ typeName, chainTypeName }) => {
      jobUnblockedCounter.add(1, { typeName, chainTypeName });
    },

    // notify adapter
    notifyContextAbsence: ({ typeName, chainTypeName }) => {
      notifyContextAbsenceCounter.add(1, { typeName, chainTypeName });
    },
    notifyAdapterError: ({ operation }) => {
      notifyAdapterErrorCounter.add(1, { operation });
    },

    // state adapter
    stateAdapterError: ({ operation }) => {
      stateAdapterErrorCounter.add(1, { operation });
    },

    // histograms
    jobChainDuration: ({ typeName, durationMs }) => {
      jobChainDurationHistogram.record(durationMs, { chainTypeName: typeName });
    },
    jobDuration: ({ typeName, chainTypeName, durationMs }) => {
      jobDurationHistogram.record(durationMs, { typeName, chainTypeName });
    },
    jobAttemptDuration: ({ typeName, chainTypeName, workerId, durationMs }) => {
      jobAttemptDurationHistogram.record(durationMs, { typeName, chainTypeName, workerId });
    },

    // gauges
    jobTypeIdleChange: ({ delta, typeName, workerId }) => {
      jobTypeIdleGauge.add(delta, { typeName, workerId });
    },
    jobTypeProcessingChange: ({ delta, typeName, workerId }) => {
      jobTypeProcessingGauge.add(delta, { typeName, workerId });
    },
  };
};
