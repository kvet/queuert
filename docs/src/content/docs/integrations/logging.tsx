import { ExampleCode } from "../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../components/ExampleList.tsx";
import { type FieldItem, FieldList } from "../../../components/FieldList.tsx";
import { FoldGroup } from "../../../components/integrations/FoldGroup.tsx";
import { Details } from "../../../components/mdx/Details.tsx";
import { TabItem, Tabs } from "../../../components/mdx/Tabs.tsx";
import { siteHref } from "../../../docs/href.ts";

export const meta = {
  title: "Logging",
  description: "Structured log entries emitted during job and worker lifecycle events.",
};

const level = {
  info: { label: "info", mono: true },
  warn: { label: "warn", tone: "caution", mono: true },
  error: { label: "error", tone: "danger", mono: true },
} as const;

const entry = (
  name: string,
  lvl: keyof typeof level,
  message: string,
  data: string[],
): FieldItem => ({ name, chips: [level[lvl]], description: message, extra: data });

const job = ["id", "typeName", "chainId", "chainTypeName"];
const processing = [...job, "status", "attempt"];
const attempt = [...processing, "attemptAt", "attemptBy"];

const workerEntries = [
  entry("worker_started", "info", "Started worker", ["workerId", "jobTypeNames"]),
  entry("worker_error", "error", "Worker error", ["workerId", "error"]),
  entry("worker_lease_lost", "warn", "Worker lost its lease", ["workerId"]),
  entry("worker_stopped", "info", "Worker has been stopped", ["workerId"]),
];

const jobEntries = [
  entry("job_created", "info", "Job created", [...job, "input", "blockers", "scheduledAt"]),
  entry("job_completed", "info", "Job completed", [...processing, "output?", "continuedWith?"]),
  entry("job_blocked", "info", "Job blocked by incomplete chains", [...job, "blockedByChains"]),
  entry("job_rescheduled", "info", "Job rescheduled", [
    ...job,
    "scheduledAt",
    "consecutiveFailures",
    "reason?",
  ]),
  entry("job_unblocked", "info", "Job unblocked", [...job, "unblockedByChain"]),
];

const attemptEntries = [
  entry("job_attempt_started", "info", "Job attempt started", [
    ...processing,
    "workerId",
    "workerSlot",
  ]),
  entry("job_attempt_completed", "info", "Job attempt completed", [
    ...processing,
    "output?",
    "continuedWith?",
    "workerId",
    "workerSlot",
  ]),
  entry("job_attempt_failed", "error", "Job attempt failed", [
    ...processing,
    "workerId",
    "workerSlot",
    "error",
  ]),
  entry("job_attempt_lost", "warn", "Job attempt lost", [...attempt, "workerId", "workerSlot"]),
  entry("job_attempt_reclaimed", "info", "Reclaimed job attempt", [
    ...attempt,
    "workerId",
    "reclaimedFrom",
  ]),
];

const chainEntries = [
  entry("chain_created", "info", "Chain created", ["id", "typeName", "input"]),
  entry("chain_completed", "info", "Chain completed", ["id", "typeName", "output"]),
  entry("chain_deleted", "info", "Chain deleted", ["id", "typeName"]),
];

const adapterEntries = [
  entry("notify_adapter_error", "warn", "Notify adapter error", ["operation", "error"]),
  entry("state_adapter_error", "warn", "State adapter error", ["operation", "error"]),
];

const validationEntries = [
  entry("job_type_validation_error", "error", "(dynamic)", [
    "code",
    "typeName",
    "...details",
    "error",
  ]),
];

const Page = () => (
  <>
    <p>
      Queuert emits structured log entries for every lifecycle event — worker start/stop, job
      creation, attempts, failures, completions, chain lifecycle, blockers, and adapter errors.
      Logging is part of <code>queuert</code> core and does not require the{" "}
      <code>@queuert/otel</code> package.
    </p>

    <h2>Setup</h2>
    <p>
      Pass a <code>log</code> function (<a href={siteHref("/api/core/type-aliases/log/")}>Log</a>)
      to <code>createClient</code> to receive log entries. <code>createConsoleLog()</code> is the
      built-in logger:
    </p>
    <Tabs syncKey="logger">
      <TabItem label="Console">
        <ExampleCode example="log/console" file="src/index.ts" region="client" />
      </TabItem>
      <TabItem label="Pino">
        <ExampleCode example="log/pino" file="src/log.ts" />
        <ExampleCode example="log/pino" file="src/index.ts" region="client" />
      </TabItem>
      <TabItem label="Winston">
        <ExampleCode example="log/winston" file="src/log.ts" />
        <ExampleCode example="log/winston" file="src/index.ts" region="client" />
      </TabItem>
    </Tabs>

    <h2>Log entry structure</h2>
    <p>Every log entry is a typed object with the following shape:</p>
    <FieldList
      title="Entry fields"
      idPrefix="entry"
      items={[
        {
          name: "type",
          chips: [{ label: "string", mono: true }],
          description: (
            <>
              Machine-readable event identifier (e.g. <code>job_created</code>).
            </>
          ),
        },
        {
          name: "level",
          chips: [{ label: '"info" | "warn" | "error"', mono: true }],
          description: "Log level.",
        },
        {
          name: "message",
          chips: [{ label: "string", mono: true }],
          description: "Human-readable description.",
        },
        {
          name: "data",
          chips: [{ label: "object", mono: true }],
          description: "Structured data specific to the event.",
        },
        {
          name: "error",
          chips: [{ label: "unknown", mono: true }, "optional"],
          description: "Present only on error/warn entries that carry an error.",
        },
      ]}
    />
    <p>
      All entries are strongly typed — the <code>type</code> field determines the exact shape of{" "}
      <code>data</code>, the <code>level</code>, and the <code>message</code>. This means consumers
      can switch on <code>type</code> for type-safe handling.
    </p>

    <h2>Log entries</h2>
    <p>
      Each entry shows its message; the chips under it are the keys of <code>data</code>,{" "}
      <code>error</code> is the top-level field, and a trailing <code>?</code> marks a key that can
      be absent.
    </p>
    <FoldGroup>
      <Details summary={<span id="worker-lifecycle">Worker log entries</span>} hint="4 entries">
        <FieldList items={workerEntries} idPrefix="log" />
      </Details>
      <Details summary={<span id="job-lifecycle">Job log entries</span>} hint="5 entries">
        <FieldList items={jobEntries} idPrefix="log" />
      </Details>
      <Details summary={<span id="attempt-lifecycle">Attempt log entries</span>} hint="5 entries">
        <FieldList items={attemptEntries} idPrefix="log" />
      </Details>
      <Details summary={<span id="chain-lifecycle">Chain log entries</span>} hint="3 entries">
        <FieldList items={chainEntries} idPrefix="log" />
      </Details>
      <Details
        summary={<span id="adapter-errors">Adapter error log entries</span>}
        hint="2 entries"
      >
        <FieldList items={adapterEntries} idPrefix="log" />
      </Details>
      <Details
        summary={<span id="validation-errors">Validation error log entry</span>}
        hint="1 entry"
      >
        <FieldList items={validationEntries} idPrefix="log" />
      </Details>
    </FoldGroup>

    <h2>Examples</h2>
    <ExampleRows title="Loggers" names={["log/console", "log/pino", "log/winston"]} />
  </>
);

export default Page;
