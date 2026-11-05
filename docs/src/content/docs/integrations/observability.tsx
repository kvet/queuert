import { A } from "@solidjs/router";

import { FieldList, type FieldItem } from "../../../components/FieldList.tsx";
import { type OptionCard, OptionCards } from "../../../components/integrations/OptionCards.tsx";

export const meta = {
  title: "Observability",
  description:
    "Logs, metrics, traces and a web UI for Queuert, and the ObservabilityAdapter interface behind metrics and tracing.",
};

const options: OptionCard[] = [
  {
    name: "Logging",
    status: { label: "built-in", tone: "default" },
    pick: "Structured log entries for every worker, job, attempt and chain lifecycle event, sent to your logger.",
    facts: [
      { label: "Package", value: "queuert" },
      { label: "Option", value: "log" },
      { label: "Loggers", value: "console · Pino · Winston" },
    ],
    action: { label: "Logging", href: "/integrations/logging/" },
  },
  {
    name: "OpenTelemetry",
    pick: "Metrics and traces for job chains, exported through your OpenTelemetry SDK.",
    facts: [
      { label: "Package", value: "@queuert/otel" },
      { label: "Option", value: "observabilityAdapter" },
      { label: "Signals", value: "metrics · traces" },
    ],
    action: { label: "OpenTelemetry", href: "/integrations/opentelemetry/" },
  },
  {
    name: "Dashboard",
    status: { label: "experimental", tone: "caution" },
    pick: "An embeddable web UI for observing chains, jobs and workers, mounted on your existing server.",
    facts: [
      { label: "Package", value: "@queuert/dashboard" },
      { label: "Factory", value: "createDashboard" },
      { label: "Returns", value: "{ fetch }" },
    ],
    action: { label: "Dashboard", href: "/integrations/dashboard/" },
  },
];

const members = (): FieldItem[] => [
  {
    name: "Worker lifecycle",
    description: "A worker started, hit an error, lost its lease, or stopped.",
    extra: ["workerStarted", "workerError", "workerLeaseLost", "workerStopped"],
  },
  {
    name: "Chains and jobs",
    description:
      "Chains and jobs were created, completed, deleted, rescheduled, blocked or unblocked.",
    extra: [
      "chainCreated",
      "chainCompleted",
      "chainDeleted",
      "jobCreated",
      "jobCompleted",
      "jobRescheduled",
      "jobBlocked",
      "jobUnblocked",
    ],
  },
  {
    name: "Attempts",
    description: "An attempt started, was lost, failed, completed, or was reclaimed.",
    extra: [
      "jobAttemptStarted",
      "jobAttemptLost",
      "jobAttemptFailed",
      "jobAttemptCompleted",
      "jobAttemptReclaimed",
    ],
  },
  {
    name: "Adapter errors",
    description: "A state or notify adapter operation failed.",
    extra: ["stateAdapterError", "notifyAdapterError"],
  },
  {
    name: "Durations and gauges",
    description: "Chain, job and attempt durations, and per-type idle and processing changes.",
    extra: [
      "chainDuration",
      "jobDuration",
      "jobAttemptDuration",
      "jobTypeIdleChange",
      "jobTypeProcessingChange",
    ],
  },
  {
    name: "Tracing",
    description: "Span starts return handles that manage each span's lifecycle.",
    extra: [
      "startJobSpan",
      "startAttemptSpan",
      "startBlockerSpan",
      "completeBlockerSpan",
      "completeJobSpan",
    ],
  },
];

const Page = () => (
  <>
    <p>
      Queuert can be observed three ways: structured log entries through the <code>log</code>{" "}
      option, metrics and traces through an <code>ObservabilityAdapter</code> such as{" "}
      <code>@queuert/otel</code>, and the dashboard web UI.
    </p>
    <OptionCards items={options} />

    <h2>The ObservabilityAdapter interface</h2>
    <p>
      <code>ObservabilityAdapter</code> is exported from <code>queuert</code> and passed to{" "}
      <code>createClient</code> as <code>observabilityAdapter</code>. Its methods take plain values
      rather than domain objects, decoupling observability from internal types and keeping it stable
      across versions. Its members, by purpose:
    </p>
    <FieldList
      title="ObservabilityAdapter"
      actions={
        <A href="/api/core/type-aliases/observabilityadapter/" class="unstyled text-accent-fg">
          API reference →
        </A>
      }
      proseNames
      items={members()}
    />

    <h2>How adapters behave</h2>
    <ul>
      <li>
        <strong>Opt-in.</strong> When no adapter is provided, a noop implementation is used.
      </li>
      <li>
        <strong>Synchronous.</strong> All methods are synchronous.
      </li>
      <li>
        <strong>Held until commit.</strong> Events emitted inside a database transaction are flushed
        after it commits and discarded if it rolls back, through the same{" "}
        <A href="/guides/transaction-hooks/">transaction hooks</A> that guard notify events.
      </li>
    </ul>
  </>
);

export default Page;
