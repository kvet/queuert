import { type UnknownChain, type UnknownJob } from "../api.js";

function Badge(props: { status: string; blocked?: boolean; continued?: boolean }) {
  return (
    <span
      class="status-badge"
      data-status={props.status}
      // oxlint-disable-next-line typescript/prefer-nullish-coalescing
      data-blocked={props.blocked || undefined}
      // oxlint-disable-next-line typescript/prefer-nullish-coalescing
      data-continued={props.continued || undefined}
    >
      {props.status}
      {props.blocked ? " (blocked)" : props.continued ? " (continued)" : ""}
    </span>
  );
}

/**
 * Status badge for a job. Renders `pending (blocked)` when the job is gated by
 * a blocker, and `completed (continued)` when the job handed off via
 * `continueWith` (`continuedToId` set) rather than terminating with output.
 */
export function JobStatusBadge(props: { job: UnknownJob }) {
  return (
    <Badge
      status={props.job.status}
      blocked={props.job.status === "pending" && props.job.blocked}
      continued={props.job.status === "completed" && props.job.continuedToId !== null}
    />
  );
}

/** Status badge for a chain. Chains have no blocked attribute. */
export function ChainStatusBadge(props: { chain: UnknownChain }) {
  return <Badge status={props.chain.status} />;
}
