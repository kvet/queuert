import { CompareCards } from "../../../components/CompareCards.tsx";
import { CardGrid, LinkCard } from "../../../components/mdx/Cards.tsx";

export const meta = {
  title: "Comparison",
  description: "How Queuert relates to other background-work libraries.",
  layout: "wide",
};

const Page = () => (
  <>
    <p>
      Queuert is a <strong>job-chain library</strong> — durable, typed background work in your
      database. It sits between job queues and workflow engines: a one-job chain <em>is</em> a
      queue; a multi-step chain with blockers is closer to a workflow. Neither label fully fits, so
      Queuert isn't a drop-in replacement for any single neighbor — but readers evaluating it
      usually arrive from one. This section has one page per neighbor, each structured the same way:
      what each tool is, where they aren't directly comparable, what each is good at, practical
      differences worth knowing about, and how to choose between them.
    </p>
    <CardGrid>
      <LinkCard
        title="vs. pg-boss"
        href="/queuert/comparison/pg-boss/"
        description="A Postgres-backed job queue. Same storage tier, different category."
      />
      <LinkCard
        title="vs. BullMQ"
        href="/queuert/comparison/bullmq/"
        description="A Redis-backed job queue. Different storage tier, different category."
      />
      <LinkCard
        title="vs. Temporal"
        href="/queuert/comparison/temporal/"
        description="A distributed workflow platform. Different category — both can model multi-step durable work."
      />
      <LinkCard
        title="vs. Inngest"
        href="/queuert/comparison/inngest/"
        description="An event-driven workflow platform. Different category, different trigger model."
      />
    </CardGrid>
    <h2>How to read these comparisons</h2>
    <p>
      Each page tries to be even-handed: what the neighbor is genuinely good at first, what Queuert
      is good at second, where they overlap, and where they don't. The decision is rarely "X is
      better than Y" — it's usually "are these the same shape of tool?" and, if not, "which shape
      fits the problem at hand?"
    </p>
    <p>
      If your problem involves multiple shapes of work — high-throughput queue lanes <em>and</em>{" "}
      chain-shaped sequences, or transactional handlers <em>and</em> long-lived signal-driven
      workflows — those are different concerns that may genuinely deserve different tools. They
      aren't strict substitutes.
    </p>
    <h2>At a glance</h2>
    <p>
      The same rows for every tool, in the same order. The per-neighbor pages carry the full text
      behind each row, with maintainer quotes and source citations.
    </p>
    <CompareCards />
    <p>
      For throughput, memory and query timings, see <a href="/queuert/benchmarks/">Benchmarks</a>.
    </p>
  </>
);

export default Page;
