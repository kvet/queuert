import { Box } from "@queuert/ui/components";
import { A } from "@solidjs/router";

export const QueuertSummary = () => (
  <Box title="Queuert in short" class="my-6" bodyClass="px-4 pt-3 pb-4 text-sm leading-6">
    <p class="m-0 text-fg-muted">
      A <strong class="text-fg">job-chain library</strong>: durable, typed background work stored in
      your own database. A chain is a sequence of typed jobs where each job's{" "}
      <code>continueWith</code> creates the next; chains start and complete inside your database
      transactions, so the work that follows a write commits or rolls back with it. A one-job chain
      is a queue; a multi-step chain with blockers is closer to a workflow.{" "}
      <A href="/getting-started/introduction/">Introduction →</A>
    </p>
  </Box>
);
