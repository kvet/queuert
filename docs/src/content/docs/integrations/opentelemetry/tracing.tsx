import { A } from "@solidjs/router";
import { type JSX } from "solid-js";

import { type FieldItem, FieldList } from "../../../../components/FieldList.tsx";
import { TraceWaterfall } from "../../../../components/integrations/observability/TraceWaterfall.tsx";
import { Steps } from "../../../../components/mdx/Steps.tsx";
import {
  approveRefundTrace,
  dailyDigestTrace,
  invoiceTrace,
  shipOrderTrace,
} from "../../../../data/traces.ts";

export const meta = {
  title: "OpenTelemetry Tracing",
  description: "OpenTelemetry span hierarchy, span kinds and attributes.",
};

const producer = { label: "PRODUCER", mono: true } as const;
const consumer = { label: "CONSUMER", tone: "accent", mono: true } as const;

const chainIds = ["queuert.chain.id", "queuert.chain.type"];
const jobIds = ["queuert.job.id", "queuert.job.type"];
const continuedWith = ["queuert.continued_with.job_id", "queuert.continued_with.job_type"];

const span = (options: {
  name: string;
  id: string;
  kind: typeof producer | typeof consumer;
  created: JSX.Element;
  ended: string;
  duration: string;
  attributes: string[];
  note?: string;
}): FieldItem => ({
  name: options.name,
  id: `span-${options.id}`,
  chips: [options.kind],
  description: (
    <>
      Created: {options.created}. Ended: {options.ended}. Duration: {options.duration}.
      {options.note === undefined ? null : ` ${options.note}`}
    </>
  ),
  extra: options.attributes.length === 0 ? undefined : options.attributes,
});

const spans: FieldItem[] = [
  span({
    name: "create chain.{type}",
    id: "create-chain",
    kind: producer,
    created: <code>createChain()</code>,
    ended: "on commit",
    duration: "until the transaction commits",
    attributes: [...chainIds, "queuert.chain.deduplicated"],
  }),
  span({
    name: "create job.{type}",
    id: "create-job",
    kind: producer,
    created: (
      <>
        <code>createChain()</code>, <code>{"complete({ continueWith: ... })"}</code>
      </>
    ),
    ended: "on commit",
    duration: "until the transaction commits",
    attributes: [...chainIds, ...jobIds, "queuert.chain.deduplicated"],
  }),
  span({
    name: "await chain.{type}",
    id: "await-chain",
    kind: producer,
    created: (
      <>
        <code>createChain()</code> with blockers
      </>
    ),
    ended: "on commit",
    duration: "until the transaction commits",
    attributes: [
      ...chainIds,
      ...jobIds,
      "queuert.blocker.chain.id",
      "queuert.blocker.chain.type",
      "queuert.blocker.index",
    ],
  }),
  span({
    name: "complete chain.{type}",
    id: "complete-blocker-chain",
    kind: consumer,
    created: <>blocker chain completes</>,
    ended: "immediately",
    duration: "~0ms",
    attributes: [],
    note: "No attributes.",
  }),
  span({
    name: "start job-attempt.{type}",
    id: "start-job-attempt",
    kind: consumer,
    created: <>worker claims job</>,
    ended: "attempt completes/fails",
    duration: "processing time",
    attributes: [
      ...chainIds,
      ...jobIds,
      "queuert.job.attempt",
      "queuert.worker.id",
      ...continuedWith,
    ],
  }),
  span({
    name: "complete job.{type}",
    id: "complete-job",
    kind: consumer,
    created: <>workerless completion</>,
    ended: "immediately",
    duration: "~0ms",
    attributes: [...chainIds, ...jobIds, ...continuedWith],
  }),
  span({
    name: "complete chain.{type}",
    id: "complete-chain",
    kind: consumer,
    created: <>final job completes</>,
    ended: "immediately",
    duration: "~0ms",
    attributes: chainIds,
  }),
];

const attributes: FieldItem[] = [
  { name: "queuert.chain.id", chips: ["string"], description: "Chain ID." },
  { name: "queuert.chain.type", chips: ["string"], description: "Chain type name." },
  {
    name: "queuert.chain.deduplicated",
    chips: ["boolean"],
    description: (
      <>
        <code>true</code> when chain was deduplicated; absent otherwise.
      </>
    ),
  },
  { name: "queuert.job.id", chips: ["string"], description: "Job ID." },
  { name: "queuert.job.type", chips: ["string"], description: "Job type name." },
  { name: "queuert.job.attempt", chips: ["number"], description: "Attempt number." },
  {
    name: "queuert.worker.id",
    chips: ["string"],
    description: "Worker ID processing the attempt.",
  },
  {
    name: "queuert.continued_with.job_id",
    chips: ["string"],
    description: "ID of the continuation job; present when the job continued.",
  },
  {
    name: "queuert.continued_with.job_type",
    chips: ["string"],
    description: "Type name of the continuation job; present when the job continued.",
  },
  { name: "queuert.blocker.chain.id", chips: ["string"], description: "Blocker chain ID." },
  {
    name: "queuert.blocker.chain.type",
    chips: ["string"],
    description: "Blocker chain type name.",
  },
  {
    name: "queuert.blocker.index",
    chips: ["number"],
    description: "Index of the blocker in the blockers array.",
  },
];

const Page = () => (
  <>
    <p>
      Tracing through the{" "}
      <A href="/integrations/opentelemetry/">
        <code>@queuert/otel</code>
      </A>{" "}
      adapter provides end-to-end visibility into chain execution, including job dependencies, retry
      attempts, and blocker relationships.
    </p>

    <h2>Span hierarchy</h2>
    <p>
      Queuert uses a four-level span hierarchy. Span kinds use OpenTelemetry's PRODUCER/CONSUMER
      semantics. The chain has both a PRODUCER (creation) and CONSUMER (completion) span for
      symmetry.
    </p>
    <TraceWaterfall
      title="trace"
      subtitle="chain render-invoice-pdf"
      label="A render-invoice-pdf chain: the first attempt fails, the retry continues to sync-to-crm, whose attempt completes the chain"
      spans={invoiceTrace}
    />
    <p>
      The row under each span lists its attributes, defined under{" "}
      <a href="#span-attributes">Span attributes</a>.
    </p>
    <FieldList title="Spans" items={spans} />

    <h2>Blocker relationships</h2>
    <p>
      When a job has blockers (dependencies on other chains), each blocker gets a PRODUCER/CONSUMER
      span pair as a child of the blocked job's PRODUCER span. The PRODUCER (
      <code>await chain.{"{type}"}</code>) is created at <code>createChain</code> time with a link
      to the blocker chain. The CONSUMER (<code>complete chain.{"{type}"}</code>) is created when
      the blocker chain completes, so the time between them represents the blocking duration.
    </p>
    <TraceWaterfall
      title="trace"
      subtitle="POST /orders"
      label="ship-order awaits capture-payment: the await chain span is created with ship-order and its complete chain child appears when capture-payment completes, after which ship-order's attempt starts"
      spans={shipOrderTrace}
    />
    <Steps>
      <ol>
        <li>
          <strong>PRODUCER created</strong> in <code>createChain</code> and ended when the
          transaction commits, when the job has blockers — one PRODUCER span per blocker, as a child
          of the job's PRODUCER span, with a link to the blocker chain's trace context.
        </li>
        <li>
          <strong>Persisted</strong> — the PRODUCER span context is stored in the{" "}
          <code>job_blocker</code> table (<code>trace_context</code> column) so the CONSUMER can be
          created by another process.
        </li>
        <li>
          <strong>CONSUMER created</strong> when the blocker chain has completed — the PRODUCER span
          context is read from <code>job_blocker</code> and a CONSUMER span is created as its child.
          If the blocker chain is already completed at creation time, <code>createChain</code>{" "}
          creates the CONSUMER span right away instead.
        </li>
      </ol>
    </Steps>

    <h2>Workerless completion</h2>
    <p>
      When a job is completed via <code>completeChain</code> (without a worker), there is no
      job-attempt. Instead, a CONSUMER job span marks the completion, and if the chain is fully
      completed, a CONSUMER chain span closes the trace:
    </p>
    <TraceWaterfall
      title="trace"
      subtitle="chain approve-refund"
      label="approve-refund is created, then completed three minutes later through completeChain: a complete job span and its complete chain child"
      spans={approveRefundTrace}
    />
    <p>
      The CONSUMER job span is a child of the PRODUCER job span and carries the same chain/job
      attributes. When <code>continueWith</code> is called during workerless completion, the
      CONSUMER chain span is omitted (the chain continues).
    </p>

    <h2>Chain completion link</h2>
    <p>
      The final <code>complete chain.{"{type}"}</code> CONSUMER span includes a link to the chain's
      PRODUCER span context (<code>chainTraceContext</code>), connecting the chain's creation and
      completion across processes and time.
    </p>

    <h2>Deduplication</h2>
    <p>
      When <code>createChain</code> is called with deduplication options and a matching chain
      already exists, no new chain is created. Deduplication is not an error — per{" "}
      <a href="https://opentelemetry.io/docs/specs/otel/trace/api/#set-status">
        OpenTelemetry status conventions
      </a>
      , the span status remains <code>UNSET</code>. When deduplication occurs, the spans:
    </p>
    <ul>
      <li>
        get the attribute <code>queuert.chain.deduplicated: true</code>;
      </li>
      <li>reference the existing chain's IDs;</li>
      <li>
        link the <code>create job</code> span to the existing chain's trace context, if available.
      </li>
    </ul>
    <TraceWaterfall
      title="trace"
      subtitle="two calls with the same deduplication key"
      label="The first POST /digests creates the daily-digest chain; the second returns it, with spans marked deduplicated and a link to the first chain"
      spans={dailyDigestTrace}
    />

    <h2>Span attributes</h2>
    <FieldList title="Span attributes" items={attributes} idPrefix="attribute" />
  </>
);

export default Page;
