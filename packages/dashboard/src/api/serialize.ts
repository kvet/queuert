import { type StateJob } from "queuert";

export const serializeJob = (
  job: StateJob,
): Omit<StateJob, "createdAt" | "scheduledAt" | "completedAt" | "lastAttemptAt" | "leasedUntil"> & {
  createdAt: string;
  scheduledAt: string;
  completedAt: string | null;
  lastAttemptAt: string | null;
  leasedUntil: string | null;
} => ({
  ...job,
  createdAt: job.createdAt.toISOString(),
  scheduledAt: job.scheduledAt.toISOString(),
  completedAt: job.completedAt?.toISOString() ?? null,
  lastAttemptAt: job.lastAttemptAt?.toISOString() ?? null,
  leasedUntil: job.leasedUntil?.toISOString() ?? null,
});
