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

  // job sequence
  const jobSequenceCreatedCounter = meter.createCounter(`${metricPrefix}.job_sequence.created`);
  const jobSequenceCompletedCounter = meter.createCounter(`${metricPrefix}.job_sequence.completed`);

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
  const jobSequenceDurationHistogram = meter.createHistogram(
    `${metricPrefix}.job_sequence.duration`,
    { unit: "ms", description: "Duration of job sequence from creation to completion" },
  );
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
    jobCreated: ({ typeName, sequenceTypeName }) => {
      jobCreatedCounter.add(1, { typeName, sequenceTypeName });
    },
    jobAttemptStarted: ({ typeName, sequenceTypeName, workerId }) => {
      jobAttemptStartedCounter.add(1, { typeName, sequenceTypeName, workerId });
    },
    jobAttemptTakenByAnotherWorker: ({ typeName, sequenceTypeName, workerId }) => {
      jobAttemptTakenByAnotherWorkerCounter.add(1, { typeName, sequenceTypeName, workerId });
    },
    jobAttemptAlreadyCompleted: ({ typeName, sequenceTypeName, workerId }) => {
      jobAttemptAlreadyCompletedCounter.add(1, { typeName, sequenceTypeName, workerId });
    },
    jobAttemptLeaseExpired: ({ typeName, sequenceTypeName, workerId }) => {
      jobAttemptLeaseExpiredCounter.add(1, { typeName, sequenceTypeName, workerId });
    },
    jobAttemptLeaseRenewed: ({ typeName, sequenceTypeName, workerId }) => {
      jobAttemptLeaseRenewedCounter.add(1, { typeName, sequenceTypeName, workerId });
    },
    jobReaped: ({ typeName, sequenceTypeName, workerId }) => {
      jobReapedCounter.add(1, { typeName, sequenceTypeName, workerId });
    },
    jobAttemptFailed: ({ typeName, sequenceTypeName, workerId }) => {
      jobAttemptFailedCounter.add(1, { typeName, sequenceTypeName, workerId });
    },
    jobAttemptCompleted: ({ typeName, sequenceTypeName, workerId }) => {
      jobAttemptCompletedCounter.add(1, { typeName, sequenceTypeName, workerId });
    },
    jobCompleted: ({ typeName, sequenceTypeName, workerId, continuedWith }) => {
      jobCompletedCounter.add(1, {
        typeName,
        sequenceTypeName,
        workerId: workerId ?? "null",
        continued: continuedWith ? "true" : "false",
      });
    },

    // job sequence
    jobSequenceCreated: ({ typeName }) => {
      jobSequenceCreatedCounter.add(1, { sequenceTypeName: typeName });
    },
    jobSequenceCompleted: ({ typeName }) => {
      jobSequenceCompletedCounter.add(1, { sequenceTypeName: typeName });
    },

    // blockers
    jobBlocked: ({ typeName, sequenceTypeName }) => {
      jobBlockedCounter.add(1, { typeName, sequenceTypeName });
    },
    jobUnblocked: ({ typeName, sequenceTypeName }) => {
      jobUnblockedCounter.add(1, { typeName, sequenceTypeName });
    },

    // notify adapter
    notifyContextAbsence: ({ typeName, sequenceTypeName }) => {
      notifyContextAbsenceCounter.add(1, { typeName, sequenceTypeName });
    },
    notifyAdapterError: ({ operation }) => {
      notifyAdapterErrorCounter.add(1, { operation });
    },

    // state adapter
    stateAdapterError: ({ operation }) => {
      stateAdapterErrorCounter.add(1, { operation });
    },

    // histograms
    jobSequenceDuration: ({ typeName, durationMs }) => {
      jobSequenceDurationHistogram.record(durationMs, { sequenceTypeName: typeName });
    },
    jobDuration: ({ typeName, sequenceTypeName, durationMs }) => {
      jobDurationHistogram.record(durationMs, { typeName, sequenceTypeName });
    },
    jobAttemptDuration: ({ typeName, sequenceTypeName, workerId, durationMs }) => {
      jobAttemptDurationHistogram.record(durationMs, { typeName, sequenceTypeName, workerId });
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
