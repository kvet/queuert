export type SerializedJob = {
  id: string;
  typeName: string;
  chainId: string;
  chainTypeName: string;
  input: unknown;
  output: unknown;
  chainIndex: number;
  status: "blocked" | "pending" | "running" | "completed";
  createdAt: string;
  scheduledAt: string;
  completedAt: string | null;
  completedBy: string | null;
  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: string | null;
  leasedBy: string | null;
  leasedUntil: string | null;
  deduplicationKey: string | null;
  traceContext: unknown;
};

export type Job = Omit<
  SerializedJob,
  "createdAt" | "scheduledAt" | "completedAt" | "lastAttemptAt" | "leasedUntil"
> & {
  createdAt: Date;
  scheduledAt: Date;
  completedAt: Date | null;
  lastAttemptAt: Date | null;
  leasedUntil: Date | null;
};

export const serializeJob = (job: Job): SerializedJob => ({
  ...job,
  createdAt: job.createdAt.toISOString(),
  scheduledAt: job.scheduledAt.toISOString(),
  completedAt: job.completedAt?.toISOString() ?? null,
  lastAttemptAt: job.lastAttemptAt?.toISOString() ?? null,
  leasedUntil: job.leasedUntil?.toISOString() ?? null,
});

export const deserializeJob = (raw: SerializedJob): Job => ({
  ...raw,
  createdAt: new Date(raw.createdAt),
  scheduledAt: new Date(raw.scheduledAt),
  completedAt: raw.completedAt ? new Date(raw.completedAt) : null,
  lastAttemptAt: raw.lastAttemptAt ? new Date(raw.lastAttemptAt) : null,
  leasedUntil: raw.leasedUntil ? new Date(raw.leasedUntil) : null,
});
