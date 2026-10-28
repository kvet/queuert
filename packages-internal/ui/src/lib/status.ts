import { type ChainStatus, type JobStatus } from "queuert";

export type AnyStatus = JobStatus | ChainStatus;

export const statusClasses: Record<AnyStatus, { pill: string; dot: string }> = {
  blocked: {
    pill: "bg-status-blocked-bg text-status-blocked-fg",
    dot: "bg-status-blocked-dot",
  },
  pending: {
    pill: "bg-status-pending-bg text-status-pending-fg",
    dot: "bg-status-pending-dot",
  },
  running: {
    pill: "bg-status-running-bg text-status-running-fg",
    dot: "bg-status-running-dot",
  },
  completed: {
    pill: "bg-status-completed-bg text-status-completed-fg",
    dot: "bg-status-completed-dot",
  },
};

export const JOB_STATUSES: JobStatus[] = ["blocked", "pending", "running", "completed"];
export const CHAIN_STATUSES: ChainStatus[] = ["running", "completed"];
