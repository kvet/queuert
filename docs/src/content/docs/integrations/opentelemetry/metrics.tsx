import { A } from "@solidjs/router";

import { type FieldItem, FieldList } from "../../../../components/FieldList.tsx";
import { TraceWaterfall } from "../../../../components/integrations/observability/TraceWaterfall.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { onboardingDurations } from "../../../../data/traces.ts";

export const meta = {
  title: "OpenTelemetry Metrics",
  description: "OpenTelemetry counters, histograms, and gauges.",
};

const counter = { label: "counter", mono: true } as const;
const histogram = { label: "histogram", tone: "accent", mono: true } as const;
const upDown = { label: "up-down counter", tone: "strong", mono: true } as const;
const seconds = { label: "unit s", mono: true } as const;

const jobAttributes = ["queuert.job.type", "queuert.chain.type"];

const attributes: FieldItem[] = [
  {
    name: "queuert.job.type",
    chips: ["string"],
    description: "Job type name.",
  },
  {
    name: "queuert.chain.type",
    chips: ["string"],
    description: "Chain type name.",
  },
  {
    name: "queuert.job.continued",
    chips: ["boolean"],
    description: (
      <>
        <code>true</code> if the completion produced a continuation, <code>false</code> otherwise.
      </>
    ),
  },
  {
    name: "queuert.adapter.operation",
    chips: ["string"],
    description: "Adapter operation that produced an error.",
  },
];

const workerCounters = (): FieldItem[] => [
  {
    name: "queuert.worker.started",
    chips: [counter],
    description: "Worker registered and started processing.",
  },
  {
    name: "queuert.worker.error",
    chips: [counter],
    description: "Worker encountered an error.",
  },
  {
    name: "queuert.worker.lease_lost",
    chips: [counter],
    description: "Worker lost its lease and restarts.",
  },
  {
    name: "queuert.worker.stopped",
    chips: [counter],
    description: "Worker fully stopped.",
  },
];

const jobCounters = (): FieldItem[] => [
  {
    name: "queuert.job.created",
    chips: [counter],
    description: "Job created.",
    extra: jobAttributes,
  },
  {
    name: "queuert.job.completed",
    chips: [counter],
    description: (
      <>
        Job completed (by a worker or workerless). Use <code>queuert.job.attempt.completed</code> to
        count only worker-processed completions.
      </>
    ),
    extra: [...jobAttributes, "queuert.job.continued"],
  },
  {
    name: "queuert.job.blocked",
    chips: [counter],
    description: "Job blocked by incomplete blocker chains.",
    extra: jobAttributes,
  },
  {
    name: "queuert.job.unblocked",
    chips: [counter],
    description: "Job unblocked after blocker chain completed.",
    extra: jobAttributes,
  },
  {
    name: "queuert.job.rescheduled",
    chips: [counter],
    description: (
      <>
        Job returned to pending: client reschedule, <code>{"complete({ reschedule })"}</code>, retry
        after a failed attempt, or reclaim from a worker that lost its lease, stopped or no longer
        runs it.
      </>
    ),
    extra: jobAttributes,
  },
];

const attemptCounters = (): FieldItem[] => [
  {
    name: "queuert.job.attempt.started",
    chips: [counter],
    description: "Worker began processing an attempt.",
    extra: jobAttributes,
  },
  {
    name: "queuert.job.attempt.completed",
    chips: [counter],
    description: (
      <>
        Attempt completed successfully (including <code>{"complete({ reschedule })"}</code>).
      </>
    ),
    extra: jobAttributes,
  },
  {
    name: "queuert.job.attempt.failed",
    chips: [counter],
    description: "Attempt failed (may retry).",
    extra: jobAttributes,
  },
  {
    name: "queuert.job.attempt.lost",
    chips: [counter],
    description:
      "Attempt lost ownership before committing: taken by another worker, completed elsewhere, or deleted.",
    extra: jobAttributes,
  },
  {
    name: "queuert.job.attempt.reclaimed",
    chips: [counter],
    description:
      "Attempt rescheduled for retry from a worker that lost its lease, stopped or no longer runs it.",
    extra: jobAttributes,
  },
];

const chainCounters = (): FieldItem[] => [
  {
    name: "queuert.chain.created",
    chips: [counter],
    description: "Chain created.",
    extra: ["queuert.chain.type"],
  },
  {
    name: "queuert.chain.completed",
    chips: [counter],
    description: "Chain completed.",
    extra: ["queuert.chain.type"],
  },
  {
    name: "queuert.chain.deleted",
    chips: [counter],
    description: "Chain deleted.",
    extra: ["queuert.chain.type"],
  },
];

const adapterCounters = (): FieldItem[] => [
  {
    name: "queuert.state_adapter.error",
    chips: [counter],
    description: "State adapter operation failed.",
    extra: ["queuert.adapter.operation"],
  },
  {
    name: "queuert.notify_adapter.error",
    chips: [counter],
    description: "Notify adapter operation failed.",
    extra: ["queuert.adapter.operation"],
  },
];

const histograms: FieldItem[] = [
  {
    name: "queuert.chain.duration",
    chips: [histogram, seconds],
    description: "Duration from chain creation to completion.",
    extra: ["queuert.chain.type"],
  },
  {
    name: "queuert.job.duration",
    chips: [histogram, seconds],
    description: "Duration from job creation to completion.",
    extra: jobAttributes,
  },
  {
    name: "queuert.job.attempt.duration",
    chips: [histogram, seconds],
    description: "Duration of a single attempt.",
    extra: jobAttributes,
  },
];

const upDownCounters: FieldItem[] = [
  {
    name: "queuert.job_type.idle",
    chips: [upDown],
    description: "Workers currently idle for this job type.",
    extra: ["queuert.job.type"],
  },
  {
    name: "queuert.job_type.processing",
    chips: [upDown],
    description: "Jobs of this type currently being processed.",
    extra: ["queuert.job.type"],
  },
];

const Page = () => (
  <>
    <p>
      Queuert emits OpenTelemetry metrics through the{" "}
      <A href="/integrations/opentelemetry/">
        <code>@queuert/otel</code>
      </A>{" "}
      adapter. All metrics follow the naming pattern:
    </p>
    <Code lang="text">{`queuert.{component}.{operation}[.{suboperation}]`}</Code>
    <p>
      The <code>ObservabilityAdapter</code> interface accepts milliseconds; the{" "}
      <code>@queuert/otel</code> adapter converts duration values to seconds per{" "}
      <a href="https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/">
        OTEL Messaging Semantic Conventions
      </a>
      .
    </p>

    <h2>Counters</h2>
    <p>The row under each metric lists its attributes; worker counters have none.</p>
    <h3>Worker lifecycle</h3>
    <FieldList items={workerCounters()} idPrefix="metric" />
    <h3>Job lifecycle</h3>
    <FieldList items={jobCounters()} idPrefix="metric" />
    <h3>Attempt lifecycle</h3>
    <FieldList items={attemptCounters()} idPrefix="metric" />
    <h3>Chain lifecycle</h3>
    <FieldList items={chainCounters()} idPrefix="metric" />
    <h3>Adapter errors</h3>
    <FieldList items={adapterCounters()} idPrefix="metric" />

    <h2>Histograms</h2>
    <p>Histograms track duration distributions at three levels. Unit is seconds.</p>
    <FieldList title="Durations" items={histograms} idPrefix="metric" />
    <p>
      These form a hierarchy — chain duration encompasses job durations (plus wait time between
      continuations), and job duration encompasses attempt durations (plus wait time between
      retries):
    </p>
    <TraceWaterfall
      title="durations"
      label="queuert.chain.duration covers the head job's and the continuation's queuert.job.duration; the head job's duration covers a failed attempt, the wait before the retry and the second attempt"
      spans={onboardingDurations}
    />

    <h2>Gauges</h2>
    <p>
      Two up-down counters track real-time worker state. They are incremented/decremented via delta
      values.
    </p>
    <FieldList title="Gauges" items={upDownCounters} idPrefix="metric" />

    <h2>Metric attributes</h2>
    <FieldList title="Metric attributes" items={attributes} idPrefix="attribute" />
  </>
);

export default Page;
